import { clsx } from "clsx";
import { ArrowDown2, Camera, CloseCircle, Danger, MagicStar, QuoteUp, TickCircle, Warning2 } from "iconsax-reactjs";
import type { ReactNode } from "react";
import { ANALYSIS_STATUS_LABEL, CATEGORY_LABEL, errorLabel, formatDateTime, PRIORITY_LABEL, SEVERITY_LABEL } from "@/lib/format";
import type { AnalysisView, HazardAssessment, HazardCategory, Observation, Severity } from "@/lib/types";
import { CountCircle } from "./ui/count";
import { Callout, Skeleton } from "./ui/feedback";

/** Observations are grouped by where they came from, in this order. */
const SOURCES: { source: Observation["source"]; label: string; icon: ReactNode }[] = [
  { source: "image", label: "In the photo", icon: <Camera className="size-3.5" /> },
  { source: "description", label: "From the resident", icon: <QuoteUp className="size-3.5" /> },
  { source: "image_and_description", label: "Photo and resident agree", icon: <TickCircle className="size-3.5" /> },
];

const CONSISTENCY: Record<
  Exclude<HazardAssessment["description_consistency"], "no_description">,
  { label: string; icon: ReactNode; tone: string }
> = {
  consistent: { label: "Description matches the photo", icon: <TickCircle className="size-4" />, tone: "text-success" },
  partially_consistent: { label: "Description partly matches the photo", icon: <Warning2 className="size-4" />, tone: "text-warn" },
  inconsistent: { label: "Description conflicts with the photo", icon: <CloseCircle className="size-4" />, tone: "text-danger" },
};

const SEVERITY_DOT: Record<Severity, string> = {
  low: "bg-ink-3",
  moderate: "bg-warn",
  high: "bg-danger",
  critical: "bg-danger ring-2 ring-danger/25",
  undetermined: "bg-line-strong",
};

function aiCategoryLabel(value: HazardAssessment["hazard_category"]): string {
  if (value === "other_hazard") return "Other hazard";
  if (value === "not_applicable") return "Not a hazard";
  if (value === "unclear") return "Unclear";
  return CATEGORY_LABEL[value];
}

export function AnalysisPanel({
  analysis,
  reporterCategory,
  compact = false,
  action,
}: {
  analysis: AnalysisView;
  reporterCategory: HazardCategory | null;
  /** The resident's view: drops the open questions and keeps the fuller caveat. */
  compact?: boolean;
  /** Shown in the footer, e.g. a Re-analyse button. */
  action?: ReactNode;
}) {
  if (analysis.status === "pending" || analysis.status === "running") {
    return (
      <div className="space-y-3" aria-busy>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <MagicStar className="size-4 animate-pulse text-accent" />
          Muse Spark is reading the photo and the description…
        </p>
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (analysis.status !== "completed" || !analysis.result) {
    const unavailable = analysis.status === "unavailable";
    return (
      <div className="space-y-3">
        <Callout tone={unavailable ? "neutral" : "warn"} title={ANALYSIS_STATUS_LABEL[analysis.status]}>
          {errorLabel(analysis.error_code)} The photo and description are still here to review.
        </Callout>
        {action && <div className="flex justify-end">{action}</div>}
      </div>
    );
  }

  const r = analysis.result;
  const disagrees = reporterCategory !== null && reporterCategory !== r.hazard_category;
  const unknowns = r.uncertainties.length + r.missing_information.length;

  return (
    <div className="@container space-y-6">
      {!r.is_infrastructure_hazard && (
        <p className="flex items-center gap-2 text-sm font-medium text-danger">
          <Danger className="size-4 shrink-0" />
          The model doesn&apos;t think this is an infrastructure hazard.
        </p>
      )}

      <p className="text-[15px] leading-relaxed text-ink">{r.summary}</p>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line @2xl:grid-cols-4">
        <Fact label="Category">
          {aiCategoryLabel(r.hazard_category)}
          {disagrees && reporterCategory && <span className="block text-[12px] font-normal text-ink-3">Resident said {CATEGORY_LABEL[reporterCategory]}</span>}
        </Fact>
        <Fact label="Severity">
          <span className="inline-flex items-center gap-2">
            <span className={clsx("size-2 rounded-full", SEVERITY_DOT[r.severity])} aria-hidden />
            {SEVERITY_LABEL[r.severity]}
          </span>
        </Fact>
        <Fact label="Priority">{PRIORITY_LABEL[r.suggested_review_priority]}</Fact>
        <Fact label="Confidence" className="capitalize">{r.confidence}</Fact>
      </dl>

      <Section title="Why this severity">
        <p className="text-sm leading-relaxed text-ink-2">{r.severity_rationale}</p>
      </Section>

      <Section title="Evidence">
        <div className="space-y-4">
          {SOURCES.map(({ source, label, icon }) => {
            const items = r.observations.filter((o) => o.source === source);
            if (items.length === 0) return null;
            return (
              <div key={source}>
                <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">
                  {icon}
                  {label}
                </p>
                <ul className="space-y-1 text-sm leading-relaxed text-ink">
                  {items.map((o, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                      {o.text}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <Consistency assessment={r} />
        </div>
      </Section>

      {!compact && unknowns > 0 && (
        <details className="group border-t border-line pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              Open questions
              <CountCircle value={unknowns} size="sm" tone="neutral" />
            </span>
            <ArrowDown2 className="size-4 text-ink-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <List title="Can't tell from the photo" items={r.uncertainties} />
            <List title="Would help to know" items={r.missing_information} />
          </div>
        </details>
      )}

      <Footer analysis={analysis} compact={compact} action={action} />
    </div>
  );
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={clsx("mt-0.5 text-sm font-medium text-ink", className)}>{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-medium text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** Says only whether the description fits the photo; the model's note is shown when it doesn't. */
function Consistency({ assessment }: { assessment: HazardAssessment }) {
  if (assessment.description_consistency === "no_description") return null;
  const c = CONSISTENCY[assessment.description_consistency];
  const explain = assessment.description_consistency !== "consistent" && assessment.consistency_note;
  return (
    <div className="flex gap-2 text-sm">
      <span className={clsx("mt-0.5 shrink-0", c.tone)}>{c.icon}</span>
      <div className="min-w-0">
        <p className="font-medium text-ink">{c.label}</p>
        {explain && <p className="mt-0.5 leading-relaxed text-ink-3">{assessment.consistency_note}</p>}
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] text-ink-3">{title}</p>
      <ul className="space-y-1 text-[13px] leading-relaxed text-ink-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer({ analysis, compact, action }: { analysis: AnalysisView; compact: boolean; action?: ReactNode }) {
  const meta = analysis.meta ?? {};
  const quality = analysis.result?.image_quality;
  const tokens =
    typeof meta.input_tokens === "number" && typeof meta.output_tokens === "number"
      ? `${meta.input_tokens.toLocaleString()} tokens in, ${meta.output_tokens.toLocaleString()} out`
      : undefined;
  const parts: ReactNode[] = [];
  if (analysis.provenance === "fixture") parts.push(<span className="font-medium text-warn-ink">Demo fixture</span>);
  else if (analysis.model) parts.push(<span className="font-mono">{analysis.model}</span>);
  if (analysis.provenance === "cached") parts.push("cached");
  if (analysis.completed_at) parts.push(formatDateTime(analysis.completed_at));
  if (typeof meta.latency_ms === "number") parts.push(`${(meta.latency_ms / 1000).toFixed(1)} s`);
  if (quality) {
    parts.push(
      <span className={clsx(quality === "poor" || quality === "unusable" ? "font-medium text-warn-ink" : undefined)}>
        {quality} photo
      </span>,
    );
  }
  if (typeof meta.fixture_note === "string") parts.push(meta.fixture_note);

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-4">
      <div className="min-w-0 text-[12px] leading-relaxed text-ink-3">
        <p title={tokens}>
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {p}
            </span>
          ))}
        </p>
        <p>
          {compact
            ? "A first reading by a model, not an engineering assessment. It doesn't mean the hazard has been verified or reported to an authority."
            : "Preliminary, not an engineering assessment."}
        </p>
      </div>
      {action}
    </footer>
  );
}
