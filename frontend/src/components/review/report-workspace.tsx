"use client";

import { clsx } from "clsx";
import { ArrowRight, Forbidden, Hierarchy, Refresh, Refresh2, TickCircle } from "iconsax-reactjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CATEGORY_LABEL, errorLabel, formatDateTime, PRIORITY_LABEL, pct } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import type { HazardCategory, Priority, ReportDetail } from "@/lib/types";
import { AnalysisPanel } from "../analysis-panel";
import { CategoryBadge, SampleBadge, StatusBadge, VerdictBadge } from "../badges";
import { ResidentFacts } from "../resident-facts";
import { SegmentationViewer } from "../segmentation-viewer";
import { useRequireReviewer } from "../session";
import { VideoSection } from "../video-section";
import { isProcessing } from "../track-report";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { Dialog } from "../ui/dialog";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Page, PageHeader } from "../ui/page";
import { TabPanel, Tabs, useTab } from "../ui/tabs";
import { AuditTrail, NotesPanel } from "./activity";
import { Thumb } from "./thumb";

const CATEGORIES: HazardCategory[] = ["pothole", "road_surface_damage", "blocked_drainage", "flooding"];

const TABS = ["report", "ai", "duplicates", "activity"] as const;

export function ReportWorkspace() {
  const { id } = useParams<{ id: string }>();
  const session = useRequireReviewer();
  const report = useApi((signal) => api.report(id, null, signal), session.allowed ? id : null);
  const duplicates = useApi(() => api.duplicatesFor(id), session.allowed ? `dups:${id}` : null);
  const config = useApi(() => api.config(), "config");
  const [auditKey, setAuditKey] = useState(0);
  const [tab, setTab] = useTab(TABS, "report");
  const processing = !!report.data && isProcessing(report.data);
  usePolling(() => { report.reload(); duplicates.reload(); }, 2500, processing);

  if (!session.allowed || (!report.data && !report.error)) {
    return <Page><Skeleton className="h-[600px]" /></Page>;
  }
  if (report.error && !report.data) {
    return <Page width="narrow"><Callout tone="danger" title="Couldn't load this report">{report.error.message}</Callout></Page>;
  }
  const r = report.data!;
  const refresh = (next?: ReportDetail) => {
    if (next) report.setData(next);
    else report.reload();
    duplicates.reload();
    setAuditKey((k) => k + 1);
  };
  const openPairs = duplicates.data
    ? duplicates.data.filter((d) => d.status === "pending" || d.status === "deferred").length
    : r.open_duplicate_suggestions;

  async function requestSegment(prompt: string) {
    await api.segment(r.id, prompt);
    report.reload();
  }

  return (
    <Page>
      <PageHeader
        back={{ href: "/review/queue", label: "Queue" }}
        meta={
          <>
            Submitted {formatDateTime(r.created_at)}
            {r.incident && (
              <>
                {" · part of "}
                <Link href={`/review/incidents/${r.incident.id}`} className="font-medium text-accent hover:text-accent-hover">
                  {r.incident.reference}
                </Link>
              </>
            )}
          </>
        }
        title={
          <>
            <span className="font-mono">{r.reference}</span>
            <StatusBadge status={r.status} />
            <CategoryBadge category={r.hazard_category} suffix={r.reviewer_category ? <span className="text-ink-3">· corrected</span> : undefined} />
            {r.is_sample && <SampleBadge />}
          </>
        }
        actions={<ReviewActions report={r} onDone={refresh} />}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* The evidence stays in view while the tabs change. */}
        <div className={clsx("space-y-6", !r.video && "lg:sticky lg:top-6")}>
          <Card>
            <CardBody>
              {r.image ? (
                <SegmentationViewer
                  image={r.image}
                  original={r.original_image ?? undefined}
                  segmentations={r.segmentations}
                  concepts={config.data?.segmentation_concepts ?? []}
                  suggestedConcept={r.analysis.result?.segmentation_concept}
                  canRequest
                  onRequest={requestSegment}
                />
              ) : (
                <Callout tone="warn" title="Photo unavailable" />
              )}
            </CardBody>
          </Card>
          {r.video && <VideoSection video={r.video} />}
        </div>

        <div className="min-w-0">
          <Tabs
            label="Report details"
            value={tab}
            onChange={setTab}
            items={[
              { id: "report", label: "Report" },
              { id: "ai", label: "AI assessment" },
              { id: "duplicates", label: "Duplicates", count: openPairs, attention: true },
              { id: "activity", label: "Activity" },
            ]}
          />

          <TabPanel id="report" value={tab} className="space-y-6">
            <Card>
              <CardBody>
                <ResidentFacts report={r} showMachineTranscript />
              </CardBody>
            </Card>
            <CategoryCorrection report={r} onDone={refresh} />
          </TabPanel>

          <TabPanel id="ai" value={tab}>
            <Card>
              <CardBody className="space-y-4">
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => void api.reanalyze(r.id).then(() => refresh())} icon={<Refresh2 className="size-3.5" />} disabled={processing}>
                    Re-analyse
                  </Button>
                </div>
                <AnalysisPanel analysis={r.analysis} reporterCategory={r.reporter_category} />
              </CardBody>
            </Card>
          </TabPanel>

          <TabPanel id="duplicates" value={tab}>
            <Card>
              <div className="flex justify-end border-b border-line px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => void api.rematch(r.id).then(() => setTimeout(duplicates.reload, 2500))} icon={<Refresh className="size-3.5" />}>
                  Re-run matching
                </Button>
              </div>
              {!duplicates.data && <div className="p-5"><Skeleton className="h-16" /></div>}
              {duplicates.data?.length === 0 && (
                <EmptyState icon={<Hierarchy className="size-5" />} title="No likely duplicates" className="py-8">
                  {r.location ? "Nothing similar nearby in the last 45 days." : "No location, so only very similar wording is compared."}
                </EmptyState>
              )}
              <ul className="divide-y divide-line">
                {duplicates.data?.map((d) => (
                  <li key={d.id}>
                    <Link href={`/review/duplicates/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60">
                      <Thumb media={d.candidate.thumbnail} className="size-14" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] font-medium">{d.candidate.reference}</span>
                          <span className="rounded bg-ink px-1.5 py-px font-mono text-[11px] text-white">{pct(d.score)}</span>
                          {d.model_verdict && <VerdictBadge verdict={d.model_verdict} />}
                          {d.status !== "pending" && <span className="text-[12px] capitalize text-ink-3">{d.status}</span>}
                        </div>
                        <p className="mt-0.5 text-[12px] text-ink-3">
                          {d.signals.distance_m !== null ? `${Math.round(d.signals.distance_m)} m away` : "distance unknown"} · {Math.round(d.signals.hours_apart)} h apart
                          {d.candidate.incident && ` · in ${d.candidate.incident.reference}`}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">Compare <ArrowRight className="size-3.5" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </TabPanel>

          <TabPanel id="activity" value={tab} className="space-y-6">
            <JobsCard report={r} />
            <NotesPanel kind="report" id={r.id} onAdded={() => setAuditKey((k) => k + 1)} />
            <AuditTrail kind="report" id={r.id} refreshKey={auditKey} />
          </TabPanel>
        </div>
      </div>
    </Page>
  );
}

function ReviewActions({ report, onDone }: { report: ReportDetail; onDone: (r?: ReportDetail) => void }) {
  const [dialog, setDialog] = useState<"confirm" | "reject" | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>(report.ai_priority ?? "routine");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = (a: string) => report.allowed_actions.includes(a);
  const defaultTitle = report.hazard_category
    ? `${CATEGORY_LABEL[report.hazard_category]}${report.location_note ? ` at ${report.location_note}` : ""}`
    : "";

  async function run(action: "confirm_incident" | "reject" | "reopen") {
    setBusy(true);
    setError(null);
    try {
      const next = await api.reviewReport(report.id, {
        action,
        title: action === "confirm_incident" ? (title.trim() || defaultTitle || undefined) : undefined,
        priority: action === "confirm_incident" ? priority : undefined,
        note: note.trim() || undefined,
      });
      setDialog(null);
      setNote("");
      onDone(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {can("reject") && <Button variant="danger" onClick={() => setDialog("reject")} icon={<Forbidden className="size-4" />}>Reject</Button>}
      {can("confirm_incident") && <Button onClick={() => { setTitle(defaultTitle); setDialog("confirm"); }} icon={<TickCircle className="size-4" />}>Confirm as new incident</Button>}
      {can("reopen") && <Button variant="secondary" onClick={() => void run("reopen")} loading={busy} icon={<Refresh2 className="size-4" />}>Reopen for review</Button>}

      <Dialog
        open={dialog === "confirm"}
        onClose={() => setDialog(null)}
        title="Confirm as a new incident"
        description="Creates a canonical incident from this report. If it duplicates an existing report, link it from the duplicates panel instead."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => void run("confirm_incident")} loading={busy}>Create incident</Button></>}
      >
        <div className="space-y-4">
          {!report.hazard_category && <Callout tone="warn">Set a hazard category first, on the Report tab.</Callout>}
          <Field label="Incident title" htmlFor="inc-title">
            <Input id="inc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </Field>
          <Field label="Priority" htmlFor="inc-priority" hint={report.ai_priority ? `Model suggested: ${PRIORITY_LABEL[report.ai_priority]}` : undefined}>
            <Select id="inc-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(["routine", "elevated", "urgent"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Note" optional htmlFor="inc-note">
            <Textarea id="inc-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20" />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
        </div>
      </Dialog>

      <Dialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="Reject this report"
        description="Use for photos that don’t show an infrastructure hazard, spam, or unusable evidence. The report is kept and can be reopened."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger" onClick={() => void run("reject")} loading={busy}>Reject report</Button></>}
      >
        <Field label="Reason" htmlFor="rej-note">
          <Textarea id="rej-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Photo shows food, not a road or drain." />
        </Field>
        {error && <Callout tone="danger" className="mt-3">{error}</Callout>}
      </Dialog>
    </div>
  );
}

function CategoryCorrection({ report, onDone }: { report: ReportDetail; onDone: (r: ReportDetail) => void }) {
  const [value, setValue] = useState<HazardCategory | "">(report.hazard_category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value !== "" && value !== report.hazard_category;
  return (
    <Card>
      <CardHeader title="Hazard category" />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-[13px]">
          <div><dt className="text-ink-3">Resident</dt><dd>{report.reporter_category ? CATEGORY_LABEL[report.reporter_category] : "Not set"}</dd></div>
          <div><dt className="text-ink-3">Model</dt><dd>{report.ai_category ? CATEGORY_LABEL[report.ai_category] : "Not set"}</dd></div>
          <div><dt className="text-ink-3">Reviewer</dt><dd>{report.reviewer_category ? CATEGORY_LABEL[report.reviewer_category] : "Not set"}</dd></div>
        </dl>
        <div className="flex gap-2">
          <Select value={value} onChange={(e) => setValue(e.target.value as HazardCategory)} aria-label="Corrected category">
            <option value="" disabled>Choose category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
          <Button
            variant="secondary"
            disabled={!changed}
            loading={busy}
            onClick={async () => {
              if (!value) return;
              setBusy(true);
              setError(null);
              try {
                onDone(await api.correctCategory(report.id, value));
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Couldn't save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
      </CardBody>
    </Card>
  );
}

function JobsCard({ report }: { report: ReportDetail }) {
  // Finished jobs are already in the audit trail; this card only appears when there is something to watch or fix.
  if (report.jobs.every((j) => j.status === "succeeded")) return null;
  const label = { analyze_report: "Muse Spark analysis", segment_image: "SAM 3.1 segmentation", match_duplicates: "Duplicate matching" } as const;
  return (
    <Card>
      <CardHeader title="Processing jobs" />
      <ul className="divide-y divide-line text-[13px]">
        {report.jobs.map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <span>{label[j.kind]}</span>
            <span className="text-right text-ink-3">
              <span className={j.status === "failed" ? "text-danger" : j.status === "succeeded" ? "text-accent-ink" : ""}>{j.status}</span>
              {j.attempts > 1 && ` · ${j.attempts} attempts`}
              {j.error_code && <span className="block text-[12px]">{errorLabel(j.error_code)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
