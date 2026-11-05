"use client";

import { DirectInbox, Flag, Forbidden, Hierarchy, Monitor, Mobile } from "iconsax-reactjs";
import Link from "next/link";
import { useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { SessionInfo } from "@/lib/types";
import { ACTION_LABEL } from "../review/activity";
import { useRequireReviewer } from "../session";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { Callout, EmptyState, Skeleton } from "../ui/feedback";
import { Field, Input } from "../ui/field";
import { Page } from "../ui/page";
import { TabPanel, Tabs, useTab } from "../ui/tabs";

const TABS = ["activity", "account", "devices"] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** "Chrome on macOS" from a user-agent string; good enough to tell devices apart. */
function deviceName(ua: string | null): { name: string; phone: boolean } {
  if (!ua) return { name: "Unknown device", phone: false };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { name: os ? `${browser} on ${os}` : browser, phone: /iPhone|Android|Mobile/.test(ua) };
}

const STATS: { label: string; actions: string[]; icon: ComponentType<{ className?: string }> }[] = [
  { label: "Confirmed", actions: ["report_confirm_incident"], icon: DirectInbox },
  { label: "Rejected", actions: ["report_reject"], icon: Forbidden },
  { label: "Duplicates linked", actions: ["duplicate_confirmed"], icon: Hierarchy },
  { label: "Resolved", actions: ["incident_resolved"], icon: Flag },
];

function Activity() {
  const activity = useApi(() => api.myActivity(), "my-activity");
  if (activity.error) return <Callout tone="danger">{activity.error.message}</Callout>;
  if (!activity.data) return <Skeleton className="h-64" />;
  const { counts, recent } = activity.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {STATS.map(({ label, actions, icon: Icon }) => (
          <div key={label} className="card rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <Icon className="size-4 text-ink-3" />
            <p className="mt-3 font-mono text-[26px] font-medium leading-none tabular-nums">
              {actions.reduce((n, a) => n + (counts[a] ?? 0), 0)}
            </p>
            <p className="mt-1.5 text-[12.5px] text-ink-3">{label}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader title="Recent decisions" />
        {recent.length === 0 ? (
          <EmptyState title="No decisions yet" />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((e) => {
              const ref = e.incident ?? e.report;
              const href = e.incident ? `/review/incidents/${e.incident.id}` : e.report ? `/review/reports/${e.report.id}` : null;
              return (
                <li key={e.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-ink">
                      {ACTION_LABEL[e.action] ?? e.action.replaceAll("_", " ")}
                      {ref && href && (
                        <>
                          {" "}
                          <Link href={href} className="font-mono text-[13px] text-accent hover:text-accent-hover">
                            {ref.reference}
                          </Link>
                        </>
                      )}
                    </p>
                    {e.note && <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-3">“{e.note}”</p>}
                  </div>
                  <span className="shrink-0 text-[12.5px] text-ink-3" title={formatDateTime(e.created_at)}>
                    {timeAgo(e.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NameForm() {
  const { user, refresh } = useRequireReviewer();
  const [name, setName] = useState(user?.display_name ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== user?.display_name && name.trim().length >= 2;

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      await api.updateMe(name.trim());
      await refresh();
      setState("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name.");
      setState("idle");
    }
  }

  return (
    <Card>
      <CardHeader title="Name" />
      <CardBody>
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Shown on your decisions and notes" htmlFor="profile-name" className="flex-1">
            <Input id="profile-name" value={name} onChange={(e) => { setName(e.target.value); setState("idle"); }} maxLength={120} autoComplete="name" />
          </Field>
          <Button type="submit" variant="secondary" disabled={!changed} loading={state === "saving"}>
            {state === "saved" && !changed ? "Saved" : "Save"}
          </Button>
        </form>
        {error && <Callout tone="danger" className="mt-3">{error}</Callout>}
      </CardBody>
    </Card>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 12 && next === confirm;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Password" />
      <CardBody>
        <form onSubmit={(e) => void save(e)} className="space-y-3">
          <Field label="Current password" htmlFor="pw-current">
            <Input id="pw-current" type="password" value={current} onChange={(e) => { setCurrent(e.target.value); setDone(false); }} autoComplete="current-password" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New password" hint="At least 12 characters" htmlFor="pw-new">
              <Input id="pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} />
            </Field>
            <Field label="Repeat it" htmlFor="pw-confirm" error={mismatch ? "Doesn't match" : undefined}>
              <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
          {done && <Callout tone="success">Password changed. Your other devices are signed out.</Callout>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!ready} loading={busy}>
              Change password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

interface DeviceGroup {
  name: string;
  phone: boolean;
  sessions: SessionInfo[];
}

function Devices() {
  const sessions = useApi(() => api.sessions(), "my-sessions");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut(key: string, ids: string[] | "others") {
    setBusy(key);
    setError(null);
    try {
      if (ids === "others") await api.revokeOtherSessions();
      else await Promise.all(ids.map((id) => api.revokeSession(id)));
      sessions.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign that device out.");
    } finally {
      setBusy(null);
    }
  }

  if (!sessions.data) return <Skeleton className="h-40" />;
  const current = sessions.data.find((s) => s.current);
  // One row per device: repeated sign-ins from the same browser are not separate devices to a person.
  const groups = new Map<string, DeviceGroup>();
  for (const s of sessions.data) {
    if (s.current) continue;
    const device = deviceName(s.user_agent);
    const group = groups.get(device.name) ?? { ...device, sessions: [] };
    group.sessions.push(s);
    groups.set(device.name, group);
  }
  const others = sessions.data.length - (current ? 1 : 0);

  const row = (key: string, name: string, phone: boolean, detail: string, action: ReactNode) => {
    const Icon = phone ? Mobile : Monitor;
    return (
      <li key={key} className="flex items-center gap-4 px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-ink-2">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">{name}</p>
          <p className="text-[12.5px] text-ink-3">{detail}</p>
        </div>
        {action}
      </li>
    );
  };

  return (
    <Card>
      <ul className="divide-y divide-line">
        {current &&
          row(
            current.id,
            deviceName(current.user_agent).name,
            deviceName(current.user_agent).phone,
            `Signed in ${formatDate(current.created_at)}`,
            <span className="rounded-full bg-success-soft px-2.5 py-1 text-[12px] font-medium text-success-ink">This device</span>,
          )}
        {[...groups.values()].map((g) =>
          row(
            g.name,
            g.name,
            g.phone,
            `${g.sessions.length > 1 ? `${g.sessions.length} sessions · latest ` : "Signed in "}${formatDate(g.sessions[0].created_at)}`,
            <Button size="sm" variant="ghost" onClick={() => void signOut(g.name, g.sessions.map((x) => x.id))} loading={busy === g.name}>
              Sign out
            </Button>,
          ),
        )}
      </ul>
      {(groups.size > 1 || error) && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          {error ? <p className="text-[13px] text-danger">{error}</p> : <span />}
          {groups.size > 1 && (
            <Button size="sm" variant="danger" onClick={() => void signOut("others", "others")} loading={busy === "others"}>
              Sign out everywhere else
            </Button>
          )}
        </div>
      )}
      {others === 0 && !error && <p className="border-t border-line px-5 py-3 text-[13px] text-ink-3">No other devices.</p>}
    </Card>
  );
}

/** The signed-in reviewer's own page: what they decided, their account, and where they're signed in. */
export function ProfilePage() {
  const { user } = useRequireReviewer();
  const [tab, setTab] = useTab(TABS, "activity");
  if (!user) return <Page><Skeleton className="h-96" /></Page>;

  return (
    <Page>
      <div className="mx-auto max-w-[880px]">
        <header className="mb-6 flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-full bg-accent text-[22px] font-semibold text-white" aria-hidden>
            {initials(user.display_name) || "?"}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-semibold tracking-tight">{user.display_name}</h1>
            <p className="truncate text-[13.5px] text-ink-3">
              {user.email} · <span className="capitalize">{user.role}</span>
              {user.created_at && <> · since {formatDate(user.created_at)}</>}
            </p>
          </div>
        </header>

        <Tabs
          label="Profile"
          value={tab}
          onChange={setTab}
          items={[
            { id: "activity", label: "Activity" },
            { id: "account", label: "Account" },
            { id: "devices", label: "Devices" },
          ]}
        />
        <TabPanel id="activity" value={tab}>
          <Activity />
        </TabPanel>
        <TabPanel id="account" value={tab} className="space-y-6">
          <NameForm />
          <PasswordForm />
        </TabPanel>
        <TabPanel id="devices" value={tab}>
          <Devices />
        </TabPanel>
      </div>
    </Page>
  );
}
