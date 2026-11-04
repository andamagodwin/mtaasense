import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, GalleryAdd } from 'iconsax-react-nativejs';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Callout, Card, ProgressBar, SectionLabel } from '@/components/ui/feedback';
import { Text } from '@/components/ui/Text';
import { api, ApiError, appendFile, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FIX_VERDICT_LABEL, formatDateTime, SAME_PLACE_LABEL } from '@/lib/format';
import { prepareForUpload } from '@/lib/photo';
import type { FixCheck, FixImage, FixVerdict, ReportDetail } from '@/lib/types';
import { colors } from '@/theme/tokens';

import { MaskOverlay } from './EvidencePhoto';

const VERDICT_TONE: Record<FixVerdict, { box: string; text: string }> = {
  repaired: { box: 'border-success-line bg-success-soft', text: 'text-success-ink' },
  partially_repaired: { box: 'border-warn-line bg-warn-soft', text: 'text-warn-ink' },
  not_repaired: { box: 'border-danger-line bg-danger-soft', text: 'text-danger' },
  different_place: { box: 'border-line-strong bg-surface', text: 'text-ink-2' },
  insufficient_evidence: { box: 'border-line bg-sunken', text: 'text-ink-3' },
};

function Photo({ label, photo }: { label: string; photo: FixImage }) {
  const W = photo.width ?? photo.image.width ?? 4;
  const H = photo.height ?? photo.image.height ?? 3;
  return (
    <View className="flex-1 gap-1.5">
      <View className="aspect-[4/3] overflow-hidden rounded-xl bg-photo">
        <Image
          source={{ uri: mediaUrl(photo.image), cacheKey: photo.image.id }}
          contentFit="contain"
          accessibilityLabel={`${label} photo`}
          style={StyleSheet.absoluteFill}
        />
        {photo.regions && photo.regions.length > 0 && (
          <MaskOverlay regions={photo.regions} width={W} height={H} />
        )}
      </View>
      <Text className="font-semibold text-[12px] text-ink-2">{label}</Text>
    </View>
  );
}

function Result({ check }: { check: FixCheck }) {
  const pending = check.status === 'queued' || check.status === 'running';
  const tone = check.verdict ? VERDICT_TONE[check.verdict] : null;
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center gap-2">
        {check.verdict && tone && (
          <View className={cn('h-[24px] justify-center rounded-md border px-2', tone.box)}>
            <Text className={cn('font-semibold text-[12px]', tone.text)}>
              {FIX_VERDICT_LABEL[check.verdict]}
            </Text>
          </View>
        )}
        {pending && <ActivityIndicator size="small" color={colors.accent.DEFAULT} />}
        <Text className="text-[12.5px] text-ink-3">
          {pending ? 'Comparing the photos…' : formatDateTime(check.created_at)}
        </Text>
      </View>
      <View className="flex-row gap-2.5">
        <Photo label="Before" photo={check.before} />
        <Photo label="After" photo={check.after} />
      </View>
      {check.status === 'failed' && (
        <Callout tone="danger" title="These photos couldn’t be compared">
          Try again later with another photo.
        </Callout>
      )}
      {check.assessment && (
        <View className="gap-1.5">
          <Text className="font-semibold text-[14px]">
            {SAME_PLACE_LABEL[check.assessment.same_place]}.
          </Text>
          <Text className="text-[14px] leading-5 text-ink-2">
            {check.assessment.visible_changes}
          </Text>
          <Text className="text-[12.5px] text-ink-3">
            Muse Spark compared the photos; SAM 3.1 outlined{' '}
            {check.concept ? `“${check.concept}”` : 'the hazard'}. A reviewer decides whether to
            close the incident.
          </Text>
        </View>
      )}
    </View>
  );
}

/** "Has it been fixed?": the resident sends a new photo of the spot and sees the comparison. */
export function FixCheckCard({
  report,
  token,
  onSent,
}: {
  report: ReportDetail;
  token: string;
  onSent: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = report.incident?.status === 'confirmed';
  if (!report.incident || (!open && report.fix_checks.length === 0)) return null;

  async function send(source: 'camera' | 'library') {
    setError(null);
    try {
      if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        setError('Camera access was declined. Choose a photo from your library instead.');
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      setProgress(0);
      const photo = await prepareForUpload({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      });
      const form = new FormData();
      appendFile(form, 'image', { uri: photo.uri, name: 'after.jpg', type: 'image/jpeg' });
      await api.checkFix(report.id, form, token, setProgress);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The photo couldn’t be sent. Try again.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card className="gap-4 p-4">
      <View className="gap-1">
        <SectionLabel>Has it been fixed?</SectionLabel>
        <Text className="text-[13.5px] leading-5 text-ink-2">
          Send a new photo from where you took the first one. We’ll compare the two.
        </Text>
      </View>
      {open &&
        (progress !== null ? (
          <ProgressBar value={progress} />
        ) : (
          <View className="flex-row gap-2">
            <Button
              title="Take a photo"
              icon={Camera}
              className="flex-1"
              onPress={() => void send('camera')}
            />
            <Button
              title="Library"
              variant="secondary"
              icon={GalleryAdd}
              onPress={() => void send('library')}
            />
          </View>
        ))}
      {error && <Callout tone="danger">{error}</Callout>}
      {report.fix_checks.map((check) => (
        <View key={check.id} className="border-t border-line pt-4">
          <Result check={check} />
        </View>
      ))}
    </Card>
  );
}
