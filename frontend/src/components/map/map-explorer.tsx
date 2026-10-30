"use client";

import { clsx } from "clsx";
import { ArrowUpRight, Layers, MapPinOff, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { CATEGORY_HEX, CATEGORY_LABEL, formatDate, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { HazardCategory, IncidentStatus, MapFeatures } from "@/lib/types";
import { CategoryBadge, IncidentStatusBadge, PriorityBadge, SampleBadge, SeverityBadge } from "../badges";
import { useSession } from "../session";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";
import { IncidentMap, type Selection } from "./incident-map";

const CATEGORIES: HazardCategory[] = ["pothole", "road_surface_damage", "blocked_drainage", "flooding"];
const EMPTY: MapFeatures = { incidents: [], reports: [], unlocated_incidents: 0, unlocated_reports: 0 };
const STATUSES: { value: IncidentStatus; label: string }[] = [
  { value: "confirmed", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

export function MapExplorer() {
  const { user } = useSession();
  const [categories, setCategories] = useState<HazardCategory[]>([]);
  const [statuses, setStatuses] = useState<IncidentStatus[]>(["confirmed", "resolved"]);
  const [showUnreviewed, setShowUnreviewed] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);

  const query = { category: categories, status: statuses.length === 2 ? [] : statuses, include_unreviewed: showUnreviewed };
  const key = JSON.stringify(query);
  const features = useApi(() => api.mapFeatures(query), statuses.length === 0 ? null : key);
  const data = statuses.length === 0 ? EMPTY : features.data;

  const selectedIncident = selection?.kind === "incident" ? data?.incidents.find((i) => i.id === selection.id) : undefined;
  const selectedReport = selection?.kind === "report" ? data?.reports.find((r) => r.id === selection.id) : undefined;
  const incidentDetail = useApi(() => api.incident(selectedIncident!.id), selectedIncident ? `inc:${selectedIncident.id}` : null);

  const total = (data?.incidents.length ?? 0) + (data?.reports.length ?? 0);
  const sorted = useMemo(
    () => [...(data?.incidents ?? [])].sort((a, b) => (a.status === b.status ? 0 : a.status === "confirmed" ? -1 : 1)),
    [data],
  );

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh-56px)] lg:flex-none lg:flex-row">
      <aside className="order-2 flex w-full flex-col border-line bg-paper lg:order-1 lg:min-h-0 lg:w-[400px] lg:overflow-hidden lg:border-r">
        <div className="space-y-3 border-b border-line px-4 py-4">
          <div className="flex items-baseline justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Incident map</h1>
            <span className="text-[12.5px] text-ink-3">{features.loading ? "Loading…" : `${total} on map`}</span>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by hazard type">
            {CATEGORIES.map((c) => {
              const on = categories.length === 0 || categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={categories.includes(c)}
                  onClick={() => setCategories((prev) => toggle(prev, c))}
                  className={clsx(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors",
                    categories.includes(c) ? "border-ink bg-surface text-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                    !on && "opacity-50",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: CATEGORY_HEX[c] }} />
                  {CATEGORY_LABEL[c]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            {STATUSES.map((s) => (
              <label key={s.value} className="inline-flex items-center gap-1.5 text-ink-2">
                <input
                  type="checkbox"
                  checked={statuses.includes(s.value)}
                  onChange={() => setStatuses((prev) => toggle(prev, s.value))}
                  className="size-4 accent-[var(--color-accent)]"
                />
                {s.label} incidents
              </label>
            ))}
            <label className="inline-flex items-center gap-1.5 text-ink-2">
              <input type="checkbox" checked={showUnreviewed} onChange={(e) => setShowUnreviewed(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              Unreviewed reports
            </label>
          </div>
          <Legend />
        </div>

        {selection && (selectedIncident || selectedReport) && (
          <div className="border-b border-line bg-surface px-4 py-4 animate-fade-in">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                {selectedIncident ? "Canonical incident" : "Individual report · not yet reviewed"}
              </p>
              <button type="button" onClick={() => setSelection(null)} className="text-ink-3 hover:text-ink" aria-label="Clear selection">
                <X className="size-4" />
              </button>
            </div>
            {selectedIncident && (
              <div className="space-y-2.5">
                <h2 className="text-[15px] font-semibold leading-snug">{selectedIncident.title}</h2>
                <div className="flex flex-wrap gap-1.5">
                  <IncidentStatusBadge status={selectedIncident.status} />
                  <CategoryBadge category={selectedIncident.hazard_category} />
                  <PriorityBadge priority={selectedIncident.priority} />
                  {selectedIncident.severity !== "undetermined" && <SeverityBadge severity={selectedIncident.severity} />}
                  {selectedIncident.is_sample && <SampleBadge />}
                </div>
                {incidentDetail.data?.summary && <p className="text-[13.5px] leading-relaxed text-ink-2">{incidentDetail.data.summary}</p>}
                <p className="text-[12.5px] text-ink-3">
                  {selectedIncident.report_count} linked report{selectedIncident.report_count === 1 ? "" : "s"}
                  {incidentDetail.data?.first_reported_at && <> · first reported {formatDate(incidentDetail.data.first_reported_at)}</>}
                  {selectedIncident.resolved_at && <> · resolved {formatDate(selectedIncident.resolved_at)}</>}
                </p>
                {user ? (
                  <Link href={`/review/incidents/${selectedIncident.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover">
                    Open evidence <ArrowUpRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="text-[12px] text-ink-3">Photos are visible to reviewers only.</p>
                )}
              </div>
            )}
            {selectedReport && (
              <div className="space-y-2">
                <p className="font-mono text-[14px] font-medium">{selectedReport.reference}</p>
                <div className="flex flex-wrap gap-1.5">
                  <CategoryBadge category={selectedReport.hazard_category} />
                  {selectedReport.is_sample && <SampleBadge />}
                </div>
                <p className="text-[12.5px] text-ink-3">Submitted {timeAgo(selectedReport.created_at)} · awaiting a reviewer</p>
                {user && (
                  <Link href={`/review/reports/${selectedReport.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover">
                    Review this report <ArrowUpRight className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {features.error && <Callout tone="danger" className="m-4">{features.error.message}</Callout>}
          {!data && features.loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          )}
          {data && total === 0 && (
            <EmptyState icon={<Layers className="size-5" />} title="Nothing to show yet">
              {categories.length || statuses.length < 2 ? "No incidents match these filters." : "Once residents report hazards with a location, they appear here."}
            </EmptyState>
          )}
          {data && total > 0 && (
            <ul className="divide-y divide-line" aria-label="Incidents and reports">
              {sorted.map((i) => (
                <ListRow
                  key={i.id}
                  active={selection?.kind === "incident" && selection.id === i.id}
                  onClick={() => setSelection({ kind: "incident", id: i.id })}
                  color={CATEGORY_HEX[i.hazard_category]}
                  filled
                  dim={i.status === "resolved"}
                  title={i.title}
                  meta={`${i.reference} · ${i.report_count} report${i.report_count === 1 ? "" : "s"} · ${i.status === "resolved" ? "resolved" : "open"}`}
                  sample={i.is_sample}
                />
              ))}
              {data.reports.map((r) => (
                <ListRow
                  key={r.id}
                  active={selection?.kind === "report" && selection.id === r.id}
                  onClick={() => setSelection({ kind: "report", id: r.id })}
                  color={r.hazard_category ? CATEGORY_HEX[r.hazard_category] : "#878174"}
                  title={r.hazard_category ? CATEGORY_LABEL[r.hazard_category] : "Uncategorised report"}
                  meta={`${r.reference} · unreviewed · ${timeAgo(r.created_at)}`}
                  sample={r.is_sample}
                />
              ))}
            </ul>
          )}
          {data && (data.unlocated_incidents > 0 || data.unlocated_reports > 0) && (
            <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-[12.5px] leading-relaxed text-ink-3">
              <MapPinOff className="mt-0.5 size-3.5 shrink-0" />
              {data.unlocated_incidents + data.unlocated_reports} record{data.unlocated_incidents + data.unlocated_reports === 1 ? " has" : "s have"} no location and {data.unlocated_incidents + data.unlocated_reports === 1 ? "isn’t" : "aren’t"} plotted. We never guess coordinates.
              {user && <Link href="/review?tab=unlocated" className="underline">See them</Link>}
            </p>
          )}
        </div>
      </aside>
      <div className="relative order-1 h-[52vh] lg:order-2 lg:h-auto lg:flex-1">
        <IncidentMap features={data} selection={selection} onSelect={setSelection} className="absolute inset-0" />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full border-2 border-white bg-ink-2 shadow-[0_0_0_1px_var(--color-line-strong)]" />
        Confirmed incident (size = reports)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full border-[2.5px] border-ink-2 bg-white" />
        Unreviewed report
      </span>
    </div>
  );
}

function ListRow({ active, onClick, color, filled, dim, title, meta, sample }: {
  active: boolean; onClick: () => void; color: string; filled?: boolean; dim?: boolean; title: string; meta: string; sample: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active || undefined}
        className={clsx("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors", active ? "bg-accent-soft/50" : "hover:bg-sunken/60")}
      >
        <span
          className={clsx("mt-1 size-3 shrink-0 rounded-full", dim && "opacity-50")}
          style={filled ? { background: color, boxShadow: "0 0 0 2px #fff, 0 0 0 3px #d1c9ba" } : { border: `2.5px solid ${color}`, background: "#fff" }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
          <span className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
            <span className="truncate font-mono">{meta}</span>
            {sample && <span className="shrink-0 rounded border border-dashed border-line-strong px-1 text-[10.5px]">sample</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
