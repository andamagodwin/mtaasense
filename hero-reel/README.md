# Hero reel

The looping newsreel behind the home-page hero: about 40 seconds of floods, washed-out roads, drought and
landslides, cut with [Remotion](https://www.remotion.dev). Every clip is openly licensed footage from
Wikimedia Commons, mostly African (Mbale, Douala, Bangui, Chad, Zambia, Somalia) with a few global news
shots. Credits are in [`ATTRIBUTION.md`](ATTRIBUTION.md).

The site shows the rendered files in `frontend/public/hero/` and labels each shot with its place, date and
source while it plays. That data comes from `frontend/src/components/hero/reel-timeline.json`.

## Rebuilding

Needs Node 22.18 or newer (the scripts are TypeScript run directly by Node).

```sh
pnpm install
pnpm clips     # download each shot's source window from Commons (≈150 MB, git-ignored)
pnpm studio    # optional: preview and scrub the edit in Remotion Studio
pnpm render    # render the master, then write the web files and caption timeline into frontend/
```

`pnpm render` starts a headless Chrome, so it needs to run outside restrictive sandboxes. If it fails with
`Target closed`, Remotion's bundled Chrome is crashing on your OS (it does on macOS 26.3). Render with an
installed Chrome instead:

```sh
REMOTION_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm render
```

It writes:

| File | What |
|---|---|
| `frontend/public/hero/reel.webm` | 720p VP9, silent. Browsers that support WebM pick this first |
| `frontend/public/hero/reel.mp4` | 720p H.264, silent, fast-start. Safari and older browsers use this |
| `frontend/public/hero/poster.jpg` | Shown while loading, and the only image for reduced-motion and data-saver visitors |
| `frontend/src/components/hero/reel-timeline.json` | When each shot is on screen, with its caption and credit |

## Editing the cut

Everything lives in [`src/shotlist.ts`](src/shotlist.ts):

- **`clips`**: the Commons source, place, event, date, author and licence for each clip. `pnpm clips`
  refuses to download a clip whose licence on Commons does not match the one declared here.
- **`shots`**: the edit, in order. Each shot sets a source in-point (`at`), a length, a slow push-in
  (`zoom`), a `transform-origin` (`origin`) and how it hands over to the next shot (`cut`, `dissolve` or
  `push`). The last shot always hard-cuts back to the first, so the loop point looks like any other cut.

When choosing in-points:

- **Avoid the source's own edits.** Many clips are already edited news packages. Find their cuts with
  `ffmpeg -i clip -vf "select='gt(scene,0.22)',showinfo" -f null -`, then keep each shot inside a single
  take.
- **Crop broadcaster logos with framing.** Anchor the zoom away from the corner with the logo:
  - VOA puts its bug bottom-right on the Zambia report and top-right elsewhere.
  - Somalia carries an "a54" bug.
- **Re-fetch after changing an in-point or length.** Source files are named by their window, so
  `pnpm clips` downloads the new window and deletes the old one.

Colour grade, vignette and light leaks are in [`src/effects.tsx`](src/effects.tsx). Film grain is added by
the site as a CSS overlay instead: noise baked into the video would make the file several times bigger.

## Licensing

- **Footage**: Voice of America material is a U.S. Government work and in the public domain. The other
  clips are CC0 or CC BY-SA 4.0. Because of the ShareAlike clips, the rendered reel is licensed CC BY-SA
  4.0.
- **Remotion**: free for individuals and for companies with up to three employees; larger teams need a
  [company licence](https://www.remotion.pro/license).
