"use client";

import { clsx } from "clsx";
import {
  Chart,
  CloseCircle,
  DirectInbox,
  DocumentText,
  Element3,
  Flag,
  Global,
  HamburgerMenu,
  Hierarchy,
  LocationSlash,
  Logout,
  Map1,
} from "iconsax-reactjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useApi, usePolling, type AsyncState } from "@/lib/hooks";
import type { ReviewSummary } from "@/lib/types";
import { ReviewAssistant } from "../assistant/review-assistant";
import { LogoMark } from "../brand";
import { useRequireReviewer } from "../session";
import { Skeleton } from "../ui/feedback";
import { Page } from "../ui/page";

const SummaryContext = createContext<AsyncState<ReviewSummary> | null>(null);

/** The review counts the sidebar shows, shared with the pages so they poll once. */
export function useReviewSummary(): AsyncState<ReviewSummary> {
  const ctx = useContext(SummaryContext);
  if (!ctx) throw new Error("useReviewSummary must be used inside DashboardShell");
  return ctx;
}

type Icon = ComponentType<{ className?: string; variant?: "Linear" | "Bold" }>;
interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  exact?: boolean;
  count?: (s: ReviewSummary) => number;
  /** Counts that need a decision are drawn in the accent colour. */
  urgent?: boolean;
}

const NAV: { title?: string; admin?: boolean; items: NavItem[] }[] = [
  { items: [{ href: "/review", label: "Overview", icon: Element3, exact: true }] },
  {
    title: "Review",
    items: [
      {
        href: "/review/queue",
        label: "Review queue",
        icon: DirectInbox,
        count: (s) => s.reports_awaiting_review + s.processing_failures,
        urgent: true,
      },
      { href: "/review/duplicates", label: "Duplicates", icon: Hierarchy, count: (s) => s.potential_duplicates, urgent: true },
      { href: "/review/incidents", label: "Incidents", icon: Flag, count: (s) => s.incidents_confirmed },
      { href: "/review/unlocated", label: "Unlocated", icon: LocationSlash, count: (s) => s.unlocated_reports },
      { href: "/review/reports", label: "All reports", icon: DocumentText, count: (s) => s.reports_total },
    ],
  },
  {
    title: "Explore",
    items: [
      { href: "/map", label: "Public map", icon: Map1 },
      { href: "/", label: "Public site", icon: Global, exact: true },
    ],
  },
  { title: "Admin", admin: true, items: [{ href: "/admin", label: "Model usage", icon: Chart }] },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, signOut } = useRequireReviewer();
  const summary = useContext(SummaryContext)?.data;

  return (
    <div className="flex h-full flex-col">
      <Link href="/review" onClick={onNavigate} className="flex items-center gap-2.5 px-5 pb-6 pt-5 text-paper">
        <LogoMark className="size-8" />
        <span className="text-[15px] font-semibold tracking-tight">MtaaSense</span>
        <span className="rounded-md border border-paper/15 px-1.5 py-0.5 text-[11px] font-medium text-paper/60">Review</span>
      </Link>

      <nav aria-label="Dashboard" className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {NAV.filter((section) => !section.admin || user?.role === "admin").map((section, i) => (
          <div key={section.title ?? i}>
            {section.title && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-paper/40">{section.title}</p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                const count = summary && item.count ? item.count(summary) : undefined;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "group relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-[14px] transition-colors",
                        active ? "bg-paper/10 font-medium text-paper" : "text-paper/65 hover:bg-paper/5 hover:text-paper",
                      )}
                    >
                      {active && <span className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-accent" aria-hidden />}
                      <Icon className={clsx("size-[18px] shrink-0", active ? "text-accent" : "text-paper/50 group-hover:text-paper/80")} variant={active ? "Bold" : "Linear"} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {count !== undefined && (
                        <span
                          className={clsx(
                            "min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums",
                            item.urgent && count > 0 ? "bg-accent text-white" : "bg-paper/10 text-paper/60",
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {user && (
        <div className="flex items-center gap-3 border-t border-paper/10 px-4 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white" aria-hidden>
            {initials(user.display_name) || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-paper">{user.display_name}</p>
            <p className="text-[12px] capitalize text-paper/50">{user.role}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="grid size-9 place-items-center rounded-lg text-paper/50 hover:bg-paper/10 hover:text-paper"
            aria-label="Sign out"
            title="Sign out"
          >
            <Logout className="size-[18px]" />
          </button>
        </div>
      )}
    </div>
  );
}

/** The review dashboard: a sidebar of sections with live counts beside the page. No site header or footer. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const session = useRequireReviewer();
  const summary = useApi(() => api.reviewSummary(), session.allowed ? "summary" : null);
  usePolling(summary.reload, 10000, session.allowed);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <SummaryContext value={summary}>
      <div className="flex flex-1 bg-paper">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] bg-night lg:block">
          <Sidebar />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:pl-[256px]">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-night px-4 text-paper lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="-ml-1.5 grid size-9 place-items-center rounded-lg text-paper/80 hover:bg-paper/10"
              aria-label="Open the menu"
              aria-expanded={menuOpen}
            >
              <HamburgerMenu className="size-5" />
            </button>
            <Link href="/review" className="flex items-center gap-2">
              <LogoMark className="size-7" />
              <span className="text-[15px] font-semibold">MtaaSense</span>
            </Link>
          </header>

          <main id="main" className="flex flex-1 flex-col">
            {session.allowed ? children : <Page><Skeleton className="h-96" /></Page>}
          </main>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in" onClick={() => setMenuOpen(false)} aria-label="Close the menu" />
            <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-night shadow-[var(--shadow-pop)] animate-fade-in">
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="absolute right-3 top-4 grid size-9 place-items-center rounded-lg text-paper/60 hover:bg-paper/10 hover:text-paper"
                aria-label="Close the menu"
              >
                <CloseCircle className="size-5" />
              </button>
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        )}
      </div>
      {session.allowed && <ReviewAssistant />}
    </SummaryContext>
  );
}
