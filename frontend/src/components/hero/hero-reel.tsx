"use client";

import { type ReactNode, useEffect, useRef } from "react";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * Full-bleed newsreel behind the home-page hero: a looping montage of openly licensed flood, storm, drought
 * and landslide footage (cut in /hero-reel with Remotion; credits are linked below the hero). The footage is
 * decorative (the hero copy carries the meaning), so the video is hidden from assistive tech and stays on its
 * poster for reduced-motion and data-saver users.
 */
export function HeroReel({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Autoplay only when motion is welcome, and only while the hero is on screen.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.2 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="relative isolate overflow-hidden bg-photo text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 -z-20 size-full object-cover"
        poster="/hero/poster.jpg"
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
        tabIndex={-1}
      >
        <source src="/hero/reel.webm" type="video/webm" />
        <source src="/hero/reel.mp4" type="video/mp4" />
      </video>
      {/* Darken toward the copy so text stays legible over any frame. */}
      <div aria-hidden className="hero-scrim absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1/2 -z-10 animate-grain opacity-[0.13] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />

      <div className="mx-auto flex min-h-[min(calc(100svh-3.5rem),820px)] max-w-[1280px] flex-col justify-center px-4 py-14 sm:px-6 sm:py-20">
        {children}
      </div>
    </section>
  );
}
