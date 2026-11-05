"use client";

import { clsx } from "clsx";
import { CloseCircle, MagicStar, Microphone2, Minus, Refresh, Stop, TickCircle, VolumeHigh } from "iconsax-reactjs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AssistantContext, AssistantProposal, AssistantRef } from "@/lib/assistant";
import { speak, spokenCommand, startVoice, voiceSupported, type VoiceLink, type VoiceServerEvent } from "@/lib/voice";
import { CategoryDot } from "../badges";
import { useSession } from "../session";
import { Button } from "../ui/button";
import { Spinner } from "../ui/feedback";
import { Composer, ExchangeView, Starters, useConversation, type Exchange } from "./conversation";

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
  const note = `Suggested by Elvis (review assistant): ${p.reason}`.slice(0, 2000);
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

interface Decision {
  state: "idle" | "working" | "done" | "dismissed";
  error?: string;
}

function ProposalCard({
  proposal,
  decision,
  onConfirm,
  onDismiss,
  voiceHint,
}: {
  proposal: AssistantProposal;
  decision: Decision;
  onConfirm: () => void;
  onDismiss: () => void;
  voiceHint: boolean;
}) {
  const { state, error } = decision;
  if (state === "dismissed") return null;
  const detail = proposal.params.text ?? proposal.params.title;

  return (
    <div className={clsx("rounded-xl border p-3.5", state === "done" ? "border-success-line bg-success-soft" : "border-accent-line bg-accent-soft/60")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-ink">Elvis suggests</p>
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
            <Button size="sm" onClick={onConfirm} loading={state === "working"}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={state === "working"}>
              Dismiss
            </Button>
            {voiceHint && <span className="text-[12.5px] text-ink-3">or say “confirm” or “cancel”</span>}
          </>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- voice

type VoiceStatus = "off" | "connecting" | "listening" | "thinking" | "speaking";

const STATUS_LABEL: Record<Exclude<VoiceStatus, "off">, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
};

const ENDED: Record<string, string> = {
  idle: "Voice turned off after a quiet spell.",
  time_limit: "Voice sessions last 15 minutes. Turn it on again to keep going.",
  transcriber_closed: "Voice stopped. Turn it on again to keep going.",
};

const QUIET_LIMIT_MS = 2 * 60 * 1000;

function VoiceOrb({ status, level, dark = false }: { status: Exclude<VoiceStatus, "off">; level: number; dark?: boolean }) {
  return (
    <span className="relative grid size-10 shrink-0 place-items-center">
      <span
        aria-hidden
        className={clsx("absolute inset-0 rounded-full transition-transform duration-100", dark ? "bg-highlight/30" : "bg-highlight/20")}
        style={{ transform: `scale(${status === "listening" ? 0.8 + level * 0.5 : status === "speaking" ? 1 : 0.8})` }}
      />
      <span className={clsx("relative grid size-8 place-items-center rounded-full text-white", status === "speaking" ? "bg-highlight" : dark ? "bg-paper/15" : "bg-ink")}>
        {status === "listening" && <Microphone2 className="size-4" variant="Bold" />}
        {status === "speaking" && <VolumeHigh className="size-4" variant="Bold" />}
        {(status === "connecting" || status === "thinking") && <Spinner className="size-4" />}
      </span>
    </span>
  );
}

/** A slide-out assistant on every review page. It reads the queue and the evidence; the reviewer decides. */
export function ReviewAssistant() {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const getContext = useCallback(() => contextFor(pathRef.current), []);

  // Handlers registered once (with the voice link and the conversation) call through this ref to the latest render.
  const latest = useRef<{
    onVoiceEvent: (e: VoiceServerEvent) => void;
    onVoiceClose: () => void;
    onSettled: (e: Exchange) => void;
  }>({ onVoiceEvent: () => {}, onVoiceClose: () => {}, onSettled: () => {} });
  const onSettled = useCallback((e: Exchange) => latest.current.onSettled(e), []);
  const convo = useConversation("review", getContext, undefined, onSettled);
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

  // ------------------------------------------------------------------ proposals

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const decide = useCallback(async (key: string, proposal: AssistantProposal, action: "confirm" | "dismiss"): Promise<string | null> => {
    if (action === "dismiss") {
      setDecisions((d) => ({ ...d, [key]: { state: "dismissed" } }));
      return null;
    }
    setDecisions((d) => ({ ...d, [key]: { state: "working" } }));
    try {
      await run(proposal);
      setDecisions((d) => ({ ...d, [key]: { state: "done" } }));
      return null;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That didn't work. Open the record and try there.";
      setDecisions((d) => ({ ...d, [key]: { state: "idle", error: message } }));
      return message;
    }
  }, []);
  const lastAnswered = [...convo.exchanges].reverse().find((e) => e.answer);
  const pending = (lastAnswered?.answer?.proposals ?? [])
    .map((p) => [`${lastAnswered!.id}:${p.id}`, p] as const)
    .filter(([key]) => (decisions[key]?.state ?? "idle") === "idle");

  // ------------------------------------------------------------------ voice

  const [voice, setVoice] = useState<{ status: VoiceStatus; partial: string; note: string | null }>({
    status: "off",
    partial: "",
    note: null,
  });
  const [level, setLevel] = useState(0);
  const link = useRef<VoiceLink | null>(null);
  const status = useRef<VoiceStatus>("off");
  const stopSpeaking = useRef<(() => void) | null>(null);
  const closingNote = useRef<string | null>(null);
  const lastHeard = useRef(0);

  const setStatus = useCallback((next: VoiceStatus, extra: Partial<{ partial: string; note: string | null }> = {}) => {
    status.current = next;
    setVoice((v) => ({ ...v, status: next, ...extra }));
  }, []);

  const listen = useCallback(() => {
    if (!link.current) return;
    link.current.setMuted(false);
    lastHeard.current = Date.now();
    setStatus("listening", { partial: "" });
  }, [setStatus]);

  /** Read text aloud with the microphone muted, then listen again. */
  const say = useCallback(
    (text: string) => {
      if (!link.current) return;
      link.current.setMuted(true);
      setStatus("speaking", { partial: "" });
      stopSpeaking.current?.();
      stopSpeaking.current = speak(text, () => {
        stopSpeaking.current = null;
        listen();
      });
    },
    [listen, setStatus],
  );

  const skip = useCallback(() => {
    stopSpeaking.current?.();
    stopSpeaking.current = null;
    listen();
  }, [listen]);

  const endVoice = useCallback((note: string | null = null) => {
    stopSpeaking.current?.();
    stopSpeaking.current = null;
    const current = link.current;
    link.current = null;
    status.current = "off";
    setVoice({ status: "off", partial: "", note });
    setLevel(0);
    current?.stop();
  }, []);

  const beginVoice = useCallback(async () => {
    if (status.current !== "off") return;
    setOpen(true);
    if (!voiceSupported()) {
      setVoice((v) => ({ ...v, note: "This browser can't do hands-free voice. Try Chrome, Edge or Safari." }));
      return;
    }
    closingNote.current = null;
    setStatus("connecting", { partial: "", note: null });
    // Speech synthesis needs a user gesture before it may talk: this click is it.
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    try {
      const opened = await startVoice({
        onEvent: (e) => latest.current.onVoiceEvent(e),
        onLevel: setLevel,
        onClose: () => latest.current.onVoiceClose(),
      });
      if (status.current === "off") opened.stop();
      else link.current = opened;
    } catch {
      status.current = "off";
      setVoice({
        status: "off",
        partial: "",
        note: "Elvis can't hear you: allow the microphone for this site in your browser's settings, then try again.",
      });
    }
  }, [setStatus]);

  useEffect(() => {
    latest.current = {
      onVoiceEvent(e) {
        if (e.type === "ready") {
          link.current?.chime();
          listen();
        } else if (e.type === "partial" && status.current === "listening") {
          lastHeard.current = Date.now();
          setVoice((v) => ({ ...v, partial: e.text }));
        } else if (e.type === "utterance" && status.current === "listening") {
          onUtterance(e.text);
        } else if (e.type === "ended") {
          closingNote.current = ENDED[e.reason] ?? null;
        } else if (e.type === "error") {
          closingNote.current = e.message;
        }
      },
      onVoiceClose() {
        if (status.current === "off") return;
        endVoice(closingNote.current ?? "Voice disconnected. Turn it on again to keep going.");
      },
      onSettled(exchange) {
        const go = exchange.answer?.navigate;
        if (go) {
          router.push(go.href);
          // On a phone the panel covers the page: get out of the way so the reviewer sees what opened.
          if (window.innerWidth < 640) setOpen(false);
        }
        if (!exchange.voice || status.current !== "thinking") return;
        if (exchange.answer) {
          const { text, proposals } = exchange.answer;
          say(proposals.length > 0 && !/\bconfirm\b/i.test(text) ? `${text} Say confirm, or cancel.` : text);
        } else {
          say(exchange.error ?? "Sorry, I couldn't answer that.");
        }
      },
    };

    function onUtterance(text: string) {
      lastHeard.current = Date.now();
      const command = spokenCommand(text);
      if (command === "end") {
        endVoice();
        speak("Okay. Voice is off.", () => {});
        return;
      }
      if ((command === "confirm" || command === "cancel") && pending.length > 0) {
        if (pending.length > 1) {
          say("There are a few suggestions. Tap the one you want.");
          return;
        }
        const [key, proposal] = pending[0];
        if (command === "cancel") {
          void decide(key, proposal, "dismiss");
          say("Okay, I've left it.");
          return;
        }
        link.current?.setMuted(true);
        setStatus("thinking", { partial: "" });
        void decide(key, proposal, "confirm").then((error) => say(error ? `That didn't work. ${error}` : `Done. ${proposal.label}.`));
        return;
      }
      if (convo.busy) return;
      link.current?.setMuted(true);
      setStatus("thinking", { partial: "" });
      void convo.send(text, { voice: true });
    }
  });

  // Hands-free shouldn't mean an open microphone nobody is using.
  useEffect(() => {
    if (voice.status !== "listening") return;
    const timer = setInterval(() => {
      if (Date.now() - lastHeard.current > QUIET_LIMIT_MS) endVoice("Voice turned off after two quiet minutes.");
    }, 5000);
    return () => clearInterval(timer);
  }, [voice.status, endVoice]);

  // Leaving the dashboard (or signing out) ends voice.
  useEffect(() => () => latest.current.onVoiceClose(), []);

  if (!user) return null;
  const context = contextFor(pathname);
  const voiceOn = voice.status !== "off";
  const hint =
    voice.status === "listening"
      ? pending.length > 0
        ? "Say “confirm” or “cancel”"
        : "Ask anything, or say “open the next report”"
      : voice.status === "thinking"
        ? (last?.pending && last.progress.at(-1)) || "Working on it"
        : voice.status === "speaking"
          ? "Skip to talk now"
          : "Allow the microphone if your browser asks";

  return (
    <>
      {!open && !voiceOn && (
        <div className="fixed bottom-5 right-5 z-40 flex items-center rounded-full bg-ink text-paper shadow-[var(--shadow-pop)] animate-rise">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-12 items-center gap-2 rounded-l-full pl-4 pr-3 text-[14px] font-medium transition-colors hover:bg-paper/5"
          >
            <MagicStar className="size-[18px] text-highlight" variant="Bold" />
            Ask Elvis
          </button>
          <span className="h-6 w-px bg-paper/15" aria-hidden />
          <button
            type="button"
            onClick={() => void beginVoice()}
            className="grid size-12 place-items-center rounded-r-full text-paper/80 transition-colors hover:bg-paper/5 hover:text-paper"
            aria-label="Talk to Elvis hands-free"
            title="Talk to Elvis hands-free"
          >
            <Microphone2 className="size-[18px]" />
          </button>
        </div>
      )}
      {!open && voiceOn && (
        <div className="fixed bottom-5 right-5 z-40 flex max-w-[calc(100vw-40px)] items-center gap-1 rounded-full bg-ink py-1 pl-1 pr-1.5 text-paper shadow-[var(--shadow-pop)] animate-rise" role="status">
          <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-2 pr-2 text-left" aria-label="Open Elvis">
            <VoiceOrb status={voice.status as Exclude<VoiceStatus, "off">} level={level} dark />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium">Elvis · {STATUS_LABEL[voice.status as Exclude<VoiceStatus, "off">]}</span>
              <span className="block max-w-[200px] truncate text-[12px] text-paper/60">{voice.partial ? `“${voice.partial}”` : hint}</span>
            </span>
          </button>
          {voice.status === "speaking" && (
            <button type="button" onClick={skip} className="h-8 rounded-full px-3 text-[13px] text-paper/80 hover:bg-paper/10 hover:text-paper">
              Skip
            </button>
          )}
          <button type="button" onClick={() => endVoice()} className="grid size-8 place-items-center rounded-full bg-paper/10 hover:bg-paper/20" aria-label="End voice" title="End voice">
            <Stop className="size-4" variant="Bold" />
          </button>
        </div>
      )}
      {open && (
        <aside
          aria-label="Elvis, the review assistant"
          className="fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col lg:top-0 border-l border-line bg-paper shadow-[var(--shadow-pop)] animate-fade-in sm:left-auto sm:w-[440px]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-ink text-highlight">
                <MagicStar className="size-4" variant="Bold" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">Elvis</h2>
                <p className="text-[12px] leading-snug text-ink-3">
                  {voiceOn ? "Hands-free · Meta Muse Voice transcribes you" : "Review assistant · suggests, you decide"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {convo.exchanges.length > 0 && !voiceOn && (
                <button type="button" onClick={convo.reset} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label="New conversation" title="New conversation">
                  <Refresh className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
                aria-label={voiceOn ? "Minimise Elvis (voice stays on)" : "Close Elvis"}
                title={voiceOn ? "Minimise, voice stays on" : "Close"}
              >
                {voiceOn ? <Minus className="size-4" /> : <CloseCircle className="size-4" />}
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
                      {answer.proposals.map((p) => {
                        const key = `${exchange.id}:${p.id}`;
                        return (
                          <ProposalCard
                            key={p.id}
                            proposal={p}
                            decision={decisions[key] ?? { state: "idle" }}
                            onConfirm={() => void decide(key, p, "confirm")}
                            onDismiss={() => void decide(key, p, "dismiss")}
                            voiceHint={voiceOn && pending.length === 1 && pending[0][0] === key}
                          />
                        );
                      })}
                    </div>
                  )
                }
              />
            ))}
          </div>

          <div className="border-t border-line bg-surface p-3">
            {voice.note && !voiceOn && <p className="mb-2 px-1 text-[12.5px] leading-snug text-ink-3" role="status">{voice.note}</p>}
            {voiceOn ? (
              <div className="flex items-center gap-3 rounded-2xl border border-line-strong bg-surface p-1.5 pl-2 shadow-[var(--shadow-card)]" role="status" aria-live="polite">
                <VoiceOrb status={voice.status as Exclude<VoiceStatus, "off">} level={level} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">{STATUS_LABEL[voice.status as Exclude<VoiceStatus, "off">]}</p>
                  <p className={clsx("line-clamp-2 text-[12.5px] leading-snug", voice.partial ? "text-ink-2" : "text-ink-3")}>
                    {voice.partial ? `“${voice.partial}”` : hint}
                  </p>
                </div>
                {voice.status === "speaking" && (
                  <Button size="sm" variant="ghost" onClick={skip}>
                    Skip
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => endVoice()} icon={<Stop className="size-3.5" variant="Bold" />}>
                  End
                </Button>
              </div>
            ) : (
              <Composer
                onSend={(q) => void convo.send(q)}
                onStop={convo.stop}
                busy={convo.busy}
                placeholder={context ? "Ask Elvis about this record…" : "Ask Elvis about the queue, a place, an incident…"}
                onVoice={() => void beginVoice()}
                autoFocus
              />
            )}
          </div>
        </aside>
      )}
    </>
  );
}
