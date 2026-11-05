"use client";

import { clsx } from "clsx";
import { ArrowUp, Copy, Microphone2, Stop, TickCircle } from "iconsax-reactjs";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import {
  ask,
  type AssistantContext,
  type AssistantMode,
  type AssistantNavigate,
  type AssistantProposal,
  type AssistantRef,
  type AssistantTurn,
} from "@/lib/assistant";
import { Spinner } from "../ui/feedback";

export interface Exchange {
  id: number;
  question: string;
  progress: string[];
  pending: boolean;
  /** Asked aloud in hands-free mode. */
  voice?: boolean;
  answer?: { text: string; refs: AssistantRef[]; proposals: AssistantProposal[]; navigate?: AssistantNavigate | null };
  error?: string;
}

/** One conversation with an assistant. Answers carry the records they cite and any proposals. */
export function useConversation(
  mode: AssistantMode,
  context: () => AssistantContext | undefined,
  onAnswer?: (refs: AssistantRef[]) => void,
  /** Called once per question when it has an answer or an error. */
  onSettled?: (exchange: Exchange) => void,
) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const busy = exchanges.some((e) => e.pending);

  const send = useCallback(
    async (question: string, options?: { voice?: boolean }) => {
      const q = question.trim();
      if (!q || busy) return;
      const id = nextId.current++;
      // The server keeps no chat state: send the recent turns with each question.
      const history: AssistantTurn[] = exchanges
        .flatMap((e): AssistantTurn[] =>
          e.answer
            ? [
                { role: "user", content: e.question },
                { role: "assistant", content: e.answer.text.slice(0, 6000) },
              ]
            : [],
        )
        .slice(-16);
      let latest: Exchange = { id, question: q, progress: [], pending: true, voice: options?.voice };
      setExchanges((prev) => [...prev, latest]);
      const update = (fn: (e: Exchange) => Exchange) => {
        latest = fn(latest);
        const next = latest;
        setExchanges((prev) => prev.map((e) => (e.id === id ? next : e)));
      };
      const abort = new AbortController();
      controller.current = abort;
      try {
        await ask(
          mode,
          [...history, { role: "user", content: q }],
          context(),
          (event) => {
            if (event.type === "progress") update((e) => ({ ...e, progress: [...e.progress, event.text] }));
            else if (event.type === "answer") {
              update((e) => ({
                ...e,
                pending: false,
                answer: { text: event.text, refs: event.refs, proposals: event.proposals, navigate: event.navigate },
              }));
              onAnswer?.(event.refs);
            } else update((e) => ({ ...e, pending: false, error: event.message }));
          },
          abort.signal,
          options,
        );
      } catch (err) {
        const stopped = err instanceof DOMException && err.name === "AbortError";
        update((e) => ({
          ...e,
          pending: false,
          error: stopped ? "Stopped." : err instanceof ApiError ? err.message : "Something went wrong. Try again.",
        }));
      } finally {
        update((e) => (e.pending ? { ...e, pending: false, error: e.error ?? "The assistant didn't answer. Try again." } : e));
        if (controller.current === abort) controller.current = null;
        onSettled?.(latest);
      }
    },
    [busy, context, exchanges, mode, onAnswer, onSettled],
  );

  const stop = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => {
    controller.current?.abort();
    setExchanges([]);
  }, []);

  return { exchanges, busy, send, stop, reset };
}

// ----------------------------------------------------------------------------- answer text

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bold, cited references and, when given, phrases that become links (such as a button's name). */
function inlinePattern(links?: Record<string, string>): RegExp {
  const phrases = Object.keys(links ?? {}).map(escape);
  const extra = phrases.length > 0 ? `|${phrases.join("|")}` : "";
  return new RegExp(`(\\*\\*[^*\\n]+\\*\\*|\\b(?:INC|MS)-[2-9A-HJKMNP-Z]{6}\\b${extra})`, "g");
}

function Inline({
  text,
  refs,
  renderRef,
  links,
}: {
  text: string;
  refs: Map<string, AssistantRef>;
  renderRef: (ref: AssistantRef) => ReactNode;
  links?: Record<string, string>;
}) {
  const link = (phrase: string, children: ReactNode, key: number) => (
    <Link key={key} href={links![phrase]} className="font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
  return (
    <>
      {text.split(inlinePattern(links)).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          const inner = part.slice(2, -2);
          const bold = <strong className="font-semibold text-ink">{inner}</strong>;
          return links?.[inner] ? link(inner, bold, i) : <Fragment key={i}>{bold}</Fragment>;
        }
        if (links?.[part]) return link(part, part, i);
        const ref = refs.get(part);
        return ref ? <Fragment key={i}>{renderRef(ref)}</Fragment> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let open = false; // whether the next line continues the last block
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const last = open ? blocks[blocks.length - 1] : undefined;
    const item = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      open = false;
      continue;
    }
    open = true;
    if (item) {
      const kind = /^[-*•]/.test(line) ? "ul" : "ol";
      if (last && last.kind === kind) last.items.push(item[1]);
      else blocks.push({ kind, items: [item[1]] });
    } else if (last && last.kind !== "p" && /^\s/.test(raw)) {
      last.items[last.items.length - 1] += ` ${line}`;
    } else if (last && last.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return blocks;
}

/** The model's plain-text answer: paragraphs, lists, bold, and cited references as links. */
export function AnswerText({
  text,
  refs,
  renderRef,
  links,
}: {
  text: string;
  refs: AssistantRef[];
  renderRef: (ref: AssistantRef) => ReactNode;
  links?: Record<string, string>;
}) {
  const byRef = new Map(refs.map((r) => [r.reference, r]));
  return (
    <div className="space-y-2.5 text-[14px] leading-relaxed text-ink-2">
      {toBlocks(text).map((block, i) =>
        block.kind === "p" ? (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={line} refs={byRef} renderRef={renderRef} links={links} />
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i} className={clsx("space-y-1.5 pl-5", block.kind === "ol" ? "list-decimal" : "list-disc marker:text-ink-3")}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline text={item} refs={byRef} renderRef={renderRef} links={links} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- exchange

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:bg-sunken hover:text-ink"
    >
      {copied ? <TickCircle className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The question, the lookups as they run, then the answer. */
export function ExchangeView({
  exchange,
  renderRef,
  footer,
  links,
}: {
  exchange: Exchange;
  renderRef: (ref: AssistantRef) => ReactNode;
  footer?: (answer: NonNullable<Exchange["answer"]>) => ReactNode;
  /** Phrases in answers that become links, e.g. {"Report a hazard": "/report"}. */
  links?: Record<string, string>;
}) {
  const { question, progress, pending, answer, error } = exchange;
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[14px] leading-relaxed text-accent-ink">
          {exchange.voice && <Microphone2 className="-mt-0.5 mr-1.5 inline size-3.5 opacity-70" aria-label="Spoken" />}
          {question}
        </p>
      </div>
      {(pending || progress.length > 0) && (
        <ol className="space-y-1" aria-label="What the assistant looked up">
          {progress.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-3">
              <TickCircle className="mt-px size-3.5 shrink-0 text-success" variant="Bold" />
              {step}
            </li>
          ))}
          {pending && (
            <li className="flex items-center gap-2 text-[12.5px] text-ink-3" aria-live="polite">
              <Spinner className="size-3.5 text-accent" />
              {progress.length === 0 ? "Thinking…" : "Working on it…"}
            </li>
          )}
        </ol>
      )}
      {answer && (
        <div className="space-y-3">
          <AnswerText text={answer.text} refs={answer.refs} renderRef={renderRef} links={links} />
          {footer?.(answer)}
          <CopyButton text={answer.text} />
        </div>
      )}
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------- composer

export function Composer({
  onSend,
  onStop,
  busy,
  placeholder,
  autoFocus,
  className,
  onVoice,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  /** Shows a microphone button that switches to hands-free voice. */
  onVoice?: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  function submit() {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  }

  return (
    <form
      className={clsx(
        "flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-1.5 pl-3.5 shadow-[var(--shadow-card)] focus-within:border-accent",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="max-h-[132px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-snug text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
      />
      {onVoice && !busy && !text.trim() && (
        <button
          type="button"
          onClick={onVoice}
          className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-sunken hover:text-ink"
          aria-label="Talk hands-free"
          title="Talk hands-free"
        >
          <Microphone2 className="size-[18px]" />
        </button>
      )}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-sunken text-ink-2 hover:text-ink"
          aria-label="Stop"
          title="Stop"
        >
          <Stop className="size-4" variant="Bold" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!text.trim()}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white hover:bg-accent-hover disabled:bg-sunken disabled:text-ink-3"
          aria-label="Send"
          title="Send"
        >
          <ArrowUp className="size-4" />
        </button>
      )}
    </form>
  );
}

/** Example questions shown before the first one. */
export function Starters({ items, onPick }: { items: string[]; onPick: (q: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-[12.5px] leading-snug text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
