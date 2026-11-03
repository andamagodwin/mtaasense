import { clsx } from "clsx";
import { ArrowLeft } from "iconsax-reactjs";
import Link from "next/link";
import type { ReactNode } from "react";

const WIDTH = { wide: "max-w-[1280px]", narrow: "max-w-xl" } as const;

/**
 * Every page sits in the same container: a 16px gutter on phones, 24px from `sm`, and the same vertical
 * rhythm (page padding 32/40px, 32px under the header, 24px between sections, 20px inside cards).
 */
export function Page({
  width = "wide",
  className,
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return <div className={clsx("mx-auto w-full px-4 py-8 sm:px-6 sm:py-10", WIDTH[width], className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  back,
  meta,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back.href} className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft className="size-3.5" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {meta && <p className="mb-1 text-[13px] text-ink-3">{meta}</p>}
          <h1 className="flex flex-wrap items-center gap-2.5 text-[26px] font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 max-w-[62ch] text-[14.5px] leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}
