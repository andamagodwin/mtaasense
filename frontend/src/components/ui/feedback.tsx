import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-sunken", className)} aria-hidden />;
}

type Tone = "info" | "warn" | "danger" | "success" | "neutral";

const toneStyles: Record<Tone, string> = {
  info: "border-[#cfdcec] bg-info-soft text-[#24456e]",
  warn: "border-[#efdcb6] bg-warn-soft text-[#6f4708]",
  danger: "border-[#ebc9c0] bg-danger-soft text-[#7a2b1d]",
  success: "border-[#c9dccf] bg-accent-soft text-accent-ink",
  neutral: "border-line bg-sunken text-ink-2",
};

const toneIcon: Record<Tone, ReactNode> = {
  info: <Info className="size-4 shrink-0" />,
  warn: <AlertTriangle className="size-4 shrink-0" />,
  danger: <XCircle className="size-4 shrink-0" />,
  success: <CheckCircle2 className="size-4 shrink-0" />,
  neutral: <Info className="size-4 shrink-0" />,
};

export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx("flex gap-3 rounded-xl border px-3.5 py-3 text-sm", toneStyles[tone], className)}
    >
      <div className="pt-0.5">{toneIcon[tone]}</div>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5", "leading-relaxed opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-sunken text-ink-3">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div
      className={clsx("h-1.5 overflow-hidden rounded-full bg-sunken", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${value * 100}%` }} />
    </div>
  );
}
