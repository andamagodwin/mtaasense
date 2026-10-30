"use client";

import { Mic, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "@/lib/api";
import { errorLabel } from "@/lib/format";
import { Button } from "../ui/button";
import { Callout, ProgressBar, Spinner } from "../ui/feedback";
import { Textarea } from "../ui/field";

export interface VoiceNoteValue {
  audioId: string;
  claimToken: string;
  durationMs: number;
  machineTranscript: string | null;
  transcript: string;
  previewUrl: string;
}

type Phase = "idle" | "recording" | "uploading";

const noopSubscribe = () => () => undefined;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

export function VoiceNote({
  value,
  onChange,
  maxSeconds,
}: {
  value: VoiceNoteValue | null;
  onChange: (v: VoiceNoteValue | null) => void;
  maxSeconds: number;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canRecord = useSyncExternalStore(
    noopSubscribe,
    () => !!navigator.mediaDevices && !!pickMimeType(),
    () => false,
  );
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function send(blob: Blob, name: string) {
    setPhase("uploading");
    setProgress(0);
    setError(null);
    setNotice(null);
    const form = new FormData();
    form.append("audio", blob, name);
    try {
      const res = await api.transcribe(form, setProgress);
      if (!res.claim_token) throw new ApiError(500, "no_claim", "The recording couldn't be attached.");
      onChange({
        audioId: res.audio_id,
        claimToken: res.claim_token,
        durationMs: res.duration_ms,
        machineTranscript: res.transcript,
        transcript: res.transcript ?? "",
        previewUrl: URL.createObjectURL(blob),
      });
      if (res.transcript === null) {
        setNotice(`The voice note is attached, but it couldn't be transcribed (${errorLabel(res.error_code)}) Type what you said below.`);
      } else if (res.transcript === "") {
        setNotice("No speech was detected. You can type a description instead.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The recording couldn't be uploaded.");
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        if (blob.size < 1000) {
          setPhase("idle");
          setError("The recording was empty. Try again, a little closer to the microphone.");
          return;
        }
        void send(blob, type.includes("mp4") ? "voice.m4a" : type.includes("ogg") ? "voice.ogg" : "voice.webm");
      };
      recorder.current = rec;
      rec.start(250);
      setElapsed(0);
      setPhase("recording");
      const started = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        setElapsed(s);
        if (s >= maxSeconds && rec.state === "recording") rec.stop();
      }, 250);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser settings, or upload a recording instead."
          : name === "NotFoundError"
            ? "No microphone was found on this device."
            : "Recording isn't available in this browser. You can upload a recording instead.",
      );
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function clear() {
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    setNotice(null);
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (value) {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-paper/60 p-3">
        <div className="flex items-center gap-3">
          <audio src={value.previewUrl} controls className="h-9 min-w-0 flex-1" />
          <Button variant="ghost" size="sm" onClick={clear} icon={<Trash2 className="size-4" />} aria-label="Remove voice note">
            Remove
          </Button>
        </div>
        {notice && <Callout tone="warn">{notice}</Callout>}
        <div className="space-y-1.5">
          <label htmlFor="transcript" className="text-[13px] font-medium">
            Transcript <span className="font-normal text-ink-3">— check and correct it before submitting</span>
          </label>
          <Textarea
            id="transcript"
            value={value.transcript}
            onChange={(e) => onChange({ ...value, transcript: e.target.value })}
            maxLength={4000}
            placeholder="What you said in the voice note"
          />
          {value.machineTranscript !== null && (
            <p className="text-[12px] text-ink-3">Transcribed by Muse Voice Transcribe. English is tested; other languages may be less reliable.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {phase === "recording" ? (
          <Button variant="danger" onClick={stop} icon={<Square className="size-3.5 fill-current" />}>
            Stop · {mmss(elapsed)} / {mmss(maxSeconds)}
          </Button>
        ) : (
          canRecord && (
            <Button variant="secondary" onClick={() => void start()} disabled={phase === "uploading"} icon={<Mic className="size-4" />}>
              Record a voice note
            </Button>
          )
        )}
        <Button
          variant="ghost"
          onClick={() => fileInput.current?.click()}
          disabled={phase !== "idle"}
          icon={<Upload className="size-4" />}
        >
          Upload audio
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void send(file, file.name);
          }}
        />
        {phase === "recording" && (
          <span className="flex items-center gap-1.5 text-[13px] text-danger">
            <span className="size-2 animate-pulse rounded-full bg-danger" /> Recording
          </span>
        )}
      </div>
      {phase === "uploading" && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <Spinner className="size-3.5" /> {progress < 1 ? "Uploading recording…" : "Transcribing with Muse Voice Transcribe…"}
          </p>
          <ProgressBar value={progress} />
        </div>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}
