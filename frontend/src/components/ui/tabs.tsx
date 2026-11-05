"use client";

import { clsx } from "clsx";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CountCircle } from "./count";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  /** Draw the count in the accent colour: something here needs a decision. */
  attention?: boolean;
}

/** The selected tab, kept in `?tab=` so a reload or a shared link opens the same tab. */
export function useTab<T extends string>(ids: readonly T[], fallback: T): [T, (tab: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab") as T | null;
  const tab = requested && ids.includes(requested) ? requested : fallback;
  const select = useCallback(
    (next: T) => {
      const query = new URLSearchParams(params.toString());
      if (next === fallback) query.delete("tab");
      else query.set("tab", next);
      const qs = query.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [fallback, params, pathname, router],
  );
  return [tab, select];
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (tab: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = items.findIndex((t) => t.id === value);
    const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
    e.preventDefault();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className={clsx("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={clsx(
              "-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[14px] transition-colors",
              selected ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <CountCircle value={t.count} size="sm" tone={t.attention ? "accent" : "neutral"} />}
          </button>
        );
      })}
    </div>
  );
}

/** Only the selected panel is rendered, so its data loads when it is opened. */
export function TabPanel({ id, value, children, className }: { id: string; value: string; children: ReactNode; className?: string }) {
  if (id !== value) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={clsx("pt-5 animate-fade-in", className)}>
      {children}
    </div>
  );
}
