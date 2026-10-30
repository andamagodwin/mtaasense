"use client";

import { History, MessageSquare } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AuditView } from "@/lib/types";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { Callout, Skeleton } from "../ui/feedback";
import { Textarea } from "../ui/field";

type Kind = "report" | "incident";

export function NotesPanel({ kind, id, onAdded }: { kind: Kind; id: string; onAdded?: () => void }) {
  const notes = useApi(() => (kind === "report" ? api.reportNotes(id) : api.incidentNotes(id)), `notes:${kind}:${id}`);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await (kind === "report" ? api.addReportNote(id, body.trim()) : api.addIncidentNote(id, body.trim()));
      setBody("");
      notes.reload();
      onAdded?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Reviewer notes" />
      <CardBody className="space-y-3">
        {notes.data?.length === 0 && <p className="text-[13px] text-ink-3">No notes yet.</p>}
        <ul className="space-y-2.5">
          {notes.data?.map((n) => (
            <li key={n.id} className="rounded-lg bg-paper px-3 py-2">
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{n.body}</p>
              <p className="mt-1 text-[12px] text-ink-3">{n.author ?? "Former reviewer"} · {formatDateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for other reviewers" className="min-h-20" aria-label="New note" maxLength={4000} />
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => void add()} disabled={!body.trim()} loading={busy} icon={<MessageSquare className="size-3.5" />}>
            Add note
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  report_submitted: "Report submitted",
  analysis_completed: "AI analysis completed",
  analysis_unavailable: "AI analysis unavailable",
  analysis_failed: "AI analysis failed",
  analysis_retry_scheduled: "AI analysis retry scheduled",
  analysis_requested: "Re-analysis requested",
  segmentation_completed: "Segmentation completed",
  duplicates_matched: "Duplicate matching ran",
  duplicate_confirmed: "Duplicate confirmed",
  duplicate_rejected: "Duplicate rejected",
  duplicate_deferred: "Duplicate left unresolved",
  incident_created: "Incident created",
  incident_updated: "Incident updated",
  incident_resolved: "Incident marked resolved",
  incident_reopened: "Incident reopened",
  report_confirm_incident: "Confirmed as incident",
  report_reject: "Report rejected",
  report_reopen: "Report reopened",
  category_corrected: "Category corrected",
  note_added: "Note added",
  transcription_rerun: "Voice note re-transcribed",
};

function describe(e: AuditView): string | null {
  const d = e.data as Record<string, unknown>;
  if (e.action === "category_corrected") return `${String(d.from ?? "—")} → ${String(d.to)}`;
  if (e.action === "duplicates_matched") return `${String(d.retrieved)} candidates retrieved, ${String(d.suggested)} suggested`;
  if (e.action === "analysis_completed") return `${String(d.provenance)} · ${String(d.model)}`;
  if (e.action === "segmentation_completed") return `“${String(d.prompt)}” · ${String(d.regions)} region(s) · ${String(d.provenance)}`;
  if (e.action === "duplicate_confirmed") return `with ${String(d.candidate_report)} → ${String(d.incident)}`;
  if (e.action === "duplicate_rejected" || e.action === "duplicate_deferred") return `candidate ${String(d.candidate_report)}`;
  if (e.action.startsWith("analysis_") && d.code) return String(d.code).replaceAll("_", " ");
  if (e.action === "incident_created") return String(d.title ?? "");
  if (e.action.startsWith("incident_") && d.status) {
    const s = d.status as { from: string; to: string };
    return `${s.from} → ${s.to}`;
  }
  return null;
}

export function AuditTrail({ kind, id, refreshKey }: { kind: Kind; id: string; refreshKey: number }) {
  const audit = useApi(() => (kind === "report" ? api.reportAudit(id) : api.incidentAudit(id)), `audit:${kind}:${id}:${refreshKey}`);
  return (
    <Card>
      <CardHeader title="Audit history" description="Append-only record of system and reviewer actions." />
      <CardBody>
        {!audit.data && <Skeleton className="h-24" />}
        <ol className="relative space-y-3 border-l border-line pl-4">
          {audit.data?.map((e) => {
            const detail = describe(e);
            return (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface ${e.actor_label === "system" ? "bg-ink-3" : e.actor_label === "resident" ? "bg-cat-road" : "bg-accent"}`} />
                <p className="text-[13.5px] font-medium">{ACTION_LABEL[e.action] ?? e.action.replaceAll("_", " ")}</p>
                {detail && <p className="text-[12.5px] text-ink-2">{detail}</p>}
                {e.note && <p className="mt-0.5 text-[12.5px] italic text-ink-2">“{e.note}”</p>}
                <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-3">
                  <History className="size-3" />
                  {e.actor_label} · {formatDateTime(e.created_at)}
                </p>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
