import { Image } from 'expo-image';
import {
  Camera,
  Edit2,
  GalleryAdd,
  Gps,
  Location as LocationIcon,
  MagicStar,
} from 'iconsax-react-nativejs';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { CategoryDot } from '@/components/badges';
import { LocationPicker } from '@/components/map/LocationPicker';
import { Button } from '@/components/ui/Button';
import { Callout, ProgressBar } from '@/components/ui/feedback';
import { Field } from '@/components/ui/Field';
import { Text, TextInput } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { CATEGORIES, CATEGORY_HINT, CATEGORY_LABEL, formatCoords } from '@/lib/format';
import type { Photo } from '@/lib/photo';
import type { HazardCategory, LatLon, LocationSource, MapFeatures } from '@/lib/types';
import { colors } from '@/theme/tokens';

import type { GeoState } from './ReportFlow';
import { VoiceNote, type VoiceNoteValue } from './VoiceNote';

function StepTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <View className="gap-1">
      <Text className="font-bold text-[18px]">{children}</Text>
      {hint && <Text className="text-[13.5px] leading-5 text-ink-3">{hint}</Text>}
    </View>
  );
}

function PhotoPreview({ photo, maxHeight }: { photo: Photo; maxHeight: number }) {
  return (
    <View className="items-center bg-photo">
      <Image
        source={{ uri: photo.uri }}
        contentFit="contain"
        accessibilityLabel="Selected photo"
        style={{ width: '100%', aspectRatio: photo.width / photo.height, maxHeight }}
      />
    </View>
  );
}

export function PhotoStep({
  photo,
  preparing,
  error,
  maxImageMb,
  onPick,
}: {
  photo: Photo | null;
  preparing: boolean;
  error: string | null;
  maxImageMb: number;
  onPick: (source: 'camera' | 'library') => void;
}) {
  return (
    <View className="gap-4">
      <StepTitle>Add a photo of the problem</StepTitle>
      {preparing ? (
        <View className="h-48 items-center justify-center gap-2 rounded-xl border border-line bg-surface">
          <ActivityIndicator color={colors.accent.DEFAULT} />
          <Text className="text-[13px] text-ink-3">Preparing photo…</Text>
        </View>
      ) : photo ? (
        <View className="overflow-hidden rounded-xl border border-line">
          <PhotoPreview photo={photo} maxHeight={420} />
          <View className="flex-row items-center justify-between bg-surface px-4 py-2">
            <Text className="text-[13px] text-ink-2">
              {photo.width} × {photo.height}
            </Text>
            <View className="flex-row gap-1">
              <Button
                title="Retake"
                variant="ghost"
                size="sm"
                icon={Camera}
                onPress={() => onPick('camera')}
              />
              <Button
                title="Change"
                variant="ghost"
                size="sm"
                icon={GalleryAdd}
                onPress={() => onPick('library')}
              />
            </View>
          </View>
        </View>
      ) : (
        <View className="gap-2.5">
          <PickTile
            primary
            icon={<Camera size={22} color="#fff" />}
            title="Take a photo"
            hint="Opens your camera"
            onPress={() => onPick('camera')}
          />
          <PickTile
            icon={<GalleryAdd size={22} color={colors.ink[2]} />}
            title="Choose a photo"
            hint={`From your library, up to ${maxImageMb} MB`}
            onPress={() => onPick('library')}
          />
        </View>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      <Text className="text-[12.5px] leading-[18px] text-ink-3">
        Tip: step back so the surroundings are visible, and avoid capturing faces or number plates.
      </Text>
    </View>
  );
}

function PickTile({
  primary,
  icon,
  title,
  hint,
  onPress,
}: {
  primary?: boolean;
  icon: ReactNode;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3.5 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-5 active:border-accent active:bg-accent-soft">
      <View
        className={cn(
          'size-12 items-center justify-center rounded-full',
          primary ? 'bg-accent' : 'bg-sunken'
        )}>
        {icon}
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-semibold text-[16px]">{title}</Text>
        <Text className="text-[13px] text-ink-3">{hint}</Text>
      </View>
    </Pressable>
  );
}

export function DescribeStep({
  category,
  onCategory,
  description,
  onDescription,
  voice,
  onVoice,
  maxAudioSeconds,
  tooShort,
}: {
  category: HazardCategory | 'auto';
  onCategory: (c: HazardCategory | 'auto') => void;
  description: string;
  onDescription: (v: string) => void;
  voice: VoiceNoteValue | null;
  onVoice: (v: VoiceNoteValue | null) => void;
  maxAudioSeconds: number;
  tooShort: boolean;
}) {
  return (
    <View className="gap-6">
      <StepTitle>What did you see?</StepTitle>
      <View className="gap-2">
        <Text className="font-semibold text-[14px]">Type of problem</Text>
        {/* The default comes first, so most people can skip this choice entirely. */}
        <CategoryTile
          selected={category === 'auto'}
          onPress={() => onCategory('auto')}
          title="Not sure"
          hint="Let Muse Spark suggest a category"
          mark={<MagicStar size={14} color={colors.accent.DEFAULT} />}
        />
        {CATEGORIES.map((c) => (
          <CategoryTile
            key={c}
            selected={category === c}
            onPress={() => onCategory(c)}
            title={CATEGORY_LABEL[c]}
            hint={CATEGORY_HINT[c]}
            mark={<CategoryDot category={c} size={10} />}
          />
        ))}
      </View>
      <Field
        label="Description"
        hint={`${description.trim().length}/2000 · e.g. how big it is, how long it has been there, who it affects.`}>
        <TextInput
          value={description}
          onChangeText={onDescription}
          maxLength={2000}
          multiline
          textAlignVertical="top"
          className="min-h-[112px]"
          placeholder="Deep pothole on the left lane outside the school gate; boda bodas swerve into traffic to avoid it."
        />
      </Field>
      <Field label="Voice note" optional hint="Speak instead of typing, then check the transcript.">
        <VoiceNote value={voice} onChange={onVoice} maxSeconds={maxAudioSeconds} />
      </Field>
      {tooShort && (
        <Text className="text-[13px] text-ink-3">
          Add at least a few words (or a voice note) to continue.
        </Text>
      )}
    </View>
  );
}

function CategoryTile({
  selected,
  onPress,
  title,
  hint,
  mark,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  hint: string;
  mark: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-xl border px-4 py-3',
        selected ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface active:bg-sunken'
      )}>
      <View className="size-4 items-center justify-center">{mark}</View>
      <View className="flex-1">
        <Text className="font-semibold text-[14.5px]">{title}</Text>
        <Text className="text-[12.5px] text-ink-3">{hint}</Text>
      </View>
      <View
        className={cn(
          'size-5 items-center justify-center rounded-full border-2',
          selected ? 'border-accent' : 'border-line-strong'
        )}>
        {selected && <View className="size-2.5 rounded-full bg-accent" />}
      </View>
    </Pressable>
  );
}

export function LocationStep({
  location,
  locationSource,
  accuracy,
  geoState,
  geoError,
  known,
  locationNote,
  onLocationNote,
  onLocateMe,
  onPin,
  onClear,
  onMapTouch,
}: {
  location: LatLon | null;
  locationSource: LocationSource;
  accuracy: number | null;
  geoState: GeoState;
  geoError: string | null;
  known: MapFeatures | null;
  locationNote: string;
  onLocationNote: (v: string) => void;
  onLocateMe: () => void;
  onPin: (v: LatLon) => void;
  onClear: () => void;
  onMapTouch: (touching: boolean) => void;
}) {
  return (
    <View className="gap-4">
      <StepTitle hint="Use your location if you're standing at the hazard, or tap the map where it is. You can skip this; the report goes to the unlocated list.">
        Where is it?
      </StepTitle>
      <View className="flex-row flex-wrap gap-2">
        <Button
          title="Use my current location"
          variant="secondary"
          icon={Gps}
          loading={geoState === 'locating'}
          onPress={onLocateMe}
        />
        {location && <Button title="Clear" variant="ghost" onPress={onClear} />}
      </View>
      {geoError && <Callout tone="warn">{geoError}</Callout>}
      <LocationPicker
        value={location}
        recenter={locationSource === 'device_gps'}
        onChange={onPin}
        context={known}
        onTouchingChange={onMapTouch}
        className="h-[300px] overflow-hidden rounded-xl border border-line"
      />
      <Text className="text-[12px] text-ink-3">
        Faint dots are hazards others have already reported. Reporting the same one again still
        helps.
      </Text>
      <View className="flex-row items-center gap-1.5">
        <LocationIcon size={16} color={colors.ink[3]} />
        <Text className="flex-1 text-[13px] text-ink-2">
          {location
            ? `${formatCoords(location.lat, location.lon)} · ${
                locationSource === 'device_gps'
                  ? `device location${accuracy ? ` (±${accuracy} m)` : ''}`
                  : 'pin placed on map'
              }`
            : 'No location set'}
        </Text>
      </View>
      <Field
        label="Landmark or street"
        optional
        hint="Helps reviewers find it, e.g. “Kalerwe market, opposite the fuel station”.">
        <TextInput
          value={locationNote}
          onChangeText={onLocationNote}
          maxLength={200}
          returnKeyType="done"
        />
      </Field>
    </View>
  );
}

export function ReviewStep({
  photo,
  category,
  description,
  voice,
  location,
  locationNote,
  submitting,
  progress,
  error,
  onEdit,
}: {
  photo: Photo;
  category: HazardCategory | 'auto';
  description: string;
  voice: VoiceNoteValue | null;
  location: LatLon | null;
  locationNote: string;
  submitting: boolean;
  progress: number;
  error: string | null;
  onEdit: (step: number) => void;
}) {
  const none = <Text className="text-[14px] text-ink-3">None</Text>;
  return (
    <View className="gap-4">
      <StepTitle>Check and submit</StepTitle>
      <View className="overflow-hidden rounded-xl border border-line bg-surface">
        <PhotoPreview photo={photo} maxHeight={260} />
        <ReviewRow label="Type" onEdit={() => onEdit(1)}>
          <Text className="text-[14px]">
            {category === 'auto' ? 'Not sure, AI will suggest' : CATEGORY_LABEL[category]}
          </Text>
        </ReviewRow>
        <ReviewRow label="Description" onEdit={() => onEdit(1)}>
          {description.trim() ? <Text className="text-[14px]">{description.trim()}</Text> : none}
        </ReviewRow>
        {voice && (
          <ReviewRow label="Voice note" onEdit={() => onEdit(1)}>
            <Text className="text-[14px]">
              {Math.round(voice.durationMs / 1000)} s
              {voice.transcript.trim() ? ` · “${voice.transcript.trim()}”` : ''}
            </Text>
          </ReviewRow>
        )}
        <ReviewRow label="Location" onEdit={() => onEdit(2)}>
          {location ? (
            <Text className="text-[14px]">{formatCoords(location.lat, location.lon)}</Text>
          ) : (
            <Text className="text-[14px] text-ink-3">Not shared</Text>
          )}
          {locationNote.trim() !== '' && (
            <Text className="text-[13px] text-ink-3">{locationNote.trim()}</Text>
          )}
        </ReviewRow>
      </View>
      <Callout>
        MtaaSense is an independent community tool, not a government service. Submitting here does
        not report the hazard to an authority. Your photo stays private to reviewers; the public map
        shows only the hazard type and location.
      </Callout>
      {submitting && (
        <View className="gap-1.5">
          <Text className="text-[13px] text-ink-2">
            {progress < 1 ? 'Uploading your report…' : 'Saving…'}
          </Text>
          <ProgressBar value={progress} />
        </View>
      )}
      {error && (
        <Callout tone="danger" title="Not submitted yet">
          {error}
        </Callout>
      )}
    </View>
  );
}

function ReviewRow({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: ReactNode;
  onEdit: () => void;
}) {
  return (
    <View className="flex-row items-start gap-3 border-t border-line px-4 py-3">
      <Text className="w-24 text-[14px] text-ink-3">{label}</Text>
      <View className="flex-1 gap-0.5">{children}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label.toLowerCase()}`}
        hitSlop={10}
        onPress={onEdit}>
        <Edit2 size={15} color={colors.ink[3]} />
      </Pressable>
    </View>
  );
}
