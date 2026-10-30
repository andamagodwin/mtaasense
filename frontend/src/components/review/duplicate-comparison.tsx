"use client";

import { clsx } from "clsx";
import { ArrowLeft, Bot, CheckCircle2, CircleSlash, Clock, GitMerge, PauseCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { CATEGORY_LABEL, formatCoords, formatDateTime, formatDistance, formatHours, pct, SEVERITY_LABEL } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { DuplicateSuggestionView, ReportDetail } from "@/lib/types";
import { CategoryBadge, ProvenanceBadge, SampleBadge, StatusBadge, VerdictBadge } from "../badges";
import { PairMap } from "../map/pair-map";
import { SegmentationViewer } from "../segmentation-viewer";
import { useRequireReviewer } from "../session";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { Callout, Skeleton } from "../ui/feedback";
import { Textarea } from "../ui/field";

export function DuplicateComparison() {
  const { id } = useParams<{ id: string }>();
  const session = useRequireReviewer();
  const suggestion = useApi(() => api.suggestion(id), session.allowed ? id : null);
  const s = suggestion.data;
  const source = useApi((sig) => api.report(s!.source.id, null, sig), s ? `src:${s.source.id}` : null);
  const candidate = useApi((sig) => api.report(s!.candidate.id, null, sig), s ? `cand:${s.candidate.id}` : null);

  if (suggestion.error) return <div className="mx-auto max-w-xl px-4 py-16"><Callout tone="danger">{suggestion.error.message}</Callout></div>;
  if (!s) return <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6"><Skeleton className="h-[600px]" /></div>;

  const a = source.data;
  const b = candidate.data;
  const decided = s.status === "confirmed" || s.status === "rejected";

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
      <Link href={`/review/reports/${s.source.id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Back to {s.source.reference}
      </Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-3">Duplicate suggestion · {formatDateTime(s.created_at)}</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Are these the same incident?</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-ink px-2 py-1 font-mono text-[13px] text-white">match score {pct(s.score)}</span>
          {s.model_verdict && <VerdictBadge verdict={s.model_verdict} />}
          {s.status !== "pending" && (
            <span className={clsx("rounded-md border px-2 py-0.5 text-[12.5px] font-medium capitalize",
              s.status === "confirmed" ? "border-[#c9dccf] bg-accent-soft text-accent-ink" : "border-line bg-sunken text-ink-2")}>
              {s.status === "deferred" ? "Left unresolved" : s.status}
            </span>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Side label="A · New report" tone="accent" report={a} summary={s.source} />
        <Side label={`B · ${s.candidate.incident ? `Existing report in ${s.candidate.incident.reference}` : "Existing report"}`} tone="neutral" report={b} summary={s.candidate} />
      </div>

      {a && b && <ComparisonTable a={a} b={b} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <EvidencePanel s={s} />
        <div className="space-y-6">
          {a?.location && b?.location ? (
            <Card className="overflow-hidden">
              <CardHeader title="Locations" description={`A and B are ${formatDistance(s.signals.distance_m)} apart (PostGIS geodesic distance).`} />
              <PairMap a={a.location} b={b.location} className="h-64" />
            </Card>
          ) : (
            <Callout tone="neutral" title="Location comparison unavailable">
              At least one report has no coordinates, so distance was not used as evidence. We never estimate missing locations.
            </Callout>
          )}
          <DecisionPanel s={s} disabled={decided} onDone={(next) => suggestion.setData(next)} />
        </div>
      </div>
    </div>
  );
}

function Side({ label, tone, report, summary }: { label: string; tone: "accent" | "neutral"; report: ReportDetail | null; summary: DuplicateSuggestionView["source"] }) {
  return (
    <Card className={clsx(tone === "accent" && "ring-1 ring-accent/25")}>
      <CardHeader
        eyebrow={label}
        title={<span className="flex flex-wrap items-center gap-2"><Link href={`/review/reports/${summary.id}`} className="font-mono hover:underline">{summary.reference}</Link><StatusBadge status={summary.status} />{summary.is_sample && <SampleBadge />}</span>}
        action={<CategoryBadge category={summary.hazard_category} />}
      />
      <CardBody>
        {report ? (
          <SegmentationViewer image={report.image} segmentations={report.segmentations} concepts={[]} canRequest={false} imageClassName="max-h-[480px]" />
        ) : (
          <Skeleton className="aspect-[4/3] w-full" />
        )}
      </CardBody>
    </Card>
  );
}

function ComparisonTable({ a, b }: { a: ReportDetail; b: ReportDetail }) {
  const rows: { label: string; a: ReactNode; b: ReactNode; source: string }[] = [
    { label: "Resident’s words", a: a.description || a.voice_transcript || "—", b: b.description || b.voice_transcript || "—", source: "Resident" },
    { label: "AI summary", a: a.analysis.result?.summary ?? "Not available", b: b.analysis.result?.summary ?? "Not available", source: "Model" },
    { label: "Category", a: a.hazard_category ? CATEGORY_LABEL[a.hazard_category] : "—", b: b.hazard_category ? CATEGORY_LABEL[b.hazard_category] : "—", source: "Effective" },
    { label: "Preliminary severity", a: a.ai_severity ? SEVERITY_LABEL[a.ai_severity] : "—", b: b.ai_severity ? SEVERITY_LABEL[b.ai_severity] : "—", source: "Model" },
    { label: "Submitted", a: formatDateTime(a.created_at), b: formatDateTime(b.created_at), source: "System" },
    {
      label: "Location",
      a: a.location ? <span className="font-mono text-[12.5px]">{formatCoords(a.location.lat, a.location.lon)}</span> : "Not provided",
      b: b.location ? <span className="font-mono text-[12.5px]">{formatCoords(b.location.lat, b.location.lon)}</span> : "Not provided",
      source: "Resident",
    },
    { label: "Landmark", a: a.location_note ?? "—", b: b.location_note ?? "—", source: "Resident" },
  ];
  return (
    <Card className="mt-5 overflow-hidden">
      <table className="w-full text-left text-[13.5px]">
        <thead className="border-b border-line bg-paper text-[12px] text-ink-3">
          <tr>
            <th className="w-40 px-4 py-2 font-medium">Field</th>
            <th className="px-4 py-2 font-medium">A · new report</th>
            <th className="px-4 py-2 font-medium">B · existing report</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label} className="align-top">
              <th scope="row" className="px-4 py-2.5 font-normal text-ink-3">
                {r.label}
                <span className="block text-[11px] uppercase tracking-wide text-ink-3/80">{r.source}</span>
              </th>
              <td className="px-4 py-2.5 leading-relaxed">{r.a}</td>
              <td className="px-4 py-2.5 leading-relaxed">{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function EvidencePanel({ s }: { s: DuplicateSuggestionView }) {
  const sig = s.signals;
  const c = sig.components;
  const rows = [
    { label: "Distance", value: c.location, detail: sig.distance_m !== null ? `${formatDistance(sig.distance_m)} (search radius ${sig.radius_m} m)` : "Not computed — a location is missing" },
    { label: "Hazard type", value: c.category, detail: sig.category_relation ? `${sig.category_relation.replace("_", " ")} (${sig.source_category ? CATEGORY_LABEL[sig.source_category] : "?"} / ${sig.candidate_category ? CATEGORY_LABEL[sig.candidate_category] : "?"})` : "Not computed — a category is missing" },
    { label: "Wording", value: c.text, detail: `Trigram similarity ${sig.text_similarity.toFixed(2)}${sig.summary_similarity !== null ? ` · AI summaries ${sig.summary_similarity.toFixed(2)}` : ""}` },
    { label: "Timing", value: c.time, detail: `${formatHours(sig.hours_apart)} apart (window ${sig.window_days} days)` },
  ];
  return (
    <Card>
      <CardHeader title="Why this was suggested" description="Deterministic signals computed by the database. Missing signals are left out rather than guessed." />
      <CardBody className="space-y-4">
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="mb-1 flex items-baseline justify-between text-[13px]">
                <span className="font-medium">{r.label}</span>
                <span className="font-mono text-[12px] text-ink-3">{r.value === undefined ? "n/a" : pct(r.value)}</span>
              </div>
              {r.value !== undefined ? <Bar value={r.value} /> : <div className="h-1.5 rounded-full border border-dashed border-line-strong" />}
              <p className="mt-1 text-[12px] text-ink-3">{r.detail}</p>
            </li>
          ))}
        </ul>
        <div className="rounded-lg border border-line bg-paper p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] font-medium">
            <Bot className="size-4 text-accent" />
            Visual comparison by Muse Spark
            {s.model_verdict && <VerdictBadge verdict={s.model_verdict} />}
            <ProvenanceBadge provenance={s.model_provenance} />
          </p>
          {s.model_assessment ? (
            <div className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
              <p>{s.model_assessment.visual_comparison}</p>
              <p className="text-ink-3">{s.model_assessment.reasoning}</p>
              <p className="text-[11.5px] text-ink-3">Model interpretation of the two photos — not proof that they show the same place.</p>
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">
              No model comparison for this pair{s.model_provenance === null ? " (model assistance was unavailable or not needed)" : ""}. The photos have not been
              compared automatically; compare them above.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function DecisionPanel({ s, disabled, onDone }: { s: DuplicateSuggestionView; disabled: boolean; onDone: (v: DuplicateSuggestionView) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = s.candidate.incident ? `incident ${s.candidate.incident.reference}` : "a new incident (confirming B as well)";

  async function decide(decision: "confirm" | "reject" | "defer") {
    setBusy(decision);
    setError(null);
    try {
      onDone(await api.decide(s.id, decision, note.trim() || undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The decision couldn't be saved.");
    } finally {
      setBusy(null);
    }
  }

  if (disabled) {
    return (
      <Card>
        <CardBody className="space-y-2">
          <p className="flex items-center gap-2 font-medium">
            {s.status === "confirmed" ? <CheckCircle2 className="size-4 text-accent" /> : <CircleSlash className="size-4 text-ink-3" />}
            {s.status === "confirmed" ? "Confirmed as the same incident" : "Marked as different incidents"}
          </p>
          <p className="text-[13px] text-ink-3">
            {s.decided_by} · {s.decided_at && formatDateTime(s.decided_at)}
            {s.decision_note && <> · “{s.decision_note}”</>}
          </p>
          {s.status === "confirmed" && (
            <Link href={`/review/reports/${s.source.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
              <GitMerge className="size-3.5" /> View the linked report and incident
            </Link>
          )}
          <p className="text-[12px] text-ink-3">Both original reports and their evidence are preserved.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Your decision" description="Nothing is merged automatically. Both reports keep their own evidence either way." />
      <CardBody className="space-y-3">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note, e.g. “Same kerb and power pole visible in both photos.”" className="min-h-20" aria-label="Decision note" />
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button onClick={() => void decide("confirm")} loading={busy === "confirm"} disabled={!!busy} icon={<CheckCircle2 className="size-4" />}>
            Same incident — link A to {s.candidate.incident ? s.candidate.incident.reference : "B"}
          </Button>
          <Button variant="secondary" onClick={() => void decide("reject")} loading={busy === "reject"} disabled={!!busy} icon={<CircleSlash className="size-4" />}>
            Different incidents
          </Button>
          <Button variant="ghost" onClick={() => void decide("defer")} loading={busy === "defer"} disabled={!!busy} icon={<PauseCircle className="size-4" />}>
            Not sure — leave open
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <Clock className="size-3.5" /> Confirming links A to {target}. The decision is recorded in the audit log.
        </p>
      </CardBody>
    </Card>
  );
}
