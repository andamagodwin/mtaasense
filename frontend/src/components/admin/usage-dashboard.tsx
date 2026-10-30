"use client";

import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApi, usePolling } from "@/lib/hooks";
import type { UsageBucket, UsageReport } from "@/lib/types";
import { ProvenanceBadge } from "../badges";
import { useRequireReviewer } from "../session";
import { Card, CardBody, CardHeader } from "../ui/card";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";

const usd = (v: string | number, digits = 4) => `$${Number(v).toFixed(digits)}`;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const OPERATION_LABEL: Record<string, string> = {
  analysis: "Report analysis (Muse Spark)",
  segmentation: "Segmentation (SAM 3.1)",
  transcription: "Transcription (Muse Voice)",
  duplicate_assessment: "Duplicate comparison (Muse Spark)",
};

export function UsageDashboard() {
  const session = useRequireReviewer("admin");
  const isAdmin = session.user?.role === "admin";
  const usage = useApi(() => api.usage(), isAdmin ? "usage" : null);
  const evaluation = useApi(() => api.evaluation(), isAdmin ? "eval" : null);
  usePolling(usage.reload, 15000, isAdmin);

  if (session.loading || !session.user) return <Page><Skeleton className="h-96" /></Page>;
  if (!isAdmin) return <Page><Callout tone="warn" title="Administrator access required">Model usage is visible to administrators only.</Callout></Page>;
  if (usage.error) return <Page><Callout tone="danger">{usage.error.message}</Callout></Page>;
  const u = usage.data;

  return (
    <Page>
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Model usage &amp; budget</h1>
        <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-ink-3">
          {u?.note ?? "Estimated from provider-reported usage."} Prices from{" "}
          <a href={u?.pricing_source} className="underline" target="_blank" rel="noreferrer">the official price list</a>
          {u && <> (retrieved {u.pricing_retrieved})</>}.
        </p>
      </header>

      {!u ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {u.budget_exhausted && (
            <Callout tone="danger" title="Budget limit reached" className="mb-5">
              New model calls are paused until the daily window resets or the limit is raised (MODEL_DAILY_BUDGET_USD / MODEL_TOTAL_BUDGET_USD).
            </Callout>
          )}
          <div className="mb-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card>
              <CardBody className="space-y-5 py-5">
                <div>
                  <p className="text-[13px] text-ink-3">Estimated spend, all time</p>
                  <p className="mt-1 text-[52px] font-semibold leading-none tracking-tight tabular-nums">{usd(u.estimated_total_usd, 2)}</p>
                </div>
                <Meter label="Total budget" used={Number(u.estimated_total_usd)} limit={Number(u.total_limit_usd)} />
                <Meter label="Today (UTC)" used={Number(u.estimated_today_usd)} limit={Number(u.daily_limit_usd)} />
              </CardBody>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Model calls" value={compact.format(sum(u.by_operation, "calls"))} />
              <Tile label="Failed calls" value={compact.format(sum(u.by_operation, "failures"))} warn={sum(u.by_operation, "failures") > 0} />
              <Tile label="Tokens in / out" value={`${compact.format(sum(u.by_model, "input_tokens"))} / ${compact.format(sum(u.by_model, "output_tokens"))}`} />
              <Tile label="Images · audio" value={`${sum(u.by_model, "images")} · ${Math.round(sum(u.by_model, "audio_seconds"))} s`} />
            </div>
          </div>

          <Card className="mb-6">
            <CardHeader title="Estimated spend per day" description="Live calls only; fixture and cached results cost nothing." />
            <CardBody>
              <DailyBars days={u.by_day} />
            </CardBody>
          </Card>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <BucketTable title="By operation" rows={u.by_operation} label={(k) => OPERATION_LABEL[k] ?? k} />
            <BucketTable title="By model" rows={u.by_model} label={(k) => k} mono />
          </div>

          <RecentCalls report={u} />
        </>
      )}

      <Card className="mt-6">
        <CardHeader title="Evaluation" description="Results of the labelled evaluation set (backend/eval). Not-yet-measured metrics are shown as such." />
        <CardBody>
          {!evaluation.data && <Skeleton className="h-20" />}
          {evaluation.data && !evaluation.data.available && <p className="text-[13.5px] text-ink-3">{evaluation.data.message}</p>}
          {evaluation.data?.available && (
            <pre className="max-h-96 overflow-auto rounded-lg bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink-2">
              {JSON.stringify(Object.fromEntries(Object.entries(evaluation.data).filter(([k]) => k !== "available")), null, 2)}
            </pre>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6">{children}</div>;
}

function sum(rows: UsageBucket[], key: "calls" | "failures" | "input_tokens" | "output_tokens" | "images" | "audio_seconds"): number {
  return rows.reduce((acc, r) => acc + Number(r[key]), 0);
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        {warn && <AlertTriangle className="size-3.5 text-warn" aria-label="Warning" />}
        {label}
      </p>
      <p className="mt-1 text-[26px] font-semibold tracking-tight tabular-nums">{value}</p>
    </Card>
  );
}

/** Fill carries severity; the track is a lighter step of the same hue. */
function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
  const tone = ratio >= 0.9 ? { fill: "bg-danger", track: "bg-danger-soft" } : ratio >= 0.7 ? { fill: "bg-warn", track: "bg-warn-soft" } : { fill: "bg-accent", track: "bg-accent-soft" };
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums text-ink">
          {usd(used, 2)} <span className="text-ink-3">of {usd(limit, 2)} · {Math.round(ratio * 100)}%</span>
        </span>
      </div>
      <div className={clsx("h-2 overflow-hidden rounded-full", tone.track)} role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <div className={clsx("h-full rounded-full", tone.fill)} style={{ width: `${Math.max(ratio * 100, used > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

function DailyBars({ days }: { days: UsageBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return <EmptyState title="No model calls yet" className="py-8">Spend appears here after the first live request.</EmptyState>;
  const recent = days.slice(-30);
  const max = Math.max(...recent.map((d) => Number(d.estimated_cost_usd)), 0.0001);
  const H = 140;
  return (
    <div>
      <div className="relative flex h-[172px] items-end gap-1.5 border-b border-line pb-px" role="img" aria-label="Estimated spend per day">
        {recent.map((d, i) => {
          const h = Math.max((Number(d.estimated_cost_usd) / max) * H, 2);
          return (
            <div
              key={d.key}
              className="group relative flex h-full flex-1 cursor-default items-end justify-center"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${d.key}: ${usd(d.estimated_cost_usd)} over ${d.calls} calls`}
            >
              <div className={clsx("w-full max-w-6 rounded-t-[4px] transition-colors", hover === i ? "bg-accent-hover" : "bg-accent")} style={{ height: h }} />
              {(hover === i || recent.length <= 7) && (
                <span className={clsx("pointer-events-none absolute whitespace-nowrap text-[11.5px] tabular-nums", hover === i ? "rounded-md bg-ink px-2 py-1 text-white shadow-[var(--shadow-pop)]" : "text-ink-2")} style={{ bottom: h + 6 }}>
                  {hover === i ? <><strong className="font-semibold">{usd(d.estimated_cost_usd)}</strong> · {d.calls} calls</> : usd(d.estimated_cost_usd, 3)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
        <span>{recent[0].key}</span>
        {recent.length > 1 && <span>{recent[recent.length - 1].key}</span>}
      </div>
    </div>
  );
}

function BucketTable({ title, rows, label, mono }: { title: string; rows: UsageBucket[]; label: (k: string) => string; mono?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-ink-3">No calls yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] tabular-nums">
            <thead className="bg-paper text-[12px] text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Failed</th>
                <th className="px-3 py-2 text-right font-medium">Tokens in/out</th>
                <th className="px-3 py-2 text-right font-medium">Avg latency</th>
                <th className="px-4 py-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className={clsx("px-4 py-2", mono && "font-mono text-[12.5px]")}>{label(r.key)}</td>
                  <td className="px-3 py-2 text-right">{r.calls}</td>
                  <td className="px-3 py-2 text-right">{r.failures}</td>
                  <td className="px-3 py-2 text-right">{compact.format(r.input_tokens)} / {compact.format(r.output_tokens)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_latency_ms !== null ? `${(r.avg_latency_ms / 1000).toFixed(1)} s` : "—"}</td>
                  <td className="px-4 py-2 text-right font-medium">{usd(r.estimated_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RecentCalls({ report }: { report: UsageReport }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recent model calls" description="Every request attempt, including failures and retries." />
      {report.recent.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-ink-3">No calls yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px] tabular-nums">
            <thead className="bg-paper text-[12px] text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Operation</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 text-right font-medium">Latency</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
                <th className="px-4 py-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.recent.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-2">{formatDateTime(c.created_at)}</td>
                  <td className="px-3 py-2">{OPERATION_LABEL[c.operation]?.split(" (")[0] ?? c.operation}</td>
                  <td className="px-3 py-2 font-mono">{c.model}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {c.success ? <CheckCircle2 className="size-3.5 text-accent" /> : <XCircle className="size-3.5 text-danger" />}
                      {c.success ? "OK" : c.error_code ?? `HTTP ${c.http_status}`}
                      {c.provenance !== "live" && <ProvenanceBadge provenance={c.provenance} />}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{(c.latency_ms / 1000).toFixed(1)} s</td>
                  <td className="px-3 py-2 text-right">{c.input_tokens !== null ? `${compact.format(c.input_tokens)}/${compact.format(c.output_tokens ?? 0)}` : c.image_count ? `${c.image_count} img` : "—"}</td>
                  <td className="px-4 py-2 text-right">{usd(c.estimated_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
