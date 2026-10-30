import { clsx } from "clsx";
import { Camera, CircleHelp, MessageSquareQuote, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ANALYSIS_STATUS_LABEL, CATEGORY_LABEL, errorLabel, formatDateTime, PRIORITY_LABEL } from "@/lib/format";
import type { AnalysisView, HazardAssessment, HazardCategory, Observation } from "@/lib/types";
import { Badge, ProvenanceBadge, SeverityBadge } from "./badges";
import { Callout, Skeleton } from "./ui/feedback";
import { SectionLabel } from "./ui/card";

const SOURCE_META: Record<Observation["source"], { label: string; icon: ReactNode; tone: string }> = {
  image: { label: "Visible in photo", icon: <Camera className="size-3.5" />, tone: "border-l-cat-drain" },
  description: { label: "Stated by resident", icon: <MessageSquareQuote className="size-3.5" />, tone: "border-l-cat-road" },
  image_and_description: { label: "Photo and resident agree", icon: <Camera className="size-3.5" />, tone: "border-l-accent" },
};

const CONSISTENCY: Record<HazardAssessment["description_consistency"], { label: string; tone: string }> = {
  consistent: { label: "Description matches photo", tone: "border-[#c9dccf] bg-accent-soft text-accent-ink" },
  partially_consistent: { label: "Partly matches photo", tone: "border-[#efdcb6] bg-warn-soft text-[#7d520c]" },
  inconsistent: { label: "Description conflicts with photo", tone: "border-[#ebc9c0] bg-danger-soft text-danger" },
  no_description: { label: "No description to compare", tone: "border-line bg-sunken text-ink-3" },
};

function aiCategoryLabel(value: HazardAssessment["hazard_category"]): string {
  if (value === "other_hazard") return "Other hazard";
  if (value === "not_applicable") return "Not an infrastructure hazard";
  if (value === "unclear") return "Unclear";
  return CATEGORY_LABEL[value];
}

export function AnalysisPanel({
  analysis,
  reporterCategory,
  compact = false,
}: {
  analysis: AnalysisView;
  reporterCategory: HazardCategory | null;
  compact?: boolean;
}) {
  if (analysis.status === "pending" || analysis.status === "running") {
    return (
      <div className="space-y-3" aria-busy>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <Sparkles className="size-4 animate-pulse text-accent" />
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
      <Callout tone={unavailable ? "neutral" : "warn"} title={ANALYSIS_STATUS_LABEL[analysis.status]}>
        {errorLabel(analysis.error_code)} The original photo and description remain available, and the report can still
        be reviewed and matched against nearby reports.
      </Callout>
    );
  }

  const r = analysis.result;
  const consistency = CONSISTENCY[r.description_consistency];
  const meta = analysis.meta ?? {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <ProvenanceBadge provenance={analysis.provenance} model={analysis.model} />
        {!r.is_infrastructure_hazard && (
          <Badge className="border-[#ebc9c0] bg-danger-soft text-danger">Model: not an infrastructure hazard</Badge>
        )}
      </div>

      <InterpretationBlock label="Model summary">
        <p className="text-[15px] leading-relaxed text-ink">{r.summary}</p>
      </InterpretationBlock>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Model category">{aiCategoryLabel(r.hazard_category)}</Fact>
        <Fact label="Resident chose">{reporterCategory ? CATEGORY_LABEL[reporterCategory] : "Let AI suggest"}</Fact>
        <Fact label="Severity (preliminary)">
          <SeverityBadge severity={r.severity} prefix={false} />
        </Fact>
        <Fact label="Suggested priority">{PRIORITY_LABEL[r.suggested_review_priority]}</Fact>
        <Fact label="Model confidence" className="capitalize">{r.confidence}</Fact>
        <Fact label="Photo quality" className="capitalize">{r.image_quality}</Fact>
      </dl>

      <InterpretationBlock label="Why this severity">
        <p className="text-sm leading-relaxed text-ink-2">{r.severity_rationale}</p>
      </InterpretationBlock>

      <div className="space-y-2">
        <SectionLabel>Observations by evidence source</SectionLabel>
        <ul className="space-y-1.5">
          {r.observations.map((o, i) => {
            const m = SOURCE_META[o.source];
            return (
              <li key={i} className={clsx("rounded-lg border border-line border-l-[3px] bg-paper/50 px-3 py-2", m.tone)}>
                <span className="mb-0.5 flex items-center gap-1 text-[11.5px] font-medium text-ink-3">
                  {m.icon}
                  {m.label}
                </span>
                <span className="text-sm leading-relaxed text-ink">{o.text}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <Badge className={consistency.tone}>{consistency.label}</Badge>
        {r.consistency_note && <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-3">{r.consistency_note}</p>}
      </div>

      {!compact && (r.uncertainties.length > 0 || r.missing_information.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <UnknownList title="What can't be determined" items={r.uncertainties} />
          <UnknownList title="Information that would help" items={r.missing_information} />
        </div>
      )}

      <p className="rounded-lg bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink-3">
        Preliminary review aid generated by a model. It is not an engineering assessment and does not mean the hazard
        has been verified, reported to an authority, or resolved.
        {analysis.completed_at && <> · {formatDateTime(analysis.completed_at)}</>}
        {typeof meta.latency_ms === "number" && <> · {(meta.latency_ms / 1000).toFixed(1)} s</>}
        {typeof meta.input_tokens === "number" && typeof meta.output_tokens === "number" && (
          <> · {meta.input_tokens.toLocaleString()} in / {meta.output_tokens.toLocaleString()} out tokens</>
        )}
        {typeof meta.fixture_note === "string" && <> · {meta.fixture_note}</>}
      </p>
    </div>
  );
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={clsx("mt-0.5 text-sm font-medium text-ink", className)}>{children}</dd>
    </div>
  );
}

function InterpretationBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-accent/50 pl-3">
      <p className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-accent-ink">
        <Sparkles className="size-3" />
        {label}
      </p>
      {children}
    </div>
  );
}

function UnknownList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-ink-3">
        <CircleHelp className="size-3.5" />
        {title}
      </p>
      <ul className="space-y-1 text-[13px] leading-relaxed text-ink-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
