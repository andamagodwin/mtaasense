"use client";

import { clsx } from "clsx";
import { MagicStar, Refresh } from "iconsax-reactjs";
import { useCallback, useEffect, useRef } from "react";
import type { AssistantContext, AssistantRef } from "@/lib/assistant";
import { CategoryDot } from "../badges";
import { Composer, ExchangeView, Starters, useConversation } from "../assistant/conversation";

const STARTERS = [
  "What has been reported in this area?",
  "Any blocked drains that could flood if it rains?",
  "Which roads have the most pothole reports?",
  "What was fixed recently?",
];

/** Questions about the map in plain language. Cited incidents light up on the map. */
export function AskTheMap({
  context,
  onAnswer,
  onPick,
  highlighted,
}: {
  context: () => AssistantContext | undefined;
  onAnswer: (refs: AssistantRef[]) => void;
  onPick: (ref: AssistantRef) => void;
  highlighted: boolean;
}) {
  const getContext = useCallback(() => context(), [context]);
  const convo = useConversation("map", getContext, onAnswer);
  const scroller = useRef<HTMLDivElement>(null);
  const last = convo.exchanges.at(-1);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [convo.exchanges.length, last?.progress.length, last?.answer]);

  return (
    <section aria-label="Ask the map" className="space-y-3 rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <MagicStar className="size-4 text-highlight" variant="Bold" />
          Ask the map
        </h2>
        {convo.exchanges.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              convo.reset();
              onAnswer([]);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <Refresh className="size-3.5" /> Clear
          </button>
        ) : (
          <span className="text-[11.5px] text-ink-3">Muse Spark</span>
        )}
      </div>

      {convo.exchanges.length === 0 ? (
        <Starters items={STARTERS} onPick={(q) => void convo.send(q)} />
      ) : (
        <div ref={scroller} className="max-h-[42vh] space-y-5 overflow-y-auto pr-1 lg:max-h-[38vh]">
          {convo.exchanges.map((exchange) => (
            <ExchangeView
              key={exchange.id}
              exchange={exchange}
              renderRef={(item) => (
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  title={item.location ? "Show on the map" : "This record has no location"}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 font-mono text-[12.5px] font-medium text-ink",
                    item.location ? "border-highlight-line bg-highlight-soft hover:border-highlight" : "border-line bg-sunken",
                  )}
                >
                  <CategoryDot category={item.hazard_category} />
                  {item.reference}
                </button>
              )}
            />
          ))}
        </div>
      )}

      {highlighted && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <span className="size-2.5 rounded-full border-2 border-highlight" aria-hidden /> Records in the answer are ringed on the map.
        </p>
      )}

      <Composer
        onSend={(q) => void convo.send(q)}
        onStop={convo.stop}
        busy={convo.busy}
        placeholder="Ask about this area, a road, a neighbourhood…"
      />
      <p className="text-[11.5px] leading-snug text-ink-3">
        Answers come from reviewed records and may be out of date. In an emergency, call 112 or 999.
      </p>
    </section>
  );
}
