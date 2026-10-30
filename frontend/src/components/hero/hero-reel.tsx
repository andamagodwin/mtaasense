"use client";

import { Pause, Play } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import reel from "./reel-timeline.json";

const { shots, duration } = reel;
const FPS = 30;
const CREDITS_URL = "https://github.com/andamagodwin/mtaasense/blob/main/hero-reel/ATTRIBUTION.md";
const POSTER_TIME = (shots[reel.poster].start + shots[reel.poster].end) / 2;
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** HH:MM:SS:FF, the way an edit suite shows it. */
function timecode(seconds: number) {
  const frames = Math.floor(seconds * FPS);
  const s = Math.floor(frames / FPS);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, frames % FPS]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function shotAt(seconds: number) {
  const i = shots.findIndex((shot) => seconds < shot.end);
  return i === -1 ? shots.length - 1 : i;
}

/**
 * Full-bleed newsreel behind the home-page hero: a looping montage of openly licensed flood, storm, drought
 * and landslide footage (cut in /hero-reel with Remotion), with a lower third naming each shot's place, date
 * and source as it plays. The footage is decorative — the hero copy carries the meaning — so the video is
 * hidden from assistive tech, stays paused for reduced-motion and data-saver users, and can always be paused.
 */
export function HeroReel({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const pausedByUser = useRef(false);
  const [index, setIndex] = useState(reel.poster);
  const [playing, setPlaying] = useState(false);

  // Autoplay only when motion is welcome, and only while the hero is on screen.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !pausedByUser.current) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.2 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  // Keep the lower third in step with the picture.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing) return;
    let frame = 0;
    const tick = () => {
      const t = video.currentTime;
      setIndex(shotAt(t));
      if (timecodeRef.current) timecodeRef.current.textContent = timecode(t);
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${Math.min(1, t / duration)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    pausedByUser.current = !video.paused;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const shot = shots[index];

  return (
    <section className="relative isolate overflow-hidden bg-[#0b0d0c] text-white">
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
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src="/hero/reel.webm" type="video/webm" />
        <source src="/hero/reel.mp4" type="video/mp4" />
      </video>
      {/* Darken toward the copy and the lower third so text stays legible over any frame. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgb(8_10_9/0.85)_0%,transparent_40%),linear-gradient(90deg,rgb(8_10_9/0.88)_0%,rgb(8_10_9/0.6)_45%,rgb(8_10_9/0.2)_100%)] max-sm:bg-[linear-gradient(0deg,rgb(8_10_9/0.9)_0%,rgb(8_10_9/0.55)_60%,rgb(8_10_9/0.4)_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1/2 -z-10 animate-grain opacity-[0.13] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />

      <div className="mx-auto flex min-h-[min(calc(100svh-3.5rem),820px)] max-w-[1280px] flex-col px-4 sm:px-6">
        <div className="flex flex-1 flex-col justify-center py-14 sm:py-20">{children}</div>

        <div className="pb-5">
          <div className="relative mb-3 h-px bg-white/15" aria-hidden>
            {shots.slice(1).map((s) => (
              <span
                key={s.start}
                className="absolute -top-0.5 h-[5px] w-px bg-white/30"
                style={{ left: `${(s.start / duration) * 100}%` }}
              />
            ))}
            <div
              ref={progressRef}
              className="absolute inset-0 origin-left bg-white/75"
              style={{ transform: `scaleX(${POSTER_TIME / duration})` }}
            />
          </div>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/55 tabular-nums">
                {String(index + 1).padStart(2, "0")}/{shots.length}
                <span className="mx-2 text-white/30">·</span>
                <span ref={timecodeRef}>{timecode(POSTER_TIME)}</span>
              </p>
              <div key={index} className="animate-fade-in">
                <p className="mt-1 truncate text-[14px] font-medium">
                  {shot.place}
                  <span className="font-normal text-white/60">
                    {" "}
                    — {shot.event}, {shot.date}
                  </span>
                </p>
                <a
                  href={shot.source}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block truncate text-[11.5px] text-white/50 hover:text-white"
                >
                  Footage: {shot.credit} · {shot.license}
                </a>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href={CREDITS_URL}
                target="_blank"
                rel="noreferrer"
                className="hidden text-[12px] text-white/55 hover:text-white sm:inline"
              >
                All footage credits
              </a>
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause background video" : "Play background video"}
                className="grid size-9 place-items-center rounded-full border border-white/25 bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
