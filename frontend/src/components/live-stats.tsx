"use client";

import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/feedback";

export function LiveStats() {
  const stats = useApi(() => api.stats(), "stats");
  const config = useApi(() => api.config(), "config");

  const items = stats.data
    ? [
        { label: "Reports received", value: stats.data.reports_total },
        { label: "Awaiting review", value: stats.data.reports_under_review },
        { label: "Confirmed incidents", value: stats.data.incidents_confirmed },
        { label: "Resolved incidents", value: stats.data.incidents_resolved },
      ]
    : [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
          <Activity className="size-4 text-accent" />
          Live from the database
        </p>
        {config.data && (
          <span
            className={`inline-flex items-center gap-1.5 text-[12px] ${config.data.model_api_configured ? "text-accent-ink" : "text-ink-3"}`}
          >
            <span className={`size-1.5 rounded-full ${config.data.model_api_configured ? "bg-accent" : "bg-ink-3"}`} />
            {config.data.model_api_configured ? "Meta AI connected" : "AI not configured"}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2">
        {stats.loading && !stats.data
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border-b border-r border-line p-5 [&:nth-child(2n)]:border-r-0">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-8 w-12" />
              </div>
            ))
          : items.map((item) => (
              <div key={item.label} className="border-b border-r border-line p-5 [&:nth-child(2n)]:border-r-0">
                <dt className="text-[12.5px] text-ink-3">{item.label}</dt>
                <dd className="mt-1 text-[30px] font-semibold tracking-tight text-ink tabular-nums">{item.value}</dd>
              </div>
            ))}
      </dl>
      <div className="px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-3">
        {stats.error
          ? "Live counts are unavailable right now."
          : stats.data && stats.data.sample_records > 0
            ? `Includes ${stats.data.sample_records} clearly labelled sample report${stats.data.sample_records === 1 ? "" : "s"} seeded for demonstration.`
            : "Counts come straight from submitted reports and reviewer decisions."}
      </div>
    </Card>
  );
}
