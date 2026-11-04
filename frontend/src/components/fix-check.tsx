"use client";

import { clsx } from "clsx";
import { Camera } from "iconsax-reactjs";
import { useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { colors } from "@/lib/colors";
import { errorLabel, FIX_VERDICT_LABEL, formatDateTime, pct, SAME_PLACE_LABEL } from "@/lib/format";
import type { FixCheck, FixImage, FixVerdict } from "@/lib/types";
import { Badge, PrivacyBlurredBadge, ProvenanceBadge } from "./badges";
import { Button } from "./ui/button";
import { Callout, Spinner } from "./ui/feedback";
import { Input } from "./ui/field";

const VERDICT_TONE: Record<FixVerdict, string> = {
  repaired: "border-success-line bg-success-soft text-success-ink",
  partially_repaired: "border-warn-line bg-warn-soft text-warn-ink",
  not_repaired: "border-danger-line bg-danger-soft text-danger",
  different_place: "border-line-strong bg-surface text-ink-2",
  insufficient_evidence: "border-line bg-sunken text-ink-3",
};

export function FixVerdictBadge({ verdict }: { verdict: FixVerdict }) {
  return <Badge className={VERDICT_TONE[verdict]}>{FIX_VERDICT_LABEL[verdict]}</Badge>;
}

/** A photo with SAM's outline of the hazard concept drawn over it. */
function OutlinedPhoto({ label, photo }: { label: string; photo: FixImage }) {
  const W = photo.width ?? photo.image?.width ?? 1;
  const H = photo.height ?? photo.image?.height ?? 1;
  const regions = photo.regions ?? [];
  return (
    <figure className="min-w-0 space-y-1.5">
      <div className="relative overflow-hidden rounded-xl border border-line bg-photo">
        {photo.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, signed evidence URLs bypass the optimizer
          <img src={photo.image.url} alt={label} className="block aspect-[4/3] w-full object-contain" />
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-sunken text-center">
            <Spinner className="size-5 text-accent" />
            <p className="px-4 text-[12px] text-ink-3">Blurring faces and number plates…</p>
          </div>
        )}
        {regions.length > 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 size-full animate-mask-in" aria-hidden>
            {regions.map((r) => (
              <path
                key={r.object_id}
                d={r.mask.svg_path}
                transform={`translate(${r.box.left} ${r.box.top}) scale(${(r.box.right - r.box.left) / r.mask.width} ${(r.box.bottom - r.box.top) / r.mask.height}) translate(0.5 0.5)`}
                fill={colors.highlight.DEFAULT}
                fillOpacity={0.35}
                fillRule="evenodd"
                stroke={colors.highlight.DEFAULT}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-3">
        <span className="flex items-center gap-2 font-medium text-ink-2">
          {label}
          {photo.redacted && <PrivacyBlurredBadge />}
        </span>
        {photo.coverage !== null && <span>{photo.coverage > 0 && photo.coverage < 0.01 ? "under 1%" : pct(photo.coverage)} of the photo outlined</span>}
      </figcaption>
    </figure>
  );
}

/** Before and after side by side, with the model's reading underneath. */
export function FixCheckResult({ check, action }: { check: FixCheck; action?: ReactNode }) {
  const a = check.assessment;
  const pending = check.status === "queued" || check.status === "running";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {check.verdict && <FixVerdictBadge verdict={check.verdict} />}
        {pending && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
            <Spinner className="size-3.5" /> Comparing the photos…
          </span>
        )}
        <span className="text-[12.5px] text-ink-3">
          {check.submitted_by} · {formatDateTime(check.created_at)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutlinedPhoto label="Before" photo={check.before} />
        <OutlinedPhoto label="After" photo={check.after} />
      </div>
      {check.note && <p className="text-[13px] text-ink-2">“{check.note}”</p>}

      {check.status === "failed" && (
        <Callout tone="danger" title="These photos couldn't be compared">{errorLabel(check.error_code)}</Callout>
      )}
      {a && (
        <div className="space-y-2 text-[14px] leading-relaxed">
          <p className="font-medium text-ink">{SAME_PLACE_LABEL[a.same_place]}.</p>
          <p className="text-ink-2">{a.visible_changes}</p>
          <p className="text-[13px] text-ink-3">{a.reasoning}</p>
          {a.remaining_concerns.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
              {a.remaining_concerns.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>
      )}
      {(a || check.outline_error) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <ProvenanceBadge provenance={check.provenance} model={check.model} />
            {check.concept && !check.outline_error && <>SAM 3.1 outlines “{check.concept}”</>}
            {check.outline_error && <>Outlines unavailable: {errorLabel(check.outline_error)}</>}
          </span>
          {action}
        </div>
      )}
    </div>
  );
}

/** Pick or take a photo of the spot as it is now, with an optional note. */
export function FixCheckForm({ onSubmit, hint }: { onSubmit: (form: FormData) => Promise<void>; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("image", file);
    if (note.trim()) form.append("note", note.trim());
    try {
      await onSubmit(form);
      setFile(null);
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The photo couldn't be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13.5px] leading-relaxed text-ink-2">{hint}</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className={clsx("flex flex-wrap items-center gap-2", file && "rounded-xl border border-line bg-paper p-2")}>
        <Button variant="secondary" onClick={() => input.current?.click()} icon={<Camera className="size-4" />}>
          {file ? "Change photo" : "Add a photo of the spot now"}
        </Button>
        {file && <span className="min-w-0 truncate text-[13px] text-ink-2">{file.name}</span>}
      </div>
      {file && (
        <>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Anything to add? (optional)" />
          <Button onClick={() => void send()} loading={busy}>Compare with the original</Button>
        </>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}
