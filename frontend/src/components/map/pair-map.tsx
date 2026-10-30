"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LatLon } from "@/lib/types";
import { createMap, loadMapLibre } from "./maplibre";

/** Two labelled points (A = new report, B = candidate) with the line between them. */
export function PairMap({ a, b, className }: { a: LatLon; b: LatLon; className?: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !container.current) return;
      map = createMap(maplibre, container.current, { center: [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2], zoom: 16 });
      const pin = (label: string, color: string) => {
        const el = document.createElement("div");
        el.className = "grid size-7 place-items-center rounded-full border-2 border-white text-[12px] font-semibold text-white shadow-md";
        el.style.background = color;
        el.textContent = label;
        return el;
      };
      map.on("load", () => {
        if (!map) return;
        map.addSource("pair", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } },
        });
        map.addLayer({ id: "pair", type: "line", source: "pair", paint: { "line-color": "#1d1b17", "line-width": 1.5, "line-dasharray": [2, 2] } });
        new maplibre.Marker({ element: pin("A", "#2f6b4f") }).setLngLat([a.lon, a.lat]).addTo(map);
        new maplibre.Marker({ element: pin("B", "#555046") }).setLngLat([b.lon, b.lat]).addTo(map);
        const bounds = new maplibre.LngLatBounds([a.lon, a.lat], [a.lon, a.lat]).extend([b.lon, b.lat]);
        map.fitBounds(bounds, { padding: 70, maxZoom: 18, duration: 0 });
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [a.lat, a.lon, b.lat, b.lon]);

  return <div ref={container} className={className} role="img" aria-label="Map showing both report locations" />;
}
