"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { UserView } from "@/lib/types";

interface SessionState {
  user: UserView | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserView | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser((await api.session()).user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  useEffect(() => {
    api
      .session()
      .then((s) => setUser(s.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return <SessionContext value={{ user, loading, refresh, signOut }}>{children}</SessionContext>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** Redirects to /login when there is no reviewer session. Server-side checks remain authoritative. */
export function useRequireReviewer(role: "reviewer" | "admin" = "reviewer"): SessionState & { allowed: boolean } {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = !!session.user && (role === "reviewer" || session.user.role === "admin");
  useEffect(() => {
    if (!session.loading && !session.user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [session.loading, session.user, router, pathname]);
  return { ...session, allowed };
}
