import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingStatus,
} from 'expo-audio';
import { Mic, Pause, Play, Square, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Callout, ProgressBar } from '@/components/ui/feedback';
import { Text, TextInput } from '@/components/ui/Text';
import { api, ApiError, appendFile } from '@/lib/api';
import { errorLabel, mmss } from '@/lib/format';

export interface VoiceNoteValue {
  audioId: string;
  claimToken: string;
  durationMs: number;
  machineTranscript: string | null;
  transcript: string;
  uri: string;
}

type Phase = 'idle' | 'recording' | 'uploading';

export function VoiceNote({
  value,
  onChange,
  maxSeconds,
}: {
  value: VoiceNoteValue | null;
  onChange: (v: VoiceNoteValue | null) => void;
  maxSeconds: number;
}) {
  // The recorder reports `isFinished` both when the user stops and when `forDuration` runs out.
  const onStatus = useRef<(status: RecordingStatus) => void>(() => undefined);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) =>
    onStatus.current(status)
  );
  const recorderState = useAudioRecorderState(recorder, 250);
  const recording = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const elapsed = recorderState.durationMillis / 1000;

  async function send(uri: string) {
    setPhase('uploading');
    setProgress(0);
    setError(null);
    setNotice(null);
    const form = new FormData();
    // The recording preset writes AAC in an MPEG-4 container.
    appendFile(form, 'audio', { uri, name: 'voice.m4a', type: 'audio/mp4' });
    try {
      const res = await api.transcribe(form, setProgress);
      if (!res.claim_token)
        throw new ApiError(500, 'no_claim', "The recording couldn't be attached.");
      onChange({
        audioId: res.audio_id,
        claimToken: res.claim_token,
        durationMs: res.duration_ms,
        machineTranscript: res.transcript,
        transcript: res.transcript ?? '',
        uri,
      });
      if (res.transcript === null) {
        setNotice(
          `The voice note is attached, but it couldn't be transcribed (${errorLabel(res.error_code)}) Type what you said below.`
        );
      } else if (res.transcript === '') {
        setNotice('No speech was detected. You can type a description instead.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The recording couldn't be uploaded.");
    } finally {
      setPhase('idle');
    }
  }

  async function start() {
    setError(null);
    setBlocked(false);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setBlocked(!permission.canAskAgain);
      setError('Microphone access was declined. You can type a description instead.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // Stops itself at the server's limit rather than recording something the API will refuse.
      recorder.record({ forDuration: maxSeconds });
      recording.current = true;
      setPhase('recording');
    } catch {
      setError("Recording couldn't start on this device.");
    }
  }

  // Runs once per recording, whichever of the stop button and the finished event gets here first.
  async function finish(uri: string | null) {
    if (!recording.current) return;
    recording.current = false;
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!uri) {
      setPhase('idle');
      setError("The recording couldn't be saved. Try again.");
      return;
    }
    void send(uri);
  }

  async function stop() {
    await recorder.stop();
    void finish(recorder.uri);
  }

  useEffect(() => {
    onStatus.current = (status) => {
      if (status.isFinished) void finish(status.url ?? recorder.uri);
    };
  });

  if (value) {
    return (
      <View className="gap-3 rounded-xl border border-line bg-surface p-3">
        <View className="flex-row items-center gap-3">
          <Playback uri={value.uri} durationMs={value.durationMs} />
          <Button
            title="Remove"
            variant="ghost"
            size="sm"
            icon={Trash2}
            onPress={() => {
              onChange(null);
              setNotice(null);
            }}
          />
        </View>
        {notice && <Callout tone="warn">{notice}</Callout>}
        <View className="gap-1.5">
          <Text className="font-semibold text-[13px]">
            Transcript <Text className="text-[13px] text-ink-3">· check and correct it</Text>
          </Text>
          <TextInput
            value={value.transcript}
            onChangeText={(transcript) => onChange({ ...value, transcript })}
            maxLength={4000}
            multiline
            placeholder="What you said in the voice note"
            className="min-h-[88px]"
            textAlignVertical="top"
          />
          {value.machineTranscript !== null && (
            <Text className="text-[12px] text-ink-3">
              Transcribed by Muse Voice Transcribe. English is tested; other languages may be less
              reliable.
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View className="gap-2.5">
      {phase === 'recording' ? (
        <View className="flex-row items-center gap-3">
          <Button
            title={`Stop · ${mmss(elapsed)} / ${mmss(maxSeconds)}`}
            variant="danger"
            icon={Square}
            onPress={() => void stop()}
          />
          <View className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-full bg-danger" />
            <Text className="text-[13px] text-danger">Recording</Text>
          </View>
        </View>
      ) : (
        <Button
          title="Record a voice note"
          variant="secondary"
          icon={Mic}
          className="self-start"
          disabled={phase === 'uploading'}
          onPress={() => void start()}
        />
      )}
      {phase === 'uploading' && (
        <View className="gap-1.5">
          <Text className="text-[13px] text-ink-2">
            {progress < 1 ? 'Uploading recording…' : 'Transcribing with Muse Voice Transcribe…'}
          </Text>
          <ProgressBar value={progress} />
        </View>
      )}
      {error && (
        <Callout tone="danger">
          {error}
          {blocked && (
            <Text
              className="text-[13.5px] text-accent underline"
              onPress={() => void Linking.openSettings()}>
              {' '}
              Open Settings
            </Text>
          )}
        </Callout>
      )}
    </View>
  );
}

function Playback({ uri, durationMs }: { uri: string; durationMs: number }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const total = durationMs / 1000;
  const playing = status.playing;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
      onPress={() => {
        if (playing) player.pause();
        else {
          if (status.didJustFinish || status.currentTime >= total - 0.1) void player.seekTo(0);
          player.play();
        }
      }}
      className="h-11 flex-1 flex-row items-center gap-2.5 rounded-xl bg-sunken px-3 active:opacity-80">
      <View className="size-7 items-center justify-center rounded-full bg-accent">
        {playing ? (
          <Pause size={13} color="#fff" fill="#fff" />
        ) : (
          <Play size={13} color="#fff" fill="#fff" />
        )}
      </View>
      <View className="h-1 flex-1 overflow-hidden rounded-full bg-line">
        <View
          className="h-full bg-accent"
          style={{ width: `${total ? Math.min(100, (status.currentTime / total) * 100) : 0}%` }}
        />
      </View>
      <Text className="font-mono text-[12px] text-ink-2">
        {mmss(playing ? status.currentTime : total)}
      </Text>
    </Pressable>
  );
}
