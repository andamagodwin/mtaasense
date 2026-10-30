/**
 * Render the reel and publish it to the frontend.
 *
 *     pnpm render
 *
 * 1. Writes the caption timeline the site uses to label each shot as it plays.
 * 2. Renders a full-quality 1080p master with Remotion (out/master.mp4).
 * 3. Encodes the web versions — 720p VP9 WebM and H.264 MP4, silent, each about 1 Mbps — plus a JPEG
 *    poster into frontend/public/hero/, using Remotion's bundled ffmpeg.
 *
 * `pnpm encode` (--encode-only) skips step 2 and re-encodes the existing master, for tuning file sizes.
 *
 * Run `pnpm clips` first. Rendering starts a headless Chrome, so it will not run inside a restrictive sandbox.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clips, durationInFrames, fps, handoverAfter, handoverFrames, posterShot, timeline } from "../src/shotlist.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const remotion = `${root}node_modules/.bin/remotion`;
const site = fileURLToPath(new URL("../../frontend/", import.meta.url));
const publicDir = `${site}public/hero/`;
const master = `${root}out/master.mp4`;

function run(args: string[]) {
  const result = spawnSync(remotion, args, { stdio: "inherit", cwd: root });
  if (result.status !== 0) throw new Error(`remotion ${args[0]} failed`);
}

const seconds = (frames: number) => Math.round((frames / fps) * 100) / 100;

// Captions switch halfway through each transition.
const entries = timeline();
const captions = entries.map(({ shot, start, end }, i) => {
  const clip = clips[shot.clip];
  const into = i === 0 ? 0 : handoverFrames[handoverAfter(i - 1)] / 2;
  const out = i === entries.length - 1 ? 0 : handoverFrames[handoverAfter(i)] / 2;
  return {
    start: seconds(start + into),
    end: seconds(end - out),
    place: clip.place,
    event: clip.event,
    date: clip.date,
    credit: clip.author,
    license: clip.license,
    source: `https://commons.wikimedia.org/wiki/${encodeURI(clip.title.replaceAll(" ", "_"))}`,
  };
});
mkdirSync(`${site}src/components/hero`, { recursive: true });
writeFileSync(
  `${site}src/components/hero/reel-timeline.json`,
  `${JSON.stringify(
    { duration: seconds(durationInFrames), license: "CC BY-SA 4.0", poster: posterShot, shots: captions },
    null,
    2,
  )}\n`,
);

if (!process.argv.includes("--encode-only")) {
  run(["render", "src/index.ts", "HeroReel", master, "--codec=h264", "--crf=14"]);
}

mkdirSync(publicDir, { recursive: true });
// Water, rain and foliage are expensive to encode, so both versions are rate-capped near 1 Mbps (~5 MB for
// 40 s). The slight softening is hidden behind the hero's gradient and CSS grain.
const web = ["-hide_banner", "-loglevel", "error", "-y", "-i", master, "-an", "-vf", "scale=1280:720:flags=lanczos"];
run([
  "ffmpeg", ...web,
  "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "1000k", "-maxrate", "1400k", "-row-mt", "1",
  "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", `${publicDir}reel.webm`,
]);
run([
  "ffmpeg", ...web,
  "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-maxrate", "1300k", "-bufsize", "2600k",
  "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${publicDir}reel.mp4`,
]);

const poster = entries[posterShot];
run([
  "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
  "-ss", String(seconds((poster.start + poster.end) / 2)), "-i", master,
  "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos", "-q:v", "4", `${publicDir}poster.jpg`,
]);

for (const file of ["reel.webm", "reel.mp4", "poster.jpg"]) {
  console.log(`${file.padEnd(11)} ${(statSync(`${publicDir}${file}`).size / 1024 / 1024).toFixed(2)} MB`);
}
