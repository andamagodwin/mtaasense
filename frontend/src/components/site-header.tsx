"use client";

import { clsx } from "clsx";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./brand";
import { useSession } from "./session";

// Residents get two destinations; reviewer tools appear only once someone has signed in.
const PUBLIC_LINKS = [
  { href: "/report", label: "Report" },
  { href: "/map", label: "Map" },
];

function HeaderShell({ children }: { children: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
        <Logo />
        {children}
      </div>
    </header>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { user, signOut } = useSession();

  const links = [
    ...PUBLIC_LINKS,
    ...(user ? [{ href: "/review", label: "Review" }] : []),
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Usage" }] : []),
  ];

  return (
    <HeaderShell>
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
          <span className="hidden text-[13px] text-ink-3 sm:inline">{user.display_name}</span>
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
        <Link href="/login" className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-3 hover:text-ink">
          Sign in
        </Link>
      )}
    </HeaderShell>
  );
}

/** Static shell rendered while the route's URL data streams in (Suspense fallback). */
export function SiteHeaderFallback() {
  return (
    <HeaderShell>
      <nav aria-label="Primary" className="flex flex-1 items-center gap-0.5">
        {PUBLIC_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-lg px-2.5 py-1.5 text-sm text-ink-2">
            {link.label}
          </Link>
        ))}
      </nav>
    </HeaderShell>
  );
}
