// MtaaSense colours. This is the one place they are set: the website and the mobile app both read this file.
//
//   mobile      reads it directly (mobile/theme/tokens.js and mobile/app.config.js). Restart Metro with
//               `pnpm start --clear` after a change so NativeWind rebuilds its styles.
//   website     gets frontend/src/app/theme.css, frontend/src/lib/colors.ts and public/icon.svg from
//               `node theme/sync.mjs`, which the frontend's dev, build and deploy scripts run for you.
//   bitmaps     the app icon, splash, favicon.ico and apple-icon.png are redrawn by
//               `uv run --project backend python theme/icons.py`.
//
// Plain CommonJS with no dependencies so Node, Metro and TypeScript can all load it.

/** The brand palette. Every hover, tint, border and text shade of these is mixed from them below. */
const brand = {
  sky: '#0593c6', // primary: buttons, links, focus rings, the active tab, progress, the logo tile
  white: '#fcffff', // the page background and the logo's monogram
  pink: '#d83995', // highlight, used sparingly: the pin you place, segmentation masks, the hero's live dot
};

function mix(hex, target, amount) {
  const channel = (value, i) => parseInt(value.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(hex, i) + (channel(target, i) - channel(hex, i)) * amount))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** A colour with the shades every tone needs: pressed or hovered, a soft fill, a border on that fill and text on it. */
function tone(hex) {
  return {
    DEFAULT: hex,
    hover: mix(hex, '#000000', 0.15),
    soft: mix(hex, '#ffffff', 0.9),
    line: mix(hex, '#ffffff', 0.7),
    ink: mix(hex, '#000000', 0.45),
  };
}

const colors = {
  paper: brand.white,
  surface: '#ffffff',
  sunken: '#eef3f6',
  line: '#dfe7ec',
  'line-strong': '#c7d3da',
  ink: { DEFAULT: '#12232c', 2: '#43535c', 3: '#66767f' },

  accent: tone(brand.sky),
  highlight: tone(brand.pink),

  // Status. Information shares the brand blue; success, warning and danger keep their conventional hues.
  info: tone(brand.sky),
  success: tone('#23865a'),
  warn: tone('#a86b12'),
  danger: tone('#a8402e'),

  // Hazard categories, used consistently on badges, map markers and overlays.
  cat: { pothole: '#b4562f', road: '#8a6a3c', drain: '#2b6f78', flood: '#3b5fa3' },
  // Segmentation outlines over photos: brighter than the categories so they read on any image.
  mask: { pothole: '#d9622b', road: '#c58a2a', drain: '#1f9aa8', water: '#3d74e0', puddle: '#5b8def' },
  // Behind photos, video and the camera.
  photo: '#0b1418',
};

module.exports = { brand, colors };
