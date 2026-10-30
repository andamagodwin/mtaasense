"use client";

import { clsx } from "clsx";
import { Check, Copy, Link2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { usePolling, useApi } from "@/lib/hooks";
import type { ReportDetail } from "@/lib/types";
import { AnalysisPanel } from "./analysis-panel";
import { CategoryBadge, SampleBadge, StatusBadge } from "./badges";
import { ResidentFacts } from "./resident-facts";
import { SegmentationViewer } from "./segmentation-viewer";
import { LinkButton } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Callout, EmptyState, Skeleton } from "./ui/feedback";

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function isProcessing(report: ReportDetail): boolean {
  return (
    report.status === "submitted" ||
    report.status === "processing" ||
    report.analysis.status === "running" ||
    report.segmentations.some((s) => s.status === "queued" || s.status === "running")
  );
}

export function TrackReport() {
  const { id } = useParams<{ id: string }>();
  // The receipt token lives in the URL fragment so it is never sent to any server in a request line.
  const token = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const state = useApi((signal) => api.report(id, token, signal), token ? `${id}:${token}` : null);
  const report = state.data;
  usePolling(state.reload, 2500, !!report && isProcessing(report));
  const config = useApi(() => api.config(), "config");
  const [segError, setSegError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <EmptyState title="This tracking link is incomplete">
          Open the full link you received after submitting — it includes a private code after the “#”.
        </EmptyState>
      </div>
    );
  }

  if (state.error && !report) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Callout tone={state.error.status === 404 ? "warn" : "danger"} title={state.error.status === 404 ? "Report not found" : "Couldn't load the report"}>
          {state.error.status === 404 ? "Check that you opened the complete tracking link." : state.error.message}
        </Callout>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto w-full max-w-[1180px] space-y-4 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  async function requestSegment(prompt: string) {
    setSegError(null);
    try {
      await api.segment(report!.id, prompt, token);
      state.reload();
    } catch (err) {
      setSegError(err instanceof ApiError ? err.message : "Segmentation couldn't be requested.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-3">Report received {formatDateTime(report.created_at)}</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2.5 text-[24px] font-semibold tracking-tight">
            <span className="font-mono">{report.reference}</span>
            <StatusBadge status={report.status} />
            {report.is_sample && <SampleBadge />}
          </h1>
        </div>
        <CopyLink />
      </header>

      <Timeline report={report} />

      {report.incident && (
        <Callout tone="success" title={`Linked to incident ${report.incident.reference}`} className="mb-6">
          A reviewer consolidated this report into “{report.incident.title}”. Your original photo and words are kept as
          part of the evidence.
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardHeader title="Your photo" description="With the hazard region outlined by SAM 3.1 when available." />
          <CardBody>
            <SegmentationViewer
              image={report.image}
              segmentations={report.segmentations}
              concepts={config.data?.segmentation_concepts ?? []}
              suggestedConcept={report.analysis.result?.segmentation_concept}
              canRequest
              onRequest={requestSegment}
              requestError={segError}
            />
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader
              eyebrow="Model interpretation"
              title="AI assessment"
              action={<CategoryBadge category={report.hazard_category} />}
            />
            <CardBody>
              <AnalysisPanel analysis={report.analysis} reporterCategory={report.reporter_category} compact />
            </CardBody>
          </Card>
          <Card>
            <CardHeader eyebrow="Provided by you" title="What you reported" />
            <CardBody>
              <ResidentFacts report={report} />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href="/report" variant="secondary">Report another hazard</LinkButton>
        <LinkButton href="/map" variant="ghost">View the map</LinkButton>
      </div>
      <p className="mt-6 text-[12.5px] text-ink-3">
        Only people with this link (and MtaaSense reviewers) can see your photo. <Link href="/" className="underline">About MtaaSense</Link>
      </p>
    </div>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(window.location.href).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
      className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-sunken"
    >
      {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
      {copied ? "Link copied" : "Copy tracking link"}
      <Link2 className="hidden size-3.5 text-ink-3 sm:block" />
    </button>
  );
}

function Timeline({ report }: { report: ReportDetail }) {
  const seg = report.segmentations;
  const analysisDone = ["completed", "failed", "unavailable"].includes(report.analysis.status);
  const segDone = seg.some((s) => s.status === "completed" || s.status === "failed");
  const segActive = seg.some((s) => s.status === "queued" || s.status === "running");
  const reviewed = ["confirmed", "duplicate", "rejected", "resolved"].includes(report.status);
  const steps: { label: string; detail: string; state: "done" | "active" | "todo" | "skipped" }[] = [
    { label: "Received", detail: "Evidence stored", state: "done" },
    {
      label: "AI analysis",
      detail: report.analysis.status === "completed" ? "Muse Spark" : report.analysis.status === "unavailable" ? "Unavailable" : report.analysis.status === "failed" ? "Failed" : "Muse Spark",
      state: analysisDone ? (report.analysis.status === "completed" ? "done" : "skipped") : "active",
    },
    {
      label: "Segmentation",
      detail: "SAM 3.1",
      state: segDone ? "done" : segActive ? "active" : analysisDone ? "skipped" : "todo",
    },
    { label: "Human review", detail: reviewed ? "Decided" : "Waiting for a reviewer", state: reviewed ? "done" : analysisDone ? "active" : "todo" },
  ];
  return (
    <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s) => (
        <li key={s.label} className={clsx("rounded-xl border px-3 py-2.5", s.state === "active" ? "border-accent/40 bg-accent-soft/40" : "border-line bg-surface")}>
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <span
              className={clsx(
                "grid size-4 place-items-center rounded-full",
                s.state === "done" && "bg-accent text-white",
                s.state === "active" && "border-2 border-accent border-t-transparent animate-spin",
                s.state === "todo" && "border border-line-strong",
                s.state === "skipped" && "border border-dashed border-ink-3",
              )}
            >
              {s.state === "done" && <Check className="size-2.5" strokeWidth={3} />}
            </span>
            {s.label}
          </p>
          <p className="mt-0.5 pl-5.5 text-[12px] text-ink-3">{s.detail}</p>
        </li>
      ))}
    </ol>
  );
}
