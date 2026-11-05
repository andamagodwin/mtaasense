"use client";

import { clsx } from "clsx";
import { ArrowRight, DirectInbox, Flag, Hierarchy, LocationSlash, MagicStar } from "iconsax-reactjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ComponentType, type ReactNode } from "react";
import { api } from "@/lib/api";
import { CATEGORY_HEX, CATEGORY_LABEL, PRIORITY_LABEL, formatDate, formatHour, timeAgo } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import type { HazardCategory } from "@/lib/types";
import { askAssistant } from "../assistant/review-assistant";
import { CategoryBadge, SampleBadge, SeverityBadge } from "../badges";
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
  unlocated: "/review/unlocated",
  all: "/review/reports",
};

const QUICK_QUESTIONS = [
  "What should I look at first today?",
  "Which open incidents have the most reports?",
  "Draft a short update for KCCA on open blocked drains",
];

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function Stat({
  label,
  value,
  hint,
  href,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: number | undefined;
  hint: ReactNode;
  href: string;
  icon: ComponentType<{ className?: string; variant?: "Linear" | "Bold" }>;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium leading-snug text-ink-2">{label}</span>
        <span className={clsx("grid size-8 shrink-0 place-items-center rounded-lg", highlight ? "bg-accent text-white" : "bg-sunken text-ink-3")}>
          <Icon className="size-4" variant={highlight ? "Bold" : "Linear"} />
        </span>
      </div>
      <div className="mt-3 font-mono text-[28px] font-medium sm:text-[32px] leading-none tracking-tight tabular-nums text-ink">
        {value ?? <Skeleton className="h-8 w-12" />}
      </div>
      <p className="mt-2 flex items-center justify-between gap-2 text-[12px] leading-snug text-ink-3 sm:text-[12.5px]">
        <span>{hint}</span>
        <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
    </Link>
  );
}

function SeeAll({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover">
      See all <ArrowRight className="size-3.5" />
    </Link>
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
  const queue = useApi(() => api.reports({ status: ["under_review", "processing_failed"], limit: 6 }), "overview:queue");
  const incidents = useApi(() => api.incidents({ status: ["confirmed"], limit: 6 }), "overview:incidents");
  usePolling(queue.reload, 10000, true);
  usePolling(incidents.reload, 20000, true);

  const categories = Object.entries(summary?.by_category ?? {}).sort((a, b) => b[1] - a[1]);
  const most = Math.max(1, ...categories.map(([, n]) => n));
  const firstName = user?.display_name.split(/\s+/)[0];

  return (
    <Page>
      <PageHeader
        meta={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description="What needs a decision across MtaaSense right now."
        actions={
          <LinkButton href="/review/queue" icon={<DirectInbox className="size-4" />}>
            Open the queue
          </LinkButton>
        }
      />

      <div className="space-y-3 empty:hidden">
        {rain.data?.active && (
          <Callout
            tone="warn"
            title="Heavy rain expected"
            action={<LinkButton href="/review/queue" size="sm" variant="secondary">Drains first</LinkButton>}
          >
            {rain.data.expected_mm_24h} mm in the next 24 hours
            {rain.data.peak_hour && `, heaviest around ${formatHour(rain.data.peak_hour)}`}. Blocked drains are at the top of the
            queue.
          </Callout>
        )}
        {summary && summary.processing_failures > 0 && (
          <Callout tone="warn">
            {summary.processing_failures} report{summary.processing_failures === 1 ? "" : "s"} failed AI processing and{" "}
            {summary.processing_failures === 1 ? "is" : "are"} waiting in the review queue.
          </Callout>
        )}
      </div>

      <div className={clsx("grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4", (rain.data?.active || (summary?.processing_failures ?? 0) > 0) && "mt-6")}>
        <Stat
          label="Awaiting review"
          value={summary ? summary.reports_awaiting_review + summary.processing_failures : undefined}
          hint={summary ? `${summary.reports_processing} still processing` : "Reports waiting for a decision"}
          href="/review/queue"
          icon={DirectInbox}
          highlight={!!summary && summary.reports_awaiting_review + summary.processing_failures > 0}
        />
        <Stat
          label="Possible duplicates"
          value={summary?.potential_duplicates}
          hint="Pairs to compare"
          href="/review/duplicates"
          icon={Hierarchy}
          highlight={!!summary && summary.potential_duplicates > 0}
        />
        <Stat
          label="Open incidents"
          value={summary?.incidents_confirmed}
          hint={summary ? `${summary.incidents_resolved} resolved` : "Confirmed and not yet fixed"}
          href="/review/incidents"
          icon={Flag}
        />
        <Stat
          label="No location"
          value={summary?.unlocated_reports}
          hint="Reports that can't go on the map"
          href="/review/unlocated"
          icon={LocationSlash}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Waiting for review" description="The newest reports in the queue" action={<SeeAll href="/review/queue" />} />
          {!queue.data && <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
          {queue.data && queue.data.items.length === 0 && (
            <EmptyState icon={<DirectInbox className="size-5" />} title="The queue is clear">
              New reports appear here once their AI analysis finishes.
            </EmptyState>
          )}
          {queue.data && queue.data.items.length > 0 && (
            <ul className="divide-y divide-line">
              {queue.data.items.map((r) => (
                <li key={r.id}>
                  <Link href={`/review/reports/${r.id}`} className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-paper">
                    <Thumb media={r.thumbnail} className="size-12" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-medium">{r.reference}</span>
                        {r.is_sample && <SampleBadge />}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-2">{r.ai_summary ?? r.description}</p>
                    </div>
                    <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                      <CategoryBadge category={r.hazard_category} />
                      <span className="text-[12px] text-ink-3">{timeAgo(r.created_at)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Waiting by hazard" description="Reports awaiting a decision" />
            <div className="space-y-3 p-5">
              {!summary && <Skeleton className="h-24" />}
              {summary && categories.length === 0 && <p className="text-[13px] text-ink-3">Nothing is waiting.</p>}
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

          <Card className="overflow-hidden">
            <div className="bg-night px-5 py-4 text-paper">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <MagicStar className="size-4 text-highlight" variant="Bold" /> Review assistant
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-paper/60">
                Muse Spark reads the queue and the evidence. It suggests; you decide.
              </p>
            </div>
            <ul className="divide-y divide-line">
              {QUICK_QUESTIONS.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => askAssistant(q)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-[13.5px] text-ink-2 transition-colors hover:bg-paper hover:text-ink"
                  >
                    {q}
                    <ArrowRight className="size-3.5 shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Open incidents" description="Most recently updated" action={<SeeAll href="/review/incidents" />} />
        {!incidents.data && <div className="p-5"><Skeleton className="h-32" /></div>}
        {incidents.data && incidents.data.items.length === 0 && (
          <EmptyState icon={<Flag className="size-5" />} title="No open incidents">
            Confirm a report to create the first incident.
          </EmptyState>
        )}
        {incidents.data && incidents.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Incident</th>
                  <th className="px-3 py-2.5 font-medium">Hazard</th>
                  <th className="px-3 py-2.5 font-medium">Severity</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 text-right font-medium">Reports</th>
                  <th className="px-5 py-2.5 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {incidents.data.items.map((i) => (
                  <tr key={i.id} className="cursor-pointer transition-colors hover:bg-paper" onClick={() => router.push(`/review/incidents/${i.id}`)}>
                    <td className="max-w-[320px] px-5 py-3">
                      <Link href={`/review/incidents/${i.id}`} className="block truncate font-medium text-ink" onClick={(e) => e.stopPropagation()}>
                        {i.title}
                      </Link>
                      <span className="font-mono text-[12px] text-ink-3">{i.reference}</span>
                      {i.is_sample && <span className="ml-2 text-[11px] text-ink-3">sample</span>}
                    </td>
                    <td className="px-3 py-3"><CategoryBadge category={i.hazard_category} /></td>
                    <td className="px-3 py-3">{i.severity !== "undetermined" ? <SeverityBadge severity={i.severity} prefix={false} /> : <span className="text-ink-3">–</span>}</td>
                    <td className="px-3 py-3 text-ink-2">{PRIORITY_LABEL[i.priority]}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{i.report_count}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-ink-3">{formatDate(i.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {summary && summary.sample_records > 0 && (
        <p className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-3">
          Includes {summary.sample_records} sample record{summary.sample_records === 1 ? "" : "s"}, marked <SampleBadge />
        </p>
      )}
    </Page>
  );
}
