"use client";

import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";

// OpenFreeMap: free, keyless vector tiles built from OpenStreetMap data (attribution is in the style).
export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";
export const KAMPALA: [number, number] = [32.5825, 0.3476]; // [lon, lat]
const WORKER_VERSION = "6.16.0";

let configured = false;

export async function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  const maplibre = await import("maplibre-gl");
  if (!configured) {
    maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${WORKER_VERSION}.mjs`);
    configured = true;
  }
  return maplibre;
}

/**
 * Synchronous on purpose: callers await loadMapLibre(), check their effect wasn't cancelled, then
 * construct. Creating a map after cleanup and removing it later would strip classes from a container
 * that a newer map instance is already using (React runs effects twice in development).
 */
export function createMap(
  maplibre: typeof import("maplibre-gl"),
  container: HTMLElement,
  options: Partial<MapOptions> = {},
): MapLibreMap {
  const map = new maplibre.Map({
    container,
    style: MAP_STYLE_URL,
    center: KAMPALA,
    zoom: 11.5,
    attributionControl: { compact: true },
    maxBounds: [
      [28.5, -2.5],
      [36.2, 5.2],
    ],
    ...options,
  });
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
  return map;
}
