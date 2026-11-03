import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { api, ApiError, appendFile } from '@/lib/api';
import { cn } from '@/lib/cn';
import { UGANDA_BOUNDS } from '@/lib/config';
import { useApi } from '@/lib/hooks';
import { prepareForUpload, type Photo } from '@/lib/photo';
import { addReceipt } from '@/lib/receipts';
import type { HazardCategory, LatLon, LocationSource } from '@/lib/types';

import { DescribeStep, LocationStep, PhotoStep, ReviewStep } from './steps';
import type { VoiceNoteValue } from './VoiceNote';

const STEPS = ['Photo', 'Describe', 'Location', 'Review'] as const;

export type GeoState = 'idle' | 'locating' | 'error';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export function ReportFlow() {
  const config = useApi((signal) => api.config(signal), 'config');
  const known = useApi((signal) => api.mapFeatures(signal), 'known-hazards');

  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [category, setCategory] = useState<HazardCategory | 'auto'>('auto');
  const [description, setDescription] = useState('');
  const [voice, setVoice] = useState<VoiceNoteValue | null>(null);
  const [location, setLocation] = useState<LatLon | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>('none');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locationNote, setLocationNote] = useState('');
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapTouched, setMapTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  const textLength = description.trim().length;
  const transcriptLength = voice?.transcript.trim().length ?? 0;
  const canContinue = [!!photo && !preparing, textLength >= 5 || transcriptLength >= 5, true, true][
    step
  ];

  function go(next: number) {
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  async function pickPhoto(source: 'camera' | 'library') {
    setPhotoError(null);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPhotoError(
            'Camera access was declined. You can choose a photo from your library instead.'
          );
          return;
        }
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
      setPreparing(true);
      setPhoto(
        await prepareForUpload({ uri: asset.uri, width: asset.width, height: asset.height })
      );
    } catch {
      setPhotoError(
        source === 'camera'
          ? "The camera isn't available on this device. Choose a photo from your library instead."
          : "That photo couldn't be opened. Try another one."
      );
    } finally {
      setPreparing(false);
    }
  }

  async function locateMe() {
    setGeoState('locating');
    setGeoError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setGeoState('error');
        setGeoError(
          'Location permission was declined. Tap the map at the hazard instead, or skip this step.'
        );
        return;
      }
      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        15_000
      );
      const { latitude: lat, longitude: lon, accuracy: acc } = position.coords;
      const b = config.data?.map_bounds;
      const [minLat, maxLat, minLon, maxLon] = b
        ? [b.min_lat, b.max_lat, b.min_lon, b.max_lon]
        : [UGANDA_BOUNDS.minLat, UGANDA_BOUNDS.maxLat, UGANDA_BOUNDS.minLon, UGANDA_BOUNDS.maxLon];
      if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) {
        setGeoState('error');
        setGeoError(
          'Your location is outside Uganda. Tap the map to place the pin at the hazard instead.'
        );
        return;
      }
      setLocation({ lat, lon });
      setLocationSource('device_gps');
      setAccuracy(acc === null ? null : Math.round(acc));
      setGeoState('idle');
    } catch {
      setGeoState('error');
      setGeoError(
        "We couldn't get a location fix. Tap the map at the hazard instead, or skip this step."
      );
    }
  }

  function reset() {
    setStep(0);
    setPhoto(null);
    setCategory('auto');
    setDescription('');
    setVoice(null);
    setLocation(null);
    setLocationSource('none');
    setAccuracy(null);
    setLocationNote('');
    setGeoState('idle');
    setGeoError(null);
    setProgress(0);
    setSubmitError(null);
    idempotencyKey.current = null;
  }

  async function submit() {
    if (!photo) return;
    setSubmitting(true);
    setSubmitError(null);
    setProgress(0);
    // One key per report, reused on retries, so a resend after a dropped connection can't file it twice.
    idempotencyKey.current ??= Crypto.randomUUID();
    try {
      const form = new FormData();
      appendFile(form, 'image', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' });
      form.append('description', description.trim());
      if (voice) {
        form.append('audio_id', voice.audioId);
        form.append('audio_claim_token', voice.claimToken);
        if (voice.transcript.trim()) form.append('voice_transcript', voice.transcript.trim());
      }
      if (category !== 'auto') form.append('category', category);
      if (location) {
        form.append('lat', String(location.lat));
        form.append('lon', String(location.lon));
        form.append('location_source', locationSource);
        if (accuracy !== null) form.append('location_accuracy_m', String(accuracy));
      }
      if (locationNote.trim()) form.append('location_note', locationNote.trim());
      const created = await api.submitReport(form, idempotencyKey.current, setProgress);
      await addReceipt(
        {
          id: created.id,
          reference: created.reference,
          createdAt: new Date().toISOString(),
          status: created.status,
          category: category === 'auto' ? null : category,
          summary: null,
          locationNote: locationNote.trim() || null,
        },
        created.receipt_token
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      router.push({ pathname: '/reports/[id]', params: { id: created.id } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // The API ties a submission key to the network address that first used it. If an earlier attempt got
        // through before the phone switched networks, the key can never be reused, so the retry starts afresh.
        idempotencyKey.current = null;
        setSubmitError(
          'Your connection changed while sending. Tap Try again to send the report again.'
        );
      } else {
        setSubmitError(
          err instanceof ApiError
            ? err.message
            : 'Submitting failed. Your report is still here, so try again.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          ref={scroll}
          scrollEnabled={!mapTouched}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-6 px-4 pb-8 pt-3">
          <View className="gap-1">
            <Text className="font-bold text-[28px] tracking-tight">Report a hazard</Text>
            <Text className="text-[14.5px] leading-[21px] text-ink-2">
              A photo and a few words are enough. Voice notes and location are optional.
            </Text>
          </View>

          <View
            className="flex-row gap-1.5"
            accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((label, i) => (
              <View key={label} className="flex-1 gap-1.5">
                <View className={cn('h-1 rounded-full', i <= step ? 'bg-accent' : 'bg-line')} />
                <Text
                  className={cn(
                    'text-[12px]',
                    i === step ? 'font-semibold text-ink' : 'text-ink-3'
                  )}
                  numberOfLines={1}>
                  {i + 1}. {label}
                </Text>
              </View>
            ))}
          </View>

          {step === 0 && (
            <PhotoStep
              photo={photo}
              preparing={preparing}
              error={photoError}
              maxImageMb={config.data?.max_image_mb ?? 15}
              onPick={(source) => void pickPhoto(source)}
            />
          )}
          {step === 1 && (
            <DescribeStep
              category={category}
              onCategory={setCategory}
              description={description}
              onDescription={setDescription}
              voice={voice}
              onVoice={setVoice}
              maxAudioSeconds={config.data?.max_audio_seconds ?? 120}
              tooShort={!canContinue && (textLength > 0 || transcriptLength > 0)}
            />
          )}
          {step === 2 && (
            <LocationStep
              location={location}
              locationSource={locationSource}
              accuracy={accuracy}
              geoState={geoState}
              geoError={geoError}
              known={known.data}
              locationNote={locationNote}
              onLocationNote={setLocationNote}
              onLocateMe={() => void locateMe()}
              onPin={(value) => {
                setLocation(value);
                setLocationSource('map_pin');
                setAccuracy(null);
              }}
              onClear={() => {
                setLocation(null);
                setLocationSource('none');
                setAccuracy(null);
              }}
              onMapTouch={setMapTouched}
            />
          )}
          {step === 3 && photo && (
            <ReviewStep
              photo={photo}
              category={category}
              description={description}
              voice={voice}
              location={location}
              locationNote={locationNote}
              submitting={submitting}
              progress={progress}
              error={submitError}
              onEdit={go}
            />
          )}
        </ScrollView>

        <View className="flex-row items-center justify-between gap-3 border-t border-line bg-paper px-4 py-3">
          {step > 0 ? (
            <Button
              title="Back"
              variant="ghost"
              icon={ArrowLeft}
              disabled={submitting}
              onPress={() => go(step - 1)}
            />
          ) : (
            <View />
          )}
          {step < 3 ? (
            <Button
              title={step === 2 && !location ? 'Skip location' : 'Continue'}
              size="lg"
              iconRight={ArrowRight}
              disabled={!canContinue}
              onPress={() => go(step + 1)}
            />
          ) : (
            <Button
              title={submitError ? 'Try again' : 'Submit report'}
              size="lg"
              icon={Check}
              loading={submitting}
              onPress={() => void submit()}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
