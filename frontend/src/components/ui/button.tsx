import { clsx } from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Spinner } from "./feedback";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle" | "glass";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-[background,color,border,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-55 select-none";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)] hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  subtle: "bg-accent-soft text-accent-ink hover:bg-[#d8e6dd]",
  danger: "border border-[#e7c6bd] bg-surface text-danger hover:bg-danger-soft",
  /** For use over imagery or video. */
  glass: "border border-white/25 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function LinkButton({ variant = "primary", size = "md", icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={clsx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
