"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CATEGORY_LABEL, formatDateTime, PRIORITY_LABEL, SEVERITY_LABEL, formatCoords } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { HazardCategory, IncidentDetail, Priority, Severity } from "@/lib/types";
import { CategoryBadge, IncidentStatusBadge, PriorityBadge, SampleBadge, SeverityBadge, StatusBadge } from "../badges";
import { useRequireReviewer } from "../session";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader, KeyValue } from "../ui/card";
import { Dialog } from "../ui/dialog";
import { Callout, Skeleton } from "../ui/feedback";
import { Field, Input, Select, Textarea } from "../ui/field";
import { AuditTrail, NotesPanel } from "./activity";
import { Thumb } from "./thumb";

export function IncidentWorkspace() {
  const { id } = useParams<{ id: string }>();
  const session = useRequireReviewer();
  const incident = useApi(() => api.incident(id), session.allowed ? id : null);
  const [auditKey, setAuditKey] = useState(0);

  if (incident.error) return <div className="mx-auto max-w-xl px-4 py-16"><Callout tone="danger">{incident.error.message}</Callout></div>;
  if (!incident.data) return <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6"><Skeleton className="h-[600px]" /></div>;
  const inc = incident.data;
  const done = (next: IncidentDetail) => {
    incident.setData(next);
    setAuditKey((k) => k + 1);
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/review?tab=incidents" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Incidents
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[13px] text-ink-3">{inc.reference}</p>
          <h1 className="mt-0.5 text-[24px] font-semibold tracking-tight">{inc.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <IncidentStatusBadge status={inc.status} />
            <CategoryBadge category={inc.hazard_category} />
            <PriorityBadge priority={inc.priority} />
            <SeverityBadge severity={inc.severity} />
            {inc.is_sample && <SampleBadge />}
          </div>
        </div>
        <StatusAction incident={inc} onDone={done} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Linked reports (${inc.reports?.length ?? 0})`} description="Each resident report keeps its own photo, words and timestamps." />
            <ul className="divide-y divide-line">
              {inc.reports?.map((r) => (
                <li key={r.id}>
                  <Link href={`/review/reports/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-paper sm:px-5">
                    <Thumb media={r.thumbnail} className="size-20" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13.5px] font-medium">{r.reference}</span>
                        <StatusBadge status={r.status} />
                        {r.id === inc.primary_report_id && <span className="text-[12px] text-ink-3">primary</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{r.description || r.ai_summary}</p>
                      <p className="mt-0.5 text-[12px] text-ink-3">{formatDateTime(r.created_at)}{!r.location && " · no location"}</p>
                    </div>
                    <ArrowRight className="size-4 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {inc.reports && inc.reports.length > 1 && (
            <Card>
              <CardHeader title="Evidence gallery" description="All photos submitted for this incident, oldest first." />
              <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {inc.reports.map((r) => (
                  <Link key={r.id} href={`/review/reports/${r.id}`} className="group">
                    <Thumb media={r.thumbnail} className="aspect-[4/3] w-full transition-opacity group-hover:opacity-90" />
                    <p className="mt-1 font-mono text-[12px] text-ink-3">{r.reference}</p>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Incident record" />
            <CardBody className="space-y-4">
              {inc.summary && <p className="text-[14px] leading-relaxed text-ink-2">{inc.summary}</p>}
              <dl className="grid grid-cols-2 gap-3">
                <KeyValue label="First reported">{inc.first_reported_at ? formatDateTime(inc.first_reported_at) : "—"}</KeyValue>
                <KeyValue label="Latest report">{inc.last_reported_at ? formatDateTime(inc.last_reported_at) : "—"}</KeyValue>
                <KeyValue label="Location">{inc.location ? <span className="font-mono text-[12.5px]">{formatCoords(inc.location.lat, inc.location.lon)}</span> : "Unknown"}</KeyValue>
                <KeyValue label="Created">{formatDateTime(inc.created_at)}</KeyValue>
              </dl>
              {inc.status === "resolved" && (
                <Callout tone="success" title={`Marked resolved ${inc.resolved_at ? formatDateTime(inc.resolved_at) : ""}`}>{inc.resolution_note}</Callout>
              )}
            </CardBody>
          </Card>
          <EditIncident incident={inc} onDone={done} />
          <NotesPanel kind="incident" id={inc.id} onAdded={() => setAuditKey((k) => k + 1)} />
          <AuditTrail kind="incident" id={inc.id} refreshKey={auditKey} />
        </div>
      </div>
    </div>
  );
}

function StatusAction({ incident, onDone }: { incident: IncidentDetail; onDone: (i: IncidentDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(status: "resolved" | "confirmed") {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.updateIncident(incident.id, status === "resolved" ? { status, resolution_note: note.trim() } : { status }));
      setOpen(false);
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the incident.");
    } finally {
      setBusy(false);
    }
  }

  if (incident.status === "resolved") {
    return <Button variant="secondary" onClick={() => void change("confirmed")} loading={busy} icon={<RotateCcw className="size-4" />}>Reopen incident</Button>;
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<CheckCircle2 className="size-4" />}>Mark resolved</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Mark this incident resolved"
        description="Only mark it resolved when you have evidence that the hazard was fixed — never on the basis of an AI assessment."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void change("resolved")} loading={busy} disabled={!note.trim()}>Mark resolved</Button></>}
      >
        <Field label="How was the resolution confirmed?" htmlFor="res-note">
          <Textarea id="res-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Site visit on 30 Oct: pothole patched; photo attached to the work order." />
        </Field>
        {error && <Callout tone="danger" className="mt-3">{error}</Callout>}
      </Dialog>
    </>
  );
}

function EditIncident({ incident, onDone }: { incident: IncidentDetail; onDone: (i: IncidentDetail) => void }) {
  const [title, setTitle] = useState(incident.title);
  const [priority, setPriority] = useState<Priority>(incident.priority);
  const [severity, setSeverity] = useState<Severity>(incident.severity);
  const [category, setCategory] = useState<HazardCategory>(incident.hazard_category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title !== incident.title || priority !== incident.priority || severity !== incident.severity || category !== incident.hazard_category;

  return (
    <Card>
      <CardHeader title="Edit incident" description="Reviewer decisions override model suggestions; changes are audited." />
      <CardBody className="space-y-3">
        <Field label="Title" htmlFor="edit-title"><Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Category" htmlFor="edit-cat">
            <Select id="edit-cat" value={category} onChange={(e) => setCategory(e.target.value as HazardCategory)}>
              {(Object.keys(CATEGORY_LABEL) as HazardCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="edit-pri">
            <Select id="edit-pri" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(["routine", "elevated", "urgent"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Severity" htmlFor="edit-sev">
            <Select id="edit-sev" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty}
            loading={busy}
            icon={<Save className="size-3.5" />}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onDone(await api.updateIncident(incident.id, { title, priority, severity, hazard_category: category }));
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Couldn't save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save changes
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
