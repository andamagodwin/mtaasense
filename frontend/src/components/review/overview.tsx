"use client";

import { ArrowRight, DirectInbox, Flag } from "iconsax-reactjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { CATEGORY_HEX, CATEGORY_LABEL, PRIORITY_LABEL, timeAgo } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import type { HazardCategory } from "@/lib/types";
import { CategoryBadge, CategoryDot, SampleMark, SeverityBadge } from "../badges";
import { useReviewSummary } from "../dashboard/shell";
import { useSession } from "../session";
import { LinkButton } from "../ui/button";
import { Card, CardHeader } from "../ui/card";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";
import { Page, PageHeader } from "../ui/page";
import { Thumb } from "./thumb";

// Old links used /review?tab=…; each tab is now its own page.
const LEGACY_TABS: Record<string, string> = {
  queue: "/review/queue",
  duplicates: "/review/duplicates",
  incidents: "/review/incidents",
  unlocated: "/review/reports?filter=unlocated",
  all: "/review/reports",
};

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** One decision at a time: the report at the front of the queue, and one way to start. */
function NextUp() {
  const summary = useReviewSummary().data;
  const queue = useApi(() => api.reports({ status: ["under_review", "processing_failed"], limit: 1 }), "overview:next");
  usePolling(queue.reload, 10000, true);
  const next = queue.data?.items[0];
  const waiting = queue.data?.total ?? 0;

  if (!queue.data) return <Skeleton className="h-44" />;
  if (!next) {
    return (
      <Card>
        <EmptyState icon={<DirectInbox className="size-5" />} title="All caught up">
          {summary && summary.potential_duplicates > 0 ? (
            <Link href="/review/duplicates" className="font-medium text-accent hover:text-accent-hover">
              Compare {summary.potential_duplicates} possible duplicate{summary.potential_duplicates === 1 ? "" : "s"}
            </Link>
          ) : null}
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <Thumb media={next.thumbnail} className="aspect-[4/3] w-full sm:size-36 sm:w-36" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">Next up</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[15px] font-medium">{next.reference}</span>
            <CategoryBadge category={next.hazard_category} />
            {next.is_sample && <SampleMark />}
          </div>
          <p className="mt-2 line-clamp-2 text-[14.5px] leading-relaxed text-ink-2">{next.ai_summary ?? next.description}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">{timeAgo(next.created_at)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <LinkButton href={`/review/reports/${next.id}`} size="lg" icon={<ArrowRight className="size-4" />}>
            Review
          </LinkButton>
          {waiting > 1 && (
            <Link href="/review/queue" className="text-center text-[13px] text-ink-3 hover:text-ink sm:text-right">
              {waiting - 1} more waiting
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ReviewOverview() {
  const router = useRouter();
  const params = useSearchParams();
  const legacy = LEGACY_TABS[params.get("tab") ?? ""];
  useEffect(() => {
    if (legacy) router.replace(legacy);
  }, [legacy, router]);

  const { user } = useSession();
  const summary = useReviewSummary().data;
  const rain = useApi((signal) => api.rain(signal), "rain");
  const incidents = useApi(() => api.incidents({ status: ["confirmed"], limit: 5 }), "overview:incidents");
  usePolling(incidents.reload, 20000, true);

  const categories = Object.entries(summary?.by_category ?? {}).sort((a, b) => b[1] - a[1]);
  const most = Math.max(1, ...categories.map(([, n]) => n));
  const firstName = user?.display_name.split(/\s+/)[0];
  const failures = summary?.processing_failures ?? 0;

  return (
    <Page>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} />

      {(rain.data?.active || failures > 0) && (
        <div className="mb-6 space-y-3">
          {rain.data?.active && (
            <Callout tone="warn" title={`Heavy rain expected: ${rain.data.expected_mm_24h} mm in 24 hours`}>
              Blocked drains come first in the queue.
            </Callout>
          )}
          {failures > 0 && (
            <Callout tone="warn">
              {failures} report{failures === 1 ? "" : "s"} failed AI processing.
            </Callout>
          )}
        </div>
      )}

      <NextUp />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={
              <span className="flex items-baseline gap-2">
                Open incidents
                {incidents.data && <span className="font-mono text-[13px] font-normal text-ink-3">{incidents.data.total}</span>}
              </span>
            }
            action={
              <Link href="/review/incidents" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover">
                All <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {!incidents.data && <div className="p-5"><Skeleton className="h-32" /></div>}
          {incidents.data && incidents.data.items.length === 0 && <EmptyState icon={<Flag className="size-5" />} title="None open" />}
          {incidents.data && incidents.data.items.length > 0 && (
            <ul className="divide-y divide-line">
              {incidents.data.items.map((i) => (
                <li key={i.id}>
                  <Link href={`/review/incidents/${i.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken/60">
                    <CategoryDot category={i.hazard_category} className="size-2.5" />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{i.title}</span>
                    {i.is_sample && <SampleMark />}
                    {(i.severity === "high" || i.severity === "critical") && <SeverityBadge severity={i.severity} prefix={false} />}
                    {i.priority === "urgent" && <span className="text-[12.5px] font-medium text-danger">{PRIORITY_LABEL.urgent}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Waiting by hazard" />
          <div className="space-y-3.5 p-5">
            {!summary && <Skeleton className="h-24" />}
            {summary && categories.length === 0 && <p className="text-[13px] text-ink-3">Nothing waiting.</p>}
            {categories.map(([key, n]) => {
              const known = key in CATEGORY_LABEL;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="text-ink-2">{known ? CATEGORY_LABEL[key as HazardCategory] : "Uncategorised"}</span>
                    <span className="font-mono tabular-nums text-ink">{n}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sunken">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(n / most) * 100}%`, background: known ? CATEGORY_HEX[key as HazardCategory] : "var(--color-ink-3)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </Page>
  );
}
