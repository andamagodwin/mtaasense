"use client";

import { clsx } from "clsx";
import { CloseCircle, MagicStar, Refresh, TickCircle } from "iconsax-reactjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AssistantContext, AssistantProposal, AssistantRef } from "@/lib/assistant";
import { CategoryDot } from "../badges";
import { useSession } from "../session";
import { Button } from "../ui/button";
import { Composer, ExchangeView, Starters, useConversation } from "./conversation";

const UUID = "[0-9a-f-]{36}";
const ASK_EVENT = "mtaasense:ask-assistant";

/** Open the review assistant from anywhere in the dashboard, optionally asking a question straight away. */
export function askAssistant(question?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(ASK_EVENT, { detail: question }));
}

/** The record open in the review workspace, so "this incident" means something. */
function contextFor(pathname: string): AssistantContext | undefined {
  const match = new RegExp(`^/review/(incidents|reports|duplicates)/(${UUID})`).exec(pathname);
  if (!match) return undefined;
  const [, kind, id] = match;
  if (kind === "incidents") return { incident_id: id };
  if (kind === "reports") return { report_id: id };
  return { suggestion_id: id };
}

function startersFor(context: AssistantContext | undefined): string[] {
  if (context?.incident_id) {
    return [
      "Summarise this incident and its evidence",
      "Has it been repaired? What do the repair checks say?",
      "Draft a work order for the KCCA team",
      "Should its priority change?",
    ];
  }
  if (context?.report_id) {
    return [
      "Is this report credible? What does the evidence show?",
      "Is it a duplicate of anything nearby?",
      "What should I decide here, and why?",
    ];
  }
  if (context?.suggestion_id) {
    return ["Are these the same problem? Weigh the evidence", "What would settle this pair?"];
  }
  return [
    "What should I look at first today?",
    "Which open incidents have the most reports?",
    "Any blocked drains to clear before the next heavy rain?",
    "Find this week's reports that have no location",
  ];
}

export function hrefFor(kind: "incident" | "report" | "suggestion", id: string): string {
  return kind === "incident" ? `/review/incidents/${id}` : kind === "report" ? `/review/reports/${id}` : `/review/duplicates/${id}`;
}

function RefLink({ item }: { item: AssistantRef }) {
  return (
    <Link
      href={hrefFor(item.kind, item.id)}
      title={item.title ?? undefined}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 font-mono text-[12.5px] font-medium text-ink no-underline hover:border-accent-line hover:bg-accent-soft"
    >
      <CategoryDot category={item.hazard_category} />
      {item.reference}
    </Link>
  );
}

function run(p: AssistantProposal) {
  // The reason goes into the audit trail with the reviewer's decision.
  const note = `Suggested by the review assistant: ${p.reason}`.slice(0, 2000);
  switch (p.action) {
    case "confirm_duplicate":
      return api.decide(p.target.id, "confirm", note);
    case "reject_duplicate":
      return api.decide(p.target.id, "reject", note);
    case "confirm_report_as_incident":
      return api.reviewReport(p.target.id, { action: "confirm_incident", title: p.params.title, priority: p.params.priority, note });
    case "reject_report":
      return api.reviewReport(p.target.id, { action: "reject", note });
    case "set_incident_priority":
      return api.updateIncident(p.target.id, { priority: p.params.priority, note });
    case "resolve_incident":
      return api.updateIncident(p.target.id, {
        status: "resolved",
        resolution_note: p.params.text,
        fix_check_id: p.params.fix_check_id,
        note,
      });
    case "add_incident_note":
      return api.addIncidentNote(p.target.id, p.params.text ?? "");
  }
}

function ProposalCard({ proposal }: { proposal: AssistantProposal }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "dismissed") return null;
  const detail = proposal.params.text ?? proposal.params.title;

  async function confirm() {
    setState("working");
    setError(null);
    try {
      await run(proposal);
      setState("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work. Open the record and try there.");
      setState("idle");
    }
  }

  return (
    <div className={clsx("rounded-xl border p-3.5", state === "done" ? "border-success-line bg-success-soft" : "border-accent-line bg-accent-soft/60")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-ink">Suggested decision</p>
      <p className="mt-1 text-[14px] font-semibold text-ink">{proposal.label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{proposal.reason}</p>
      {detail && <p className="mt-2 rounded-lg bg-surface/80 px-2.5 py-2 text-[13px] leading-relaxed text-ink-2">“{detail}”</p>}
      {proposal.params.priority && proposal.action !== "set_incident_priority" && (
        <p className="mt-1.5 text-[12.5px] text-ink-3">Priority: {proposal.params.priority}</p>
      )}
      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === "done" ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success-ink">
              <TickCircle className="size-4" variant="Bold" /> Done, recorded as your decision
            </span>
            <Link href={hrefFor(proposal.target.kind, proposal.target.id)} className="text-[13px] font-medium text-accent hover:text-accent-hover">
              Open {proposal.target.reference}
            </Link>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => void confirm()} loading={state === "working"}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState("dismissed")} disabled={state === "working"}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** A slide-out assistant on every review page. It reads the queue and the evidence; the reviewer decides. */
export function ReviewAssistant() {
  const { user } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const getContext = useCallback(() => contextFor(pathRef.current), []);
  const convo = useConversation("review", getContext);
  const sendRef = useRef(convo.send);
  useEffect(() => {
    sendRef.current = convo.send;
  });
  useEffect(() => {
    const onAsk = (e: Event) => {
      const question = (e as CustomEvent<string | undefined>).detail;
      setOpen(true);
      if (question) void sendRef.current(question);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const last = convo.exchanges.at(-1);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [convo.exchanges.length, last?.progress.length, last?.answer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user) return null;
  const context = contextFor(pathname);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-ink pl-4 pr-5 text-[14px] font-medium text-paper shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5 animate-rise"
        >
          <MagicStar className="size-[18px] text-highlight" variant="Bold" />
          Ask the assistant
        </button>
      )}
      {open && (
        <aside
          aria-label="Review assistant"
          className="fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col lg:top-0 border-l border-line bg-paper shadow-[var(--shadow-pop)] animate-fade-in sm:left-auto sm:w-[440px]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-ink text-highlight">
                <MagicStar className="size-4" variant="Bold" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">Review assistant</h2>
                <p className="text-[12px] leading-snug text-ink-3">Muse Spark · suggests, you decide</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {convo.exchanges.length > 0 && (
                <button type="button" onClick={convo.reset} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label="New conversation" title="New conversation">
                  <Refresh className="size-4" />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close the assistant" title="Close">
                <CloseCircle className="size-4" />
              </button>
            </div>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
            {convo.exchanges.length === 0 && (
              <Starters items={startersFor(context)} onPick={(q) => void convo.send(q)} />
            )}
            {convo.exchanges.map((exchange) => (
              <ExchangeView
                key={exchange.id}
                exchange={exchange}
                renderRef={(item) => <RefLink item={item} />}
                footer={(answer) =>
                  answer.proposals.length > 0 && (
                    <div className="space-y-2">
                      {answer.proposals.map((p) => (
                        <ProposalCard key={p.id} proposal={p} />
                      ))}
                    </div>
                  )
                }
              />
            ))}
          </div>

          <div className="border-t border-line bg-surface p-3">
            <Composer
              onSend={(q) => void convo.send(q)}
              onStop={convo.stop}
              busy={convo.busy}
              placeholder={context ? "Ask about this record or anything else…" : "Ask about the queue, a place, an incident…"}
              autoFocus
            />
          </div>
        </aside>
      )}
    </>
  );
}
