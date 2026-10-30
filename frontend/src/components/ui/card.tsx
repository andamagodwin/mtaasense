import { clsx } from "clsx";
import type { ComponentProps, ReactNode } from "react";

export function Card({ className, ...rest }: ComponentProps<"section">) {
  return (
    <section
      className={clsx("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  eyebrow,
  description,
  action,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{eyebrow}</p>}
        <h2 className="text-[15px] font-semibold leading-snug text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={clsx("px-4 py-4 sm:px-5", className)} {...rest} />;
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0", className)}>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={clsx("text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3", className)}>{children}</h3>
  );
}
