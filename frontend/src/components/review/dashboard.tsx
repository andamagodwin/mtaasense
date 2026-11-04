"use client";

import { clsx } from "clsx";
import { ArrowRight, DirectInbox, Hierarchy, LocationSlash, SearchNormal1 } from "iconsax-reactjs";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { PRIORITY_LABEL, REPORT_STATUS_LABEL, formatDate, pct, timeAgo } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import type { ReportStatus, ReportSummary } from "@/lib/types";
import { CategoryBadge, IncidentStatusBadge, PriorityBadge, SampleBadge, SeverityBadge, StatusBadge, VerdictBadge } from "../badges";
import { useRequireReviewer } from "../session";
import { Card } from "../ui/card";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";
import { Input } from "../ui/field";
import { Page, PageHeader } from "../ui/page";
import { Thumb } from "./thumb";

const TABS = [
  { id: "queue", label: "Review queue" },
  { id: "duplicates", label: "Duplicates" },
  { id: "incidents", label: "Incidents" },
  { id: "unlocated", label: "Unlocated" },
  { id: "all", label: "All reports" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function ReviewDashboard() {
  const session = useRequireReviewer();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "queue") as Tab;
  const summary = useApi(() => api.reviewSummary(), session.allowed ? "summary" : null);
  usePolling(summary.reload, 10000, session.allowed);

  if (!session.allowed) {
    return <Page><Skeleton className="h-96" /></Page>;
  }

  const s = summary.data;
  // The counts live on the tabs themselves, so there is one place to look and one place to click.
  const counts: Record<Tab, number | undefined> = {
    queue: s?.reports_awaiting_review,
    duplicates: s?.potential_duplicates,
    incidents: s ? s.incidents_confirmed + s.incidents_resolved : undefined,
    unlocated: s?.unlocated_reports,
    all: s?.reports_total,
  };
  const setTab = (t: Tab) => router.replace(`${pathname}?tab=${t}`, { scroll: false });

  return (
    <Page>
      <PageHeader
        title="Review workspace"
        description="Check AI assessments against the original evidence, link duplicate reports and manage incidents."
      />

      {s && s.processing_failures > 0 && (
        <Callout tone="warn" className="mb-6">
          {s.processing_failures} report{s.processing_failures === 1 ? "" : "s"} failed AI processing and{" "}
          {s.processing_failures === 1 ? "is" : "are"} waiting in the review queue.
        </Callout>
      )}

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] transition-colors",
              tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
            {counts[t.id] !== undefined && (
              <span
                className={clsx(
                  "rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                  t.id === "queue" && counts.queue ? "bg-accent-soft text-accent-ink" : "bg-sunken text-ink-3",
                )}
              >
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "queue" && <ReportTable statuses={["under_review", "processing_failed"]} empty="No reports are waiting for review." />}
      {tab === "all" && <ReportTable searchable empty="No reports have been submitted yet." />}
      {tab === "unlocated" && <ReportTable hasLocation={false} empty="Every report has a location." />}
      {tab === "duplicates" && <DuplicateList />}
      {tab === "incidents" && <IncidentTable />}

      {s && s.sample_records > 0 && (
        <p className="mt-6 text-[12.5px] text-ink-3">
          Includes {s.sample_records} sample record{s.sample_records === 1 ? "" : "s"}, marked <SampleBadge />
        </p>
      )}
    </Page>
  );
}

function ReportTable({ statuses, hasLocation, searchable, empty }: { statuses?: ReportStatus[]; hasLocation?: boolean; searchable?: boolean; empty: string }) {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const reports = useApi(
    () => api.reports({ status: statuses, has_location: hasLocation, q: q || undefined, limit, offset }),
    JSON.stringify({ statuses, hasLocation, q, offset }),
  );
  usePolling(reports.reload, 8000, true);
  const page = reports.data;

  return (
    <Card>
      {page?.rain_boosted && (
        <div className="border-b border-line px-5 py-3">
          <Callout tone="warn" title="Heavy rain expected in the next 24 hours">
            Blocked drains are first in the queue so they can be confirmed before the rain.
          </Callout>
        </div>
      )}
      {searchable && (
        <div className="border-b border-line px-5 py-3">
          <div className="relative max-w-sm">
            <SearchNormal1 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search reference or description" className="pl-9" aria-label="Search reports" />
          </div>
        </div>
      )}
      {reports.error && <Callout tone="danger" className="m-5">{reports.error.message}</Callout>}
      {!page && <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>}
      {page && page.items.length === 0 && <EmptyState icon={<DirectInbox className="size-5" />} title={empty} />}
      {page && page.items.length > 0 && (
        <>
          <ul className="divide-y divide-line">
            {page.items.map((r) => <ReportRow key={r.id} report={r} />)}
          </ul>
          {page.total > limit && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-ink-3">
              <span>{offset + 1}–{Math.min(offset + limit, page.total)} of {page.total}</span>
              <div className="flex gap-2">
                <button className="rounded px-2 py-1 hover:bg-sunken disabled:opacity-40" disabled={offset === 0} onClick={() => setOffset(offset - limit)}>Previous</button>
                <button className="rounded px-2 py-1 hover:bg-sunken disabled:opacity-40" disabled={offset + limit >= page.total} onClick={() => setOffset(offset + limit)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ReportRow({ report: r }: { report: ReportSummary }) {
  return (
    <li>
      <Link href={`/review/reports/${r.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-paper">
        <Thumb media={r.thumbnail} className="size-14" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-medium">{r.reference}</span>
            <StatusBadge status={r.status} />
            {r.is_sample && <SampleBadge />}
          </div>
          <p className="mt-1 line-clamp-1 text-[13.5px] text-ink-2">{r.ai_summary ?? r.description}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {timeAgo(r.created_at)}
            {!r.location && " · no location"}
            {r.has_audio && " · voice note"}
            {r.incident && ` · ${r.incident.reference}`}
          </p>
        </div>
        <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 md:flex md:max-w-[340px]">
          <CategoryBadge category={r.hazard_category} />
          {r.ai_severity && r.ai_severity !== "undetermined" && <SeverityBadge severity={r.ai_severity} />}
          {r.ai_priority && r.ai_priority !== "routine" && <PriorityBadge priority={r.ai_priority} />}
          {r.open_duplicate_suggestions > 0 && (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-warn-line bg-warn-soft px-1.5 text-[12px] font-medium text-warn-ink">
              <Hierarchy className="size-3" /> {r.open_duplicate_suggestions} possible duplicate{r.open_duplicate_suggestions === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <ArrowRight className="size-4 shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}

function DuplicateList() {
  const list = useApi(() => api.suggestions({ limit: 50 }), "suggestions");
  usePolling(list.reload, 8000, true);
  if (list.error) return <Callout tone="danger">{list.error.message}</Callout>;
  if (!list.data) return <Skeleton className="h-40" />;
  if (list.data.items.length === 0)
    return <Card><EmptyState icon={<Hierarchy className="size-5" />} title="No open duplicate suggestions">New reports are matched automatically against nearby reports of the same kind.</EmptyState></Card>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {list.data.items.map((s) => (
        <Link key={s.id} href={`/review/duplicates/${s.id}`} className="group rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-ink px-1.5 py-0.5 font-mono text-[12px] text-white">match {pct(s.score)}</span>
              {s.model_verdict && <VerdictBadge verdict={s.model_verdict} />}
              {s.status === "deferred" && <span className="text-[12px] text-ink-3">deferred</span>}
            </div>
            <span className="text-[12px] text-ink-3">{timeAgo(s.created_at)}</span>
          </div>
          <div className="flex items-center gap-3">
            <PairSide report={s.source} label="New report" />
            <Hierarchy className="size-4 shrink-0 text-ink-3" />
            <PairSide report={s.candidate} label={s.candidate.incident ? s.candidate.incident.reference : "Existing report"} />
          </div>
          <p className="mt-3 text-[12.5px] text-ink-3">
            {s.signals.distance_m !== null ? `${Math.round(s.signals.distance_m)} m apart` : "Distance unknown"} · {Math.round(s.signals.hours_apart)} h apart
            {s.signals.category_relation && ` · ${s.signals.category_relation.replace("_", " ")} category`}
          </p>
        </Link>
      ))}
    </div>
  );
}

function PairSide({ report, label }: { report: ReportSummary; label: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <Thumb media={report.thumbnail} className="size-14" />
      <div className="min-w-0">
        <p className="text-[11px] text-ink-3">{label}</p>
        <p className="font-mono text-[13px] font-medium">{report.reference}</p>
        <p className="truncate text-[12px] text-ink-3">{REPORT_STATUS_LABEL[report.status]}</p>
      </div>
    </div>
  );
}

function IncidentTable() {
  const list = useApi(() => api.incidents({ limit: 100 }), "incidents");
  if (list.error) return <Callout tone="danger">{list.error.message}</Callout>;
  if (!list.data) return <Skeleton className="h-40" />;
  if (list.data.items.length === 0)
    return <Card><EmptyState icon={<LocationSlash className="size-5" />} title="No incidents yet">Confirm a report (or a duplicate pair) to create the first canonical incident.</EmptyState></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {list.data.items.map((i) => (
          <li key={i.id}>
            <Link href={`/review/incidents/${i.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-paper">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] text-ink-3">{i.reference}</span>
                  <span className="text-[14px] font-medium">{i.title}</span>
                  {i.is_sample && <SampleBadge />}
                </div>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {i.report_count} report{i.report_count === 1 ? "" : "s"} · updated {formatDate(i.updated_at)} · {PRIORITY_LABEL[i.priority]} priority
                  {!i.location && " · no location"}
                </p>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex">
                <CategoryBadge category={i.hazard_category} />
                <IncidentStatusBadge status={i.status} />
              </div>
              <ArrowRight className="size-4 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
