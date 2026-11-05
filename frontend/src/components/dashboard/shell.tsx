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
  Logout,
  Map1,
  SidebarLeft,
  SidebarRight,
} from "iconsax-reactjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { useApi, usePolling, type AsyncState } from "@/lib/hooks";
import type { ReviewSummary } from "@/lib/types";
import { ReviewAssistant } from "../assistant/review-assistant";
import { LogoMark } from "../brand";
import { useRequireReviewer } from "../session";
import { Skeleton } from "../ui/feedback";
import { Page } from "../ui/page";

const SummaryContext = createContext<AsyncState<ReviewSummary> | null>(null);

/** The review counts, polled once by the shell and shared with the pages. */
export function useReviewSummary(): AsyncState<ReviewSummary> {
  const ctx = useContext(SummaryContext);
  if (!ctx) throw new Error("useReviewSummary must be used inside DashboardShell");
  return ctx;
}

// --------------------------------------------------------------------------- collapsed state (per browser)

const COLLAPSED_KEY = "mtaasense:sidebar-collapsed";
const COLLAPSED_EVENT = "mtaasense:sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSED_EVENT, onChange);
  };
}

function setCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* storage blocked: the toggle still works until reload */
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

function useCollapsed(): boolean {
  return useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
}

// --------------------------------------------------------------------------- navigation

type Icon = ComponentType<{ className?: string; variant?: "Linear" | "Bold" }>;
interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  exact?: boolean;
  /** Only lists that need a decision carry a count. */
  count?: (s: ReviewSummary) => number;
  admin?: boolean;
}

// Two groups, few choices: the work, then the map and admin.
const MAIN: NavItem[] = [
  { href: "/review", label: "Overview", icon: Element3, exact: true },
  { href: "/review/queue", label: "Queue", icon: DirectInbox, count: (s) => s.reports_awaiting_review + s.processing_failures },
  { href: "/review/duplicates", label: "Duplicates", icon: Hierarchy, count: (s) => s.potential_duplicates },
  { href: "/review/incidents", label: "Incidents", icon: Flag },
  { href: "/review/reports", label: "Reports", icon: DocumentText },
];
const SECONDARY: NavItem[] = [
  { href: "/map", label: "Map", icon: Map1 },
  { href: "/admin", label: "Usage", icon: Chart, admin: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  if (item.href === "/review/reports" && pathname.startsWith("/review/unlocated")) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** A count in a circle. Every circle is the same size, whatever the number. */
function CountCircle({ value, small }: { value: number; small?: boolean }) {
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full bg-accent font-mono font-medium leading-none tabular-nums text-white",
        small ? "size-[18px] text-[9.5px]" : "size-[22px] text-[11px]",
        value > 99 && (small ? "text-[7.5px]" : "text-[9px]"),
      )}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const summary = useContext(SummaryContext)?.data;
  const active = isActive(pathname, item);
  const count = summary && item.count ? item.count(summary) : 0;
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? (count ? `${item.label} (${count})` : item.label) : undefined}
      className={clsx(
        "group relative flex h-10 items-center rounded-lg text-[14px] transition-colors",
        collapsed ? "justify-center" : "gap-3 px-2.5",
        active ? "bg-paper/10 font-medium text-paper" : "text-paper/65 hover:bg-paper/5 hover:text-paper",
      )}
    >
      {active && <span className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-accent" aria-hidden />}
      <span className="relative">
        <Icon
          className={clsx("size-[18px] shrink-0", active ? "text-accent" : "text-paper/50 group-hover:text-paper/80")}
          variant={active ? "Bold" : "Linear"}
        />
        {collapsed && count > 0 && (
          <span className="absolute -right-3 -top-2.5">
            <CountCircle value={count} small />
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && count > 0 && <CountCircle value={count} />}
    </Link>
  );
}

function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { user, signOut } = useRequireReviewer();
  const secondary = SECONDARY.filter((item) => !item.admin || user?.role === "admin");

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/review"
        onClick={onNavigate}
        className={clsx("flex h-16 shrink-0 items-center gap-2.5 text-paper", collapsed ? "justify-center" : "px-5")}
        aria-label="MtaaSense review dashboard"
      >
        <LogoMark className="size-8 shrink-0" />
        {!collapsed && <span className="text-[15px] font-semibold tracking-tight">MtaaSense</span>}
      </Link>

      <nav aria-label="Dashboard" className={clsx("flex-1 overflow-y-auto pb-6 pt-2", collapsed ? "px-3" : "px-3")}>
        <ul className="space-y-0.5">
          {MAIN.map((item) => (
            <li key={item.href}>
              <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <div className="-mx-3 my-4 h-px bg-paper/10" aria-hidden />
        <ul className="space-y-0.5">
          {secondary.map((item) => (
            <li key={item.href}>
              <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      {user && (
        <div className={clsx("flex shrink-0 items-center border-t border-paper/10 py-3", collapsed ? "flex-col gap-1 px-2" : "gap-2 px-4")}>
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white"
            title={collapsed ? user.display_name : undefined}
            aria-hidden
          >
            {initials(user.display_name) || "?"}
          </span>
          {!collapsed && <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-paper">{user.display_name}</p>}
          <Link
            href="/"
            className="grid size-9 place-items-center rounded-lg text-paper/50 hover:bg-paper/10 hover:text-paper"
            aria-label="Public site"
            title="Public site"
          >
            <Global className="size-[18px]" />
          </Link>
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

/** The review dashboard: a collapsible sidebar beside a white page. No site header or footer. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const session = useRequireReviewer();
  const summary = useApi(() => api.reviewSummary(), session.allowed ? "summary" : null);
  usePolling(summary.reload, 10000, session.allowed);
  const collapsed = useCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <SummaryContext value={summary}>
      <div data-dashboard className="flex flex-1 bg-surface">
        <aside
          className={clsx(
            "fixed inset-y-0 left-0 z-30 hidden bg-night transition-[width] duration-200 lg:block",
            collapsed ? "w-[72px]" : "w-[240px]",
          )}
        >
          <Sidebar collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="absolute -right-3.5 top-5 grid size-7 place-items-center rounded-full border border-line bg-surface text-ink-3 shadow-[var(--shadow-card)] hover:text-ink"
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <SidebarRight className="size-3.5" /> : <SidebarLeft className="size-3.5" />}
          </button>
        </aside>

        <div className={clsx("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[240px]")}>
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

          <main id="main" className="flex flex-1 flex-col pb-16">
            {session.allowed ? children : <Page><Skeleton className="h-96" /></Page>}
          </main>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in" onClick={() => setMenuOpen(false)} aria-label="Close the menu" />
            <div className="absolute inset-y-0 left-0 w-[264px] max-w-[85vw] bg-night shadow-[var(--shadow-pop)] animate-fade-in">
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="absolute right-3 top-3.5 grid size-9 place-items-center rounded-lg text-paper/60 hover:bg-paper/10 hover:text-paper"
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
