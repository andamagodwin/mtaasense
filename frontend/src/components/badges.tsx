import { clsx } from "clsx";
import { Box, Cpu, Driver, EyeSlash, Repeat } from "iconsax-reactjs";
import type { ReactNode } from "react";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PROVENANCE_LABEL,
  REPORT_STATUS_LABEL,
  SEVERITY_LABEL,
  VERDICT_LABEL,
} from "@/lib/format";
import type { HazardCategory, IncidentStatus, ModelVerdict, Priority, Provenance, ReportStatus, Severity } from "@/lib/types";

export function Badge({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[12px] font-medium leading-none",
        className ?? "border-line bg-sunken text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

const statusTone: Record<ReportStatus, string> = {
  submitted: "border-line bg-sunken text-ink-2",
  processing: "border-info-line bg-info-soft text-info-ink",
  under_review: "border-warn-line bg-warn-soft text-warn-ink",
  confirmed: "border-success-line bg-success-soft text-success-ink",
  duplicate: "border-success-line bg-success-soft text-success-ink",
  rejected: "border-line bg-sunken text-ink-3",
  resolved: "border-line-strong bg-surface text-ink-2",
  processing_failed: "border-danger-line bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <Badge className={statusTone[status]}>
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {REPORT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return status === "resolved" ? (
    <Badge className="border-line-strong bg-surface text-ink-2">Resolved</Badge>
  ) : (
    <Badge className="border-success-line bg-success-soft text-success-ink">
      <span className="size-1.5 rounded-full bg-current" />
      Confirmed incident
    </Badge>
  );
}

export function CategoryDot({ category, className }: { category: HazardCategory | null; className?: string }) {
  return (
    <span
      className={clsx("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: category ? CATEGORY_COLOR[category] : "var(--color-ink-3)" }}
      aria-hidden
    />
  );
}

export function CategoryBadge({ category, suffix }: { category: HazardCategory | null; suffix?: ReactNode }) {
  return (
    <Badge className="border-line bg-surface text-ink">
      <CategoryDot category={category} />
      {category ? CATEGORY_LABEL[category] : "Uncategorised"}
      {suffix}
    </Badge>
  );
}

const provenanceIcon: Record<Provenance, ReactNode> = {
  live: <Cpu className="size-3" />,
  cached: <Repeat className="size-3" />,
  fixture: <Box className="size-3" />,
};

const provenanceTone: Record<Provenance, string> = {
  live: "border-accent-line bg-accent-soft text-accent-ink",
  cached: "border-line bg-sunken text-ink-2",
  fixture: "border-warn-line bg-warn-soft text-warn-ink",
};

export function ProvenanceBadge({ provenance, model }: { provenance: Provenance | null; model?: string | null }) {
  if (!provenance) return null;
  return (
    <Badge className={provenanceTone[provenance]} title={model ? `${PROVENANCE_LABEL[provenance]} · ${model}` : undefined}>
      {provenanceIcon[provenance]}
      {PROVENANCE_LABEL[provenance]}
      {model && provenance !== "fixture" && <span className="font-mono text-[11px] opacity-75">{model}</span>}
    </Badge>
  );
}

const severityTone: Record<Severity, string> = {
  low: "border-line bg-sunken text-ink-2",
  moderate: "border-warn-line bg-warn-soft text-warn-ink",
  high: "border-danger-line bg-danger-soft text-danger",
  critical: "border-danger bg-danger text-white",
  undetermined: "border-line bg-surface text-ink-3",
};

export function SeverityBadge({ severity, prefix = true }: { severity: Severity; prefix?: boolean }) {
  return (
    <Badge className={severityTone[severity]}>
      {prefix && <span className="font-normal opacity-75">Severity</span>}
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

const priorityTone: Record<Priority, string> = {
  routine: "border-line bg-surface text-ink-2",
  elevated: "border-warn-line bg-warn-soft text-warn-ink",
  urgent: "border-danger-line bg-danger-soft text-danger",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge className={priorityTone[priority]}>{PRIORITY_LABEL[priority]} priority</Badge>;
}

export function PrivacyBlurredBadge() {
  return (
    <Badge className="border-line bg-sunken text-ink-2" title="Faces and number plates are blurred in this copy. Reviewers see the original.">
      <EyeSlash className="size-3" />
      Faces and plates blurred
    </Badge>
  );
}

export function SampleBadge() {
  return (
    <Badge className="border-dashed border-line-strong bg-paper text-ink-3" title="Seeded demonstration record, not a real submission">
      <Driver className="size-3" />
      Sample data
    </Badge>
  );
}

/** SampleBadge without the words, for lists where it would repeat on every row. */
export function SampleMark() {
  return (
    <span
      className="inline-grid size-[18px] shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-ink-3"
      title="Sample data: a seeded demonstration record, not a real submission"
    >
      <Driver className="size-2.5" />
      <span className="sr-only">Sample data</span>
    </span>
  );
}

const verdictTone: Record<ModelVerdict, string> = {
  likely_same: "border-accent-line bg-accent-soft text-accent-ink",
  possibly_same: "border-warn-line bg-warn-soft text-warn-ink",
  likely_different: "border-line-strong bg-surface text-ink-2",
  insufficient_evidence: "border-line bg-sunken text-ink-3",
};

export function VerdictBadge({ verdict }: { verdict: ModelVerdict }) {
  return (
    <Badge className={verdictTone[verdict]}>
      <Cpu className="size-3" />
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}
