import { clsx } from "clsx";

/** A count in a circle. Every circle of a size is identical, whatever the number; over 99 shows 99+. */
export function CountCircle({
  value,
  size = "md",
  tone = "accent",
  className,
}: {
  value: number;
  size?: "sm" | "md";
  tone?: "accent" | "neutral" | "dark";
  className?: string;
}) {
  const big = value > 99;
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full font-mono font-medium leading-none tabular-nums",
        size === "sm" ? "size-[18px]" : "size-[22px]",
        size === "sm" ? (big ? "text-[7.5px]" : "text-[9.5px]") : big ? "text-[9px]" : "text-[11px]",
        tone === "accent" && "bg-accent text-white",
        tone === "neutral" && "bg-sunken text-ink-2",
        tone === "dark" && "bg-paper/10 text-paper/70",
        className,
      )}
    >
      {big ? "99+" : value}
    </span>
  );
}
