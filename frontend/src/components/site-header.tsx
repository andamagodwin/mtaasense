"use client";

import { clsx } from "clsx";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./session";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--color-accent)" />
      <path d="M16 6.5c-4.1 0-7.2 3.1-7.2 7 0 5.2 7.2 11.9 7.2 11.9s7.2-6.7 7.2-11.9c0-3.9-3.1-7-7.2-7Z" fill="#f7f5f0" />
      <path d="M12.6 13.6l2.3 1.6 1.9-3 2.6 2.1" stroke="var(--color-accent)" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { user, signOut } = useSession();

  const links = [
    { href: "/report", label: "Report" },
    { href: "/map", label: "Map" },
    { href: "/review", label: "Review" },
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Usage" }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-lg pr-2" aria-label="MtaaSense home">
          <LogoMark className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">MtaaSense</span>
        </Link>
        <nav aria-label="Primary" className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken/70 hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {user ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-ink-3 sm:inline">
              {user.display_name} · <span className="capitalize">{user.role}</span>
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Link href="/login" className="hidden rounded-lg px-2.5 py-1.5 text-[13px] text-ink-3 hover:text-ink sm:inline">
            Reviewer sign in
          </Link>
        )}
      </div>
    </header>
  );
}

/** Static shell rendered while the route's URL data streams in (Suspense fallback). */
export function SiteHeaderFallback() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-lg pr-2" aria-label="MtaaSense home">
          <LogoMark className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">MtaaSense</span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-0.5">
          {["Report", "Map", "Review"].map((label) => (
            <Link key={label} href={`/${label.toLowerCase()}`} className="rounded-lg px-2.5 py-1.5 text-sm text-ink-2">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
