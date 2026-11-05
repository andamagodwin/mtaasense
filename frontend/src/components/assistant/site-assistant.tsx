"use client";

import { CloseCircle, MagicStar, Refresh } from "iconsax-reactjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AssistantRef } from "@/lib/assistant";
import { CategoryDot } from "../badges";
import { Composer, ExchangeView, Starters, useConversation } from "./conversation";

const STARTERS = [
  "What is MtaaSense?",
  "How do I report a pothole?",
  "What happens after I report?",
  "Is my photo kept private?",
  "How many problems have been reported so far?",
];

// The assistant names the site's buttons exactly, so they become links in its answers.
const LINKS = { "Report a hazard": "/report", "View the map": "/map" };

const noContext = () => undefined;

function RefChip({ item }: { item: AssistantRef }) {
  const chip = (
    <>
      <CategoryDot category={item.hazard_category} />
      {item.reference}
    </>
  );
  const className =
    "inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 font-mono text-[12.5px] font-medium text-ink no-underline";
  // Incidents open on the public map; individual reports have no public page.
  return item.kind === "incident" ? (
    <Link href={`/map?incident=${item.id}`} title={item.title ?? "Show on the map"} className={`${className} hover:border-accent-line hover:bg-accent-soft`}>
      {chip}
    </Link>
  ) : (
    <span className={className}>{chip}</span>
  );
}

/** Ask MtaaSense: public questions about what MtaaSense is and does, on the landing page. */
export function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const convo = useConversation("site", noContext);
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-ink pl-4 pr-5 text-[14px] font-medium text-paper shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5 animate-rise"
      >
        <MagicStar className="size-[18px] text-highlight" variant="Bold" />
        Ask MtaaSense
      </button>
    );
  }

  return (
    <section
      aria-label="Ask MtaaSense"
      className="fixed inset-0 z-50 flex flex-col bg-paper animate-fade-in sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(640px,calc(100dvh-40px))] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-line sm:shadow-[var(--shadow-pop)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-ink text-highlight">
            <MagicStar className="size-4" variant="Bold" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Ask MtaaSense</h2>
            <p className="text-[12px] leading-snug text-ink-3">How it works, reporting, privacy · Muse Spark</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {convo.exchanges.length > 0 && (
            <button type="button" onClick={convo.reset} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label="New conversation" title="New conversation">
              <Refresh className="size-4" />
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close" title="Close">
            <CloseCircle className="size-4" />
          </button>
        </div>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {convo.exchanges.length === 0 && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-ink-2">
              Hi! Ask me anything about MtaaSense: what it is, how to report a problem, what happens next, or what
              has been reported.
            </p>
            <Starters items={STARTERS} onPick={(q) => void convo.send(q)} />
          </div>
        )}
        {convo.exchanges.map((exchange) => (
          <ExchangeView key={exchange.id} exchange={exchange} renderRef={(item) => <RefChip item={item} />} links={LINKS} />
        ))}
      </div>

      <div className="space-y-2 border-t border-line bg-surface p-3">
        <Composer onSend={(q) => void convo.send(q)} onStop={convo.stop} busy={convo.busy} placeholder="Ask about MtaaSense…" autoFocus />
        <p className="px-1 text-[11.5px] leading-snug text-ink-3">
          Not an emergency service. If someone is in danger, call 112 or 999.
        </p>
      </div>
    </section>
  );
}
