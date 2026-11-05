"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useReviewSummary } from "../dashboard/shell";
import { Page, PageHeader } from "../ui/page";
import { ReportTable } from "./dashboard";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unlocated", label: "No location" },
] as const;

/** Every report, or only those without a location. */
export function ReportsView() {
  const filter = useSearchParams().get("filter") === "unlocated" ? "unlocated" : "all";
  const unlocated = useReviewSummary().data?.unlocated_reports;

  return (
    <Page>
      <PageHeader
        title="Reports"
        actions={
          <div className="inline-flex rounded-xl border border-line bg-sunken p-1" role="tablist" aria-label="Filter reports">
            {FILTERS.map((f) => (
              <Link
                key={f.id}
                href={f.id === "all" ? "/review/reports" : "/review/reports?filter=unlocated"}
                role="tab"
                aria-selected={filter === f.id}
                className={clsx(
                  "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13.5px] transition-colors",
                  filter === f.id ? "bg-surface font-medium text-ink shadow-[var(--shadow-card)]" : "text-ink-3 hover:text-ink",
                )}
              >
                {f.label}
                {f.id === "unlocated" && unlocated !== undefined && unlocated > 0 && (
                  <span className="grid size-[20px] place-items-center rounded-full bg-ink-3/15 font-mono text-[10.5px] tabular-nums text-ink-2">
                    {unlocated > 99 ? "99+" : unlocated}
                  </span>
                )}
              </Link>
            ))}
          </div>
        }
      />
      {filter === "unlocated" ? (
        <ReportTable key="unlocated" hasLocation={false} showStatus empty="Every report has a location." />
      ) : (
        <ReportTable key="all" searchable showStatus empty="No reports yet." />
      )}
    </Page>
  );
}
