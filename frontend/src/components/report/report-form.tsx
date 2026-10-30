"use client";

import { clsx } from "clsx";
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus, LocateFixed, MapPin, Pencil, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CATEGORY_HINT, CATEGORY_LABEL, formatCoords } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { prepareForUpload, sniffImage } from "@/lib/image";
import type { HazardCategory, LatLon, LocationSource } from "@/lib/types";
import { CategoryDot } from "../badges";
import { LocationPicker } from "../map/location-picker";
import { Button } from "../ui/button";
import { Callout, ProgressBar } from "../ui/feedback";
import { Field, Input, Textarea } from "../ui/field";
import { VoiceNote, type VoiceNoteValue } from "./voice-note";

const STEPS = ["Photo", "Describe", "Location", "Review"] as const;
const CATEGORIES: HazardCategory[] = ["pothole", "road_surface_damage", "blocked_drainage", "flooding"];
const UGANDA = { minLat: -1.6, maxLat: 4.4, minLon: 29.4, maxLon: 35.2 };

interface Photo {
  file: File;
  url: string;
}

export function ReportForm() {
  const router = useRouter();
  const config = useApi(() => api.config(), "config");
  const known = useApi(() => api.mapFeatures({ include_unreviewed: true }), "known-hazards");
  const maxImageMb = config.data?.max_image_mb ?? 15;

  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [category, setCategory] = useState<HazardCategory | "auto">("auto");
  const [description, setDescription] = useState("");
  const [voice, setVoice] = useState<VoiceNoteValue | null>(null);
  const [location, setLocation] = useState<LatLon | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>("none");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locationNote, setLocationNote] = useState("");
  const [geoState, setGeoState] = useState<"idle" | "locating" | "error">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  async function choosePhoto(file: File | undefined) {
    setPhotoError(null);
    if (!file) return;
    if (file.size > maxImageMb * 1024 * 1024) return setPhotoError(`Photos must be under ${maxImageMb} MB.`);
    const kind = await sniffImage(file);
    if (!kind) return setPhotoError("Please choose a JPEG, PNG or WebP photo. (HEIC photos: set your camera to “Most compatible”.)");
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeoState("error");
      setGeoError("This browser can't share a location. Tap the map instead.");
      return;
    }
    setGeoState("locating");
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
        if (lat < UGANDA.minLat || lat > UGANDA.maxLat || lon < UGANDA.minLon || lon > UGANDA.maxLon) {
          setGeoState("error");
          setGeoError("Your device location is outside Uganda. Tap the map to place the pin at the hazard instead.");
          return;
        }
        setLocation({ lat, lon });
        setLocationSource("device_gps");
        setAccuracy(Math.round(acc));
        setGeoState("idle");
      },
      (err) => {
        setGeoState("error");
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was declined. You can tap the map instead, or skip this step."
            : "We couldn't get a location fix. Tap the map instead, or skip this step.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  const textLength = description.trim().length;
  const transcriptLength = voice?.transcript.trim().length ?? 0;
  const canContinue = [!!photo, textLength >= 5 || transcriptLength >= 5, true, true][step];

  function go(next: number) {
    setStep(next);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit() {
    if (!photo) return;
    setSubmitting(true);
    setSubmitError(null);
    setProgress(0);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const prepared = await prepareForUpload(photo.file);
      const form = new FormData();
      form.append("image", prepared.blob, prepared.resized ? "photo.jpg" : photo.file.name || "photo");
      form.append("description", description.trim());
      if (voice) {
        form.append("audio_id", voice.audioId);
        form.append("audio_claim_token", voice.claimToken);
        if (voice.transcript.trim()) form.append("voice_transcript", voice.transcript.trim());
      }
      if (category !== "auto") form.append("category", category);
      if (location) {
        form.append("lat", String(location.lat));
        form.append("lon", String(location.lon));
        form.append("location_source", locationSource);
        if (accuracy !== null) form.append("location_accuracy_m", String(accuracy));
      }
      if (locationNote.trim()) form.append("location_note", locationNote.trim());
      const created = await api.submitReport(form, idempotencyKey.current, setProgress);
      router.push(`/track/${created.id}#${created.receipt_token}`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Submitting failed. Your report is still here — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div ref={top} className="mx-auto w-full max-w-xl scroll-mt-20 px-4 pb-28 pt-6 sm:pt-10">
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Report a hazard</h1>
        <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">
          A photo and a few words are enough. Voice notes and location are optional.
        </p>
      </div>

      <ol className="mb-6 grid grid-cols-4 gap-1.5" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}>
            <div className={clsx("h-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-line")} />
            <span className={clsx("mt-1.5 block text-[12px]", i === step ? "font-medium text-ink" : "text-ink-3")}>
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      <div key={step} className="animate-rise space-y-5">
        {step === 0 && (
          <section className="space-y-4" aria-labelledby="photo-heading">
            <h2 id="photo-heading" className="text-[17px] font-semibold">Add a photo of the problem</h2>
            {photo ? (
              <div className="overflow-hidden rounded-xl border border-line bg-[#16140f]">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={photo.url} alt="Selected photo preview" className="max-h-[52vh] w-full object-contain" />
                <div className="flex items-center justify-between gap-2 bg-surface px-3 py-2 text-[13px]">
                  <span className="truncate text-ink-2">{photo.file.name || "Photo"} · {(photo.file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <Button variant="ghost" size="sm" onClick={() => galleryInput.current?.click()}>
                    Change
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => cameraInput.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-accent text-white">
                    <Camera className="size-5" />
                  </span>
                  <span className="font-medium">Take a photo</span>
                  <span className="text-[12.5px] text-ink-3">Opens your camera on a phone</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInput.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-sunken text-ink-2">
                    <ImagePlus className="size-5" />
                  </span>
                  <span className="font-medium">Choose a photo</span>
                  <span className="text-[12.5px] text-ink-3">JPEG, PNG or WebP, up to {maxImageMb} MB</span>
                </button>
              </div>
            )}
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ""; }} />
            {photoError && <Callout tone="danger">{photoError}</Callout>}
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              Tip: step back so the surroundings are visible, and avoid capturing faces or number plates.
            </p>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5" aria-labelledby="describe-heading">
            <h2 id="describe-heading" className="text-[17px] font-semibold">What did you see?</h2>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Type of problem</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {CATEGORIES.map((c) => (
                  <CategoryTile key={c} selected={category === c} onClick={() => setCategory(c)} title={CATEGORY_LABEL[c]} hint={CATEGORY_HINT[c]} dot={<CategoryDot category={c} className="size-2.5" />} />
                ))}
                <CategoryTile
                  selected={category === "auto"}
                  onClick={() => setCategory("auto")}
                  title="Not sure"
                  hint="Let Muse Spark suggest a category"
                  dot={<Sparkles className="size-3.5 text-accent" />}
                  className="sm:col-span-2"
                />
              </div>
            </fieldset>
            <Field label="Description" htmlFor="description" hint={`${textLength}/2000 · e.g. how big it is, how long it has been there, who it affects.`}>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                placeholder="Deep pothole on the left lane outside the school gate; boda bodas swerve into traffic to avoid it."
              />
            </Field>
            <Field label="Voice note" optional hint="Speak instead of typing, then check the transcript.">
              <VoiceNote value={voice} onChange={setVoice} maxSeconds={config.data?.max_audio_seconds ?? 120} />
            </Field>
            {!canContinue && (textLength > 0 || transcriptLength > 0) && (
              <p className="text-[13px] text-ink-3">Add at least a few words (or a voice note) to continue.</p>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4" aria-labelledby="location-heading">
            <div>
              <h2 id="location-heading" className="text-[17px] font-semibold">Where is it?</h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
                Tap the map at the hazard, or use your device location if you’re standing at it. You can skip this — the
                report will be kept in the unlocated list.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={useMyLocation} loading={geoState === "locating"} icon={<LocateFixed className="size-4" />}>
                Use my current location
              </Button>
              {location && (
                <Button variant="ghost" onClick={() => { setLocation(null); setLocationSource("none"); setAccuracy(null); }}>
                  Clear location
                </Button>
              )}
            </div>
            {geoError && <Callout tone="warn">{geoError}</Callout>}
            <LocationPicker
              value={location}
              onChange={(v) => { setLocation(v); setLocationSource("map_pin"); setAccuracy(null); }}
              context={known.data}
              className="h-[320px] overflow-hidden rounded-xl border border-line"
            />
            <p className="text-[12px] text-ink-3">Faint dots are hazards others have already reported — reporting the same one again still helps.</p>
            <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <MapPin className="size-4 text-ink-3" />
              {location
                ? <>{formatCoords(location.lat, location.lon)} · {locationSource === "device_gps" ? `device location${accuracy ? ` (±${accuracy} m)` : ""}` : "pin placed on map"}</>
                : "No location set"}
            </p>
            <Field label="Landmark or street" optional htmlFor="landmark" hint="Helps reviewers find it, e.g. “Kalerwe market, opposite the fuel station”.">
              <Input id="landmark" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} maxLength={200} />
            </Field>
          </section>
        )}

        {step === 3 && photo && (
          <section className="space-y-4" aria-labelledby="review-heading">
            <h2 id="review-heading" className="text-[17px] font-semibold">Check and submit</h2>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img src={photo.url} alt="Photo to submit" className="max-h-64 w-full bg-[#16140f] object-contain" />
              <dl className="divide-y divide-line text-sm">
                <ReviewRow label="Type" onEdit={() => go(1)}>
                  {category === "auto" ? "Not sure — AI will suggest" : CATEGORY_LABEL[category]}
                </ReviewRow>
                <ReviewRow label="Description" onEdit={() => go(1)}>
                  {description.trim() || <span className="text-ink-3">None</span>}
                </ReviewRow>
                {voice && (
                  <ReviewRow label="Voice note" onEdit={() => go(1)}>
                    {(voice.durationMs / 1000).toFixed(0)} s{voice.transcript.trim() ? ` · “${voice.transcript.trim()}”` : ""}
                  </ReviewRow>
                )}
                <ReviewRow label="Location" onEdit={() => go(2)}>
                  {location ? formatCoords(location.lat, location.lon) : <span className="text-ink-3">Not shared</span>}
                  {locationNote.trim() && <span className="block text-ink-3">{locationNote.trim()}</span>}
                </ReviewRow>
              </dl>
            </div>
            <Callout tone="neutral">
              MtaaSense is an independent community tool, not a government service. Submitting here does not report the
              hazard to an authority. Your photo is kept private to reviewers; the public map shows only the hazard type and
              location.
            </Callout>
            {submitting && (
              <div className="space-y-1.5">
                <p className="text-[13px] text-ink-2">{progress < 1 ? "Uploading your report…" : "Saving…"}</p>
                <ProgressBar value={progress} />
              </div>
            )}
            {submitError && <Callout tone="danger" title="Not submitted yet">{submitError}</Callout>}
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/92 backdrop-blur-md sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3 sm:px-0">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => go(step - 1)} disabled={submitting} icon={<ArrowLeft className="size-4" />}>
              Back
            </Button>
          ) : <span />}
          {step < 3 ? (
            <Button onClick={() => go(step + 1)} disabled={!canContinue} size="lg">
              {step === 2 && !location ? "Skip location" : "Continue"}
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={() => void submit()} loading={submitting} size="lg" icon={<Check className="size-4" />}>
              {submitError ? "Try again" : "Submit report"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryTile({ selected, onClick, title, hint, dot, className }: {
  selected: boolean; onClick: () => void; title: string; hint: string; dot: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[border,background,box-shadow]",
        selected ? "border-accent bg-accent-soft/50 shadow-[0_0_0_1px_var(--color-accent)]" : "border-line-strong bg-surface hover:border-ink-3",
        className,
      )}
    >
      <span className="mt-1.5 grid size-3 place-items-center">{dot}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[12.5px] text-ink-3">{hint}</span>
      </span>
    </button>
  );
}

function ReviewRow({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <dt className="w-24 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{children}</dd>
      <button type="button" onClick={onEdit} className="text-ink-3 hover:text-ink" aria-label={`Edit ${label.toLowerCase()}`}>
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}
