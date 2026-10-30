import { clsx } from "clsx";
import { ImageOff } from "lucide-react";
import type { MediaRef } from "@/lib/types";

export function Thumb({ media, className }: { media: MediaRef | null; className?: string }) {
  if (!media) {
    return (
      <span className={clsx("grid shrink-0 place-items-center rounded-lg bg-sunken text-ink-3", className)}>
        <ImageOff className="size-4" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- private, signed evidence URLs bypass the optimizer
    <img src={media.url} alt="" loading="lazy" className={clsx("shrink-0 rounded-lg bg-sunken object-cover", className)} />
  );
}
