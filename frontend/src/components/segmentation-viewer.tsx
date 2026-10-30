"use client";

import { clsx } from "clsx";
import { Eye, EyeOff, ExternalLink, Layers, ScanSearch, SquareDashed } from "lucide-react";
import { useMemo, useState } from "react";
import { errorLabel, formatDateTime, pct } from "@/lib/format";
import type { MediaRef, SegmentationView } from "@/lib/types";
import { ProvenanceBadge } from "./badges";
import { Button } from "./ui/button";
import { Callout, Spinner } from "./ui/feedback";

const CONCEPT_COLOR: Record<string, string> = {
  pothole: "#d9622b",
  "damaged road surface": "#c58a2a",
  "drainage channel": "#1f9aa8",
  "standing water": "#3d74e0",
  puddle: "#5b8def",
};

export function conceptColor(prompt: string): string {
  return CONCEPT_COLOR[prompt] ?? "#2f6b4f";
}

interface Props {
  image: MediaRef;
  original?: MediaRef;
  segmentations: SegmentationView[];
  concepts: string[];
  suggestedConcept?: string | null;
  canRequest: boolean;
  onRequest?: (prompt: string) => Promise<void>;
  requestError?: string | null;
  imageClassName?: string;
}

export function SegmentationViewer({
  image,
  original,
  segmentations,
  concepts,
  suggestedConcept,
  canRequest,
  onRequest,
  requestError,
  imageClassName = "max-h-[70vh]",
}: Props) {
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showBoxes, setShowBoxes] = useState(false);
  const [opacity, setOpacity] = useState(0.42);
  const [hovered, setHovered] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  const byPrompt = useMemo(() => new Map(segmentations.map((s) => [s.prompt, s])), [segmentations]);
  const fallback =
    segmentations.find((s) => s.status === "completed" && (s.regions?.length ?? 0) > 0) ??
    segmentations.find((s) => s.status === "queued" || s.status === "running") ??
    segmentations[segmentations.length - 1];
  const active = (selectedPrompt ? byPrompt.get(selectedPrompt) : undefined) ?? fallback ?? null;
  const pending = active && (active.status === "queued" || active.status === "running");
  const regions = active?.status === "completed" ? (active.regions ?? []) : [];
  const color = active ? conceptColor(active.prompt) : "#2f6b4f";
  const W = active?.image_width ?? image.width ?? 1;
  const H = active?.image_height ?? image.height ?? 1;
  const imageArea = W * H;

  async function request(prompt: string) {
    setSelectedPrompt(prompt);
    const existing = byPrompt.get(prompt);
    if (existing && existing.status !== "failed") return;
    if (!onRequest) return;
    setRequesting(prompt);
    try {
      await onRequest(prompt);
    } finally {
      setRequesting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-line bg-[#16140f]">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, signed evidence URLs bypass the optimizer */}
        <img
          src={image.url}
          alt="Submitted evidence photo"
          className={clsx("block h-auto w-full object-contain", imageClassName)}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
        />
        {showOverlay && regions.length > 0 && (
          <svg
            key={active?.id}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="pointer-events-none absolute inset-0 size-full animate-mask-in"
            aria-label={`${regions.length} segmented region${regions.length === 1 ? "" : "s"} for “${active?.prompt}”`}
            role="img"
          >
            {regions.map((r) => {
              // Mask paths use pixel-centre coordinates in [-0.5, W-0.5]; boxes are half-open source pixels.
              const bw = r.box.right - r.box.left;
              const bh = r.box.bottom - r.box.top;
              const sx = bw / r.mask.width;
              const sy = bh / r.mask.height;
              const dim = hovered !== null && hovered !== r.object_id;
              return (
                <g key={r.object_id} opacity={dim ? 0.35 : 1} className="transition-opacity duration-150">
                  <path
                    d={r.mask.svg_path}
                    transform={`translate(${r.box.left} ${r.box.top}) scale(${sx} ${sy}) translate(0.5 0.5)`}
                    fill={color}
                    fillOpacity={opacity}
                    fillRule="evenodd"
                    stroke={color}
                    strokeWidth={2.25}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    pathLength={1}
                    className="[animation:draw_900ms_cubic-bezier(0.2,0.7,0.2,1)_both] [stroke-dasharray:1]"
                  />
                  {showBoxes && (
                    <rect
                      x={r.box.left}
                      y={r.box.top}
                      width={bw}
                      height={bh}
                      fill="none"
                      stroke="#fff"
                      strokeOpacity={0.9}
                      strokeDasharray="6 5"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {pending && (
          <div className="absolute inset-0 grid place-items-center bg-ink/25">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-[scan_1.8s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-white/25 to-transparent" />
            <div className="flex items-center gap-2 rounded-full bg-surface/95 px-3.5 py-2 text-[13px] font-medium shadow-[var(--shadow-pop)]">
              <Spinner className="size-4 text-accent" />
              Segmenting “{active?.prompt}” with SAM 3.1…
            </div>
          </div>
        )}
        {active?.status === "completed" && regions.length > 0 && (
          <div className="absolute right-2.5 top-2.5 flex gap-1.5">
            <OverlayToggle on={showOverlay} onClick={() => setShowOverlay((v) => !v)} />
          </div>
        )}
      </div>

      {/* Concept chooser */}
      <div className={clsx("flex flex-wrap items-center gap-1.5", concepts.length === 0 && "hidden")}>
        <span className="mr-1 inline-flex items-center gap-1.5 text-[13px] text-ink-3">
          <ScanSearch className="size-4" /> SAM 3.1 concept
        </span>
        {concepts.map((c) => {
          const seg = byPrompt.get(c);
          const isActive = active?.prompt === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => void request(c)}
              disabled={(!seg && !canRequest) || requesting !== null}
              className={clsx(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                isActive ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
              aria-pressed={isActive}
            >
              <span className="size-2 rounded-full" style={{ background: conceptColor(c) }} />
              {c}
              {requesting === c && <Spinner className="size-3" />}
              {seg?.status === "completed" && (
                <span className={clsx("font-mono text-[11px]", isActive ? "text-white/70" : "text-ink-3")}>
                  {seg.regions?.length ?? 0}
                </span>
              )}
              {suggestedConcept === c && !seg && <span className="text-[11px] text-accent">suggested</span>}
            </button>
          );
        })}
      </div>

      {requestError && <Callout tone="danger">{requestError}</Callout>}

      {active?.status === "failed" && (
        <Callout tone="warn" title={`Segmentation for “${active.prompt}” didn’t complete`}>
          {errorLabel(active.error_code)} The photo and analysis are unaffected.
          {canRequest && " Choose the concept again to retry."}
        </Callout>
      )}

      {active?.status === "completed" && regions.length === 0 && (
        <Callout tone="neutral" title={`SAM 3.1 found no “${active.prompt}” region`}>
          This is a normal result, not an error. Try another concept, or rely on the photo itself.
        </Callout>
      )}

      {active?.status === "completed" && regions.length > 0 && (
        <div className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Layers className="size-4 text-ink-3" />
              <span className="font-medium">
                {regions.length} region{regions.length === 1 ? "" : "s"} · “{active.prompt}”
              </span>
              <ProvenanceBadge provenance={active.provenance} model={active.model} />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-ink-3">
                Fill
                <input
                  type="range"
                  min={0.1}
                  max={0.8}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="w-20 accent-[var(--color-accent)]"
                  aria-label="Overlay opacity"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowBoxes((v) => !v)}
                aria-pressed={showBoxes}
                className={clsx(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px]",
                  showBoxes ? "bg-sunken text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                <SquareDashed className="size-3.5" /> Boxes
              </button>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {regions.map((r, i) => (
              <li
                key={r.object_id}
                onMouseEnter={() => setHovered(r.object_id)}
                onMouseLeave={() => setHovered(null)}
                className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px] hover:bg-paper"
              >
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: color }} />
                  Region {i + 1}
                </span>
                <span className="flex gap-4 font-mono text-[12px] text-ink-3">
                  <span title="Share of image pixels inside the mask">{formatShare(r.mask.area_px / imageArea)} of image</span>
                  {r.confidence !== null && <span title="Model confidence for this mask">conf {pct(r.confidence)}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3.5 py-2 text-[12px] leading-relaxed text-ink-3">
            A segmentation marks a visual region only — it does not establish size, cause, severity or official status.
            {active.completed_at && <> Generated {formatDateTime(active.completed_at)}.</>}
          </p>
        </div>
      )}

      {!active && (
        <p className="text-[13px] leading-relaxed text-ink-3">
          {canRequest
            ? "Choose a concept to outline the matching region with SAM 3.1."
            : "No segmentation has been run for this photo yet."}
        </p>
      )}

      {original && (
        <a
          href={original.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
        >
          <ExternalLink className="size-3.5" /> Open original upload ({original.width}×{original.height})
        </a>
      )}
    </div>
  );
}

function formatShare(fraction: number): string {
  const percent = fraction * 100;
  return percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
}

function OverlayToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface/95 px-2.5 text-[12.5px] font-medium text-ink shadow-[var(--shadow-card)] backdrop-blur hover:bg-surface"
    >
      {on ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {on ? "Show original" : "Show overlay"}
    </button>
  );
}

export function SegmentPlaceholderButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} loading={loading} icon={<ScanSearch className="size-4" />}>
      Segment with SAM 3.1
    </Button>
  );
}
