// MapLibre GL v6 locates its web worker relative to its own module URL, which no longer exists
// after bundling. Serve the worker as a static file instead (see src/components/map/maplibre.ts).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = require("maplibre-gl/package.json");
mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(pkgDir, "dist/maplibre-gl-worker.mjs"), `public/vendor/maplibre-gl-worker-${version}.mjs`);
console.log(`copied maplibre-gl-worker ${version}`);
