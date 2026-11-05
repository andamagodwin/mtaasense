"use client";

import { clsx } from "clsx";
import { ArrowRight, CloseCircle, Layer, LocationSlash } from "iconsax-reactjs";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { CATEGORY_HEX, CATEGORY_LABEL, REPORT_STATUS_LABEL, formatDate, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { HazardCategory, MapFeatures, MediaRef, ReportStatus } from "@/lib/types";
import {
  CategoryBadge,
  IncidentStatusBadge,
  PriorityBadge,
  SampleBadge,
  SeverityBadge,
  StatusBadge,
} from "../badges";
import { IncidentMap, type Selection } from "../map/incident-map";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";
import { Thumb } from "./thumb";

const CATEGORIES: HazardCategory[] = ["pothole", "road_surface_damage", "blocked_drainage", "flooding"];
const NEEDS_DECISION: ReportStatus[] = ["submitted", "processing", "under_review", "processing_failed"];

function initialSelection(): Selection {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const uuid = (value: string | null) => (value && /^[0-9a-f-]{36}$/i.test(value) ? value : null);
  const incident = uuid(params.get("incident"));
  if (incident) return { kind: "incident", id: incident };
  const report = uuid(params.get("report"));
  if (report) return { kind: "report", id: report };
  return null;
}

/** The reviewer map: every located report with its photo, words and status, inside the dashboard. */
export function ReviewMap() {
  // Two decisions at most: one hazard type (or all), and whether decided records stay on the map.
  const [category, setCategory] = useState<HazardCategory | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [selection, setSelection] = useState<Selection>(initialSelection);

  const query = { category: category ? [category] : [] };
  const features = useApi(() => api.reviewMapFeatures(query), JSON.stringify(query));
  const data = features.data;

  const incidents = useMemo(
    () => (data ? (showDecided ? data.incidents : data.incidents.filter((i) => i.status === "confirmed")) : []),
    [data, showDecided],
  );
  const reports = useMemo(
    () => (data ? (showDecided ? data.reports : data.reports.filter((r) => NEEDS_DECISION.includes(r.status))) : []),
    [data, showDecided],
  );
  // The map only needs positions; the panel and list below use the full summaries.
  const view: MapFeatures | null = useMemo(
    () =>
      data
        ? {
            incidents,
            reports: reports.map((r) => ({
              id: r.id,
              reference: r.reference,
              hazard_category: r.hazard_category,
              status: r.status,
              location: r.location!,
              created_at: r.created_at,
              is_sample: r.is_sample,
            })),
            unlocated_incidents: data.unlocated_incidents,
            unlocated_reports: data.unlocated_reports,
          }
        : null,
    [data, incidents, reports],
  );

  const selectedIncident = selection?.kind === "incident" ? incidents.find((i) => i.id === selection.id) : undefined;
  // A record linked from elsewhere still opens even when the current filter hides it.
  const selectedReport =
    selection?.kind === "report" ? data?.reports.find((r) => r.id === selection.id) : undefined;
  const incidentDetail = useApi(
    () => api.incident(selectedIncident!.id),
    selectedIncident ? `inc:${selectedIncident.id}` : null,
  );

  const total = incidents.length + reports.length;
  const unlocated = (data?.unlocated_incidents ?? 0) + (data?.unlocated_reports ?? 0);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-start">
      <aside className="order-2 flex w-full flex-col border-line bg-paper lg:order-1 lg:w-[400px] lg:shrink-0 lg:rounded-xl lg:border">
        <div className="space-y-3 border-b border-line p-5">
          <div className="flex items-baseline justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Review map</h1>
            <span className="text-[12.5px] text-ink-3">{features.loading ? "Loading…" : `${total} on map`}</span>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hazard type">
            {[null, ...CATEGORIES].map((c) => {
              const on = category === c;
              return (
                <button
                  key={c ?? "all"}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCategory(c)}
                  className={clsx(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors",
                    on ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                  )}
                >
                  {c && <span className="size-2 rounded-full" style={{ background: CATEGORY_HEX[c] }} />}
                  {c ? CATEGORY_LABEL[c] : "All"}
                </button>
              );
            })}
          </div>
          <label className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={showDecided}
              onChange={(e) => setShowDecided(e.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Include decided reports and resolved incidents
          </label>
        </div>

        {selection && (selectedIncident || selectedReport) && (
          <div className="border-b border-line bg-surface p-5 animate-fade-in">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                {selectedIncident ? "Canonical incident" : REPORT_STATUS_LABEL[selectedReport!.status]}
              </p>
              <button type="button" onClick={() => setSelection(null)} className="text-ink-3 hover:text-ink" aria-label="Clear selection">
                <CloseCircle className="size-4" />
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
                <Link href={`/review/incidents/${selectedIncident.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover">
                  Open incident <ArrowRight className="size-3.5" />
                </Link>
              </div>
            )}
            {selectedReport && (
              <div className="space-y-2.5">
                <div className="flex items-start gap-3">
                  <Thumb media={selectedReport.thumbnail} className="aspect-square w-20 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[14px] font-medium">{selectedReport.reference}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">
                      Submitted {timeAgo(selectedReport.created_at)}
                      {selectedReport.location_note && <> · {selectedReport.location_note}</>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={selectedReport.status} />
                  <CategoryBadge category={selectedReport.hazard_category} />
                  {selectedReport.ai_severity && selectedReport.ai_severity !== "undetermined" && (
                    <SeverityBadge severity={selectedReport.ai_severity} />
                  )}
                  {selectedReport.is_sample && <SampleBadge />}
                </div>
                <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ink-2">{selectedReport.description}</p>
                {selectedReport.ai_summary && (
                  <p className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-3">AI: {selectedReport.ai_summary}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <Link href={`/review/reports/${selectedReport.id}`} className="inline-flex items-center gap-1 font-medium text-accent hover:text-accent-hover">
                    Open review <ArrowRight className="size-3.5" />
                  </Link>
                  {selectedReport.open_duplicate_suggestions > 0 && (
                    <Link href={`/review/reports/${selectedReport.id}?tab=duplicates`} className="font-medium text-accent hover:text-accent-hover">
                      {selectedReport.open_duplicate_suggestions} possible duplicate{selectedReport.open_duplicate_suggestions === 1 ? "" : "s"}
                    </Link>
                  )}
                  {selectedReport.incident && (
                    <Link href={`/review/incidents/${selectedReport.incident.id}`} className="text-ink-3 hover:text-ink">
                      Part of {selectedReport.incident.reference}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 lg:max-h-[60vh] lg:overflow-y-auto">
          {features.error && <Callout tone="danger" className="m-5">{features.error.message}</Callout>}
          {!data && features.loading && (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          )}
          {data && total === 0 && (
            <EmptyState icon={<Layer className="size-5" />} title="Nothing to show yet">
              {category || !showDecided ? "No records match these filters." : "Once residents report hazards with a location, they appear here."}
            </EmptyState>
          )}
          {data && total > 0 && (
            <ul className="divide-y divide-line" aria-label="Reports and incidents">
              {reports.map((r) => (
                <ListRow
                  key={r.id}
                  active={selection?.kind === "report" && selection.id === r.id}
                  onClick={() => setSelection({ kind: "report", id: r.id })}
                  color={r.hazard_category ? CATEGORY_HEX[r.hazard_category] : undefined}
                  title={r.reference}
                  meta={`${REPORT_STATUS_LABEL[r.status]} · ${timeAgo(r.created_at)}${r.open_duplicate_suggestions > 0 ? ` · ${r.open_duplicate_suggestions} duplicate${r.open_duplicate_suggestions === 1 ? "" : "s"}` : ""}`}
                  sample={r.is_sample}
                  thumb={r.thumbnail}
                />
              ))}
              {incidents.map((i) => (
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
            </ul>
          )}
          {data && unlocated > 0 && (
            <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-[12.5px] leading-relaxed text-ink-3">
              <LocationSlash className="mt-0.5 size-3.5 shrink-0" />
              {unlocated} record{unlocated === 1 ? " has" : "s have"} no location and {unlocated === 1 ? "isn’t" : "aren’t"} plotted.{" "}
              <Link href="/review/reports?filter=unlocated" className="underline">See them</Link>
            </p>
          )}
        </div>
      </aside>
      <div className="relative order-1 h-[52vh] w-full lg:order-2 lg:sticky lg:top-4 lg:h-[calc(100dvh-32px)] lg:flex-1">
        <IncidentMap
          features={view}
          selection={selection}
          onSelect={setSelection}
          className="absolute inset-0 overflow-hidden lg:rounded-xl lg:border lg:border-line"
        />
      </div>
    </div>
  );
}

function ListRow({ active, onClick, color, filled, dim, title, meta, sample, thumb }: {
  active: boolean;
  onClick: () => void;
  color?: string;
  filled?: boolean;
  dim?: boolean;
  title: string;
  meta: string;
  sample: boolean;
  thumb?: MediaRef | null;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active || undefined}
        className={clsx("flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors", active ? "bg-accent-soft/50" : "hover:bg-sunken/60")}
      >
        {thumb ? (
          <Thumb media={thumb} className="size-10" />
        ) : (
          <span
            className={clsx("size-3 shrink-0 rounded-full", dim && "opacity-50")}
            style={
              filled
                ? { background: color, boxShadow: "0 0 0 2px var(--color-surface), 0 0 0 3px var(--color-line-strong)" }
                : { border: `2.5px solid ${color ?? "var(--color-ink-3)"}`, background: "var(--color-surface)" }
            }
          />
        )}
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
