/**
 * The hero reel, as data: where every clip comes from and how the montage is cut.
 *
 * This file is the single source of truth. The Remotion composition renders it, `scripts/fetch-clips.ts`
 * downloads exactly the source windows it names (and checks each licence against Commons), and
 * `scripts/render.ts` exports its timeline so the site can caption each shot as it plays.
 *
 * Every clip is openly licensed footage on Wikimedia Commons. Voice of America material is a work of the
 * U.S. Government and in the public domain; the rest is CC0, CC BY or CC BY-SA. Because some sources are
 * CC BY-SA 4.0, the rendered reel is distributed under CC BY-SA 4.0 — see ../ATTRIBUTION.md.
 */

export const fps = 30;
export const width = 1920;
export const height = 1080;

/** Seconds of handle fetched on each side of a shot, so in-points can be nudged in the Studio without re-fetching. */
export const handle = 1;

export type Clip = {
  /** Wikimedia Commons file title. */
  title: string;
  place: string;
  event: string;
  date: string;
  author: string;
  /** Must match the Commons `LicenseShortName`; fetch-clips refuses to download on a mismatch. */
  license: "Public domain" | "CC0" | "CC BY 4.0" | "CC BY-SA 4.0";
};

export const clips = {
  "godomey-storm": {
    title: "File:Début d'orage.webm",
    place: "Godomey, Benin",
    event: "Storm front",
    date: "Apr 2023",
    author: "KODJOME Romaric",
    license: "CC BY-SA 4.0",
  },
  "bangui-flood": {
    title: "File:Inondation walingba.webm",
    place: "Bangui, Central African Republic",
    event: "Rain floods a compound",
    date: "Apr 2023",
    author: "Kondotikodro",
    license: "CC BY-SA 4.0",
  },
  "douala-bridge": {
    title: "File:Un pont inondé à Bepanda.webm",
    place: "Bepanda, Douala, Cameroon",
    event: "Flooded bridge",
    date: "Apr 2020",
    author: "Minette Lontsie",
    license: "CC BY-SA 4.0",
  },
  "mbale-floods": {
    title: "File:Mbale Floods 2022.webm",
    place: "Mbale, Uganda",
    event: "Floods",
    date: "Jul 2022",
    author: "Dixon099",
    license: "CC BY-SA 4.0",
  },
  "chad-road": {
    title: "File:Voiture pendant la saison de pluie au Tchad.webm",
    place: "Chad",
    event: "Rainy-season road",
    date: "Mar 2020",
    author: "Abakar B",
    license: "CC BY-SA 4.0",
  },
  "zambia-floods": {
    title: "File:‘Floods Have Left Over 400,000 Homeless’- Zambian Authorities.webm",
    place: "Zambia",
    event: "Worst floods in fifty years",
    date: "Mar 2023",
    author: "VOA Africa",
    license: "Public domain",
  },
  "ian-florida": {
    title: "File:Hurricane Ian Leaves Trail of Destruction in Florida.webm",
    place: "Fort Myers, Florida, USA",
    event: "Hurricane Ian",
    date: "Sep 2022",
    author: "Voice of America",
    license: "Public domain",
  },
  "mangkhut-luzon": {
    title: "File:Ferocious Typhoon Barrels Through Rain-Soaked Philippines.webm",
    place: "Luzon, Philippines",
    event: "Typhoon Mangkhut",
    date: "Sep 2018",
    author: "VOA News",
    license: "Public domain",
  },
  "somalia-drought": {
    title: "File:Somalia Drought.webm",
    place: "Somaliland, Somalia",
    event: "Drought and livestock die-off",
    date: "Feb 2017",
    author: "VOA Africa",
    license: "Public domain",
  },
  "wayanad-landslide": {
    title: "File:Rescue work after Mundakkai devastation.webm",
    place: "Mundakkai, Wayanad, India",
    event: "Landslide",
    date: "Jul 2024",
    author: "Makks2010",
    license: "CC0",
  },
  "itogon-landslide": {
    title: "File:Philippines Landslide.webm",
    place: "Itogon, Philippines",
    event: "Landslide rescue",
    date: "Sep 2018",
    author: "VOA News",
    license: "Public domain",
  },
} satisfies Record<string, Clip>;

export type ClipId = keyof typeof clips;

/** How a shot hands over to the next one. The last shot always hard-cuts back to the first, so the reel loops. */
export type Handover = "cut" | "dissolve" | "push";

export type Shot = {
  clip: ClipId;
  /** Source in-point, seconds. */
  at: number;
  /** On-screen length in seconds, including any transition overlap with the next shot. */
  seconds: number;
  /** Scale at the start and end of the shot — a slow push. Values above ~1.1 also crop broadcaster logos. */
  zoom?: [number, number];
  /** CSS transform-origin for the zoom; anchor away from a logo to crop it out. */
  origin?: string;
  /** Per-shot exposure trim, as a CSS brightness multiplier, to even out mismatched sources. */
  exposure?: number;
  next?: Handover;
};

// In-points sit just after the source's own edits (found with ffmpeg scene detection) so no shot contains a
// cut. Zoom/origin pairs crop the VOA bug (bottom right on Zambia, top right on Ian, Mangkhut and Itogon)
// and the "a54" bug on Somalia.
export const shots: Shot[] = [
  { clip: "godomey-storm", at: 28, seconds: 3, zoom: [1.04, 1.12], next: "cut" },
  { clip: "bangui-flood", at: 12, seconds: 2.6, zoom: [1.02, 1.08], next: "cut" },
  { clip: "douala-bridge", at: 0.5, seconds: 2.8, zoom: [1.04, 1.1], next: "push" },
  { clip: "mbale-floods", at: 76.5, seconds: 2.9, zoom: [1.0, 1.08], next: "dissolve" },
  { clip: "chad-road", at: 0.3, seconds: 3, zoom: [1.04, 1.1], next: "cut" },
  { clip: "zambia-floods", at: 139.6, seconds: 2.6, zoom: [1.2, 1.24], origin: "0% 40%", next: "cut" },
  { clip: "ian-florida", at: 15, seconds: 2.6, zoom: [1.12, 1.16], origin: "20% 90%", next: "push" },
  { clip: "zambia-floods", at: 1, seconds: 3, zoom: [1.2, 1.26], origin: "0% 20%", next: "dissolve" },
  { clip: "mbale-floods", at: 67.4, seconds: 2.9, zoom: [1.02, 1.1], next: "cut" },
  { clip: "mangkhut-luzon", at: 19.5, seconds: 2.8, zoom: [1.12, 1.16], origin: "50% 90%", next: "cut" },
  { clip: "somalia-drought", at: 105.35, seconds: 2.9, zoom: [1.28, 1.32], origin: "35% 0%", exposure: 0.9, next: "dissolve" },
  { clip: "wayanad-landslide", at: 9.5, seconds: 3.2, zoom: [1.02, 1.1], next: "push" },
  { clip: "itogon-landslide", at: 30.15, seconds: 2.6, zoom: [1.12, 1.16], origin: "30% 90%", next: "cut" },
  { clip: "zambia-floods", at: 197.4, seconds: 2.8, zoom: [1.2, 1.24], origin: "0% 30%", next: "cut" },
  { clip: "mbale-floods", at: 46.3, seconds: 2.8, zoom: [1.02, 1.08], next: "cut" },
];

/** The shot whose middle frame becomes the poster — shown while the video loads and to reduced-motion users. */
export const posterShot = 3;

/** Transition lengths in frames; a cut has none. */
export const handoverFrames: Record<Handover, number> = { cut: 0, dissolve: 14, push: 11 };

export const shotFrames = (shot: Shot) => Math.round(shot.seconds * fps);

/** The handover after shot `i`; the last shot cuts back to the first so the loop point is invisible. */
export const handoverAfter = (i: number): Handover => (i === shots.length - 1 ? "cut" : (shots[i].next ?? "cut"));

/** When each shot is on screen, in frames. Overlapping transitions shorten the timeline. */
export function timeline() {
  let start = 0;
  return shots.map((shot, i) => {
    const frames = shotFrames(shot);
    const entry = { shot, start, end: start + frames };
    start += frames - handoverFrames[handoverAfter(i)];
    return entry;
  });
}

export const durationInFrames = timeline().at(-1)!.end;

/** Source file for a shot, named by its window so editing an in-point fetches a fresh one. */
export const clipFile = (shot: Shot) => `clips/${shot.clip}_${shot.at}+${shot.seconds}.mp4`;

/** Seconds of handle before the in-point in a shot's source file (less than `handle` when the shot starts near 0). */
export const leadIn = (shot: Shot) => Math.min(shot.at, handle);
