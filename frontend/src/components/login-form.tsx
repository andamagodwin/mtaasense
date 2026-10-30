"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "./session";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Callout } from "./ui/feedback";
import { Field, Input } from "./ui/field";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/review";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      await refresh();
      router.replace(target);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm animate-rise">
      <form onSubmit={onSubmit} className="space-y-5 p-6">
        <div>
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-ink">
            <LockKeyhole className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Reviewer sign in</h1>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
            Reviewers compare evidence, link duplicate reports and manage incidents. Residents don’t need an account.
          </p>
        </div>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" loading={busy} className="w-full" size="lg">
          Sign in
        </Button>
      </form>
    </Card>
  );
}
