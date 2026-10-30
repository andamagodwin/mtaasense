"use client";

import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_HEX } from "@/lib/format";
import type { LatLon, MapFeatures } from "@/lib/types";
import { createMap, loadMapLibre } from "./maplibre";

/**
 * Tap the map (or drag the pin) to set a location. Never sets a location on its own.
 * Existing public reports/incidents are drawn faintly so residents can see if a hazard is already known.
 */
export function LocationPicker({
  value,
  onChange,
  context,
  className,
}: {
  value: LatLon | null;
  onChange: (value: LatLon) => void;
  context?: MapFeatures | null;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !container.current) return;
      map = createMap(maplibre, container.current, { zoom: 12 });
      mapRef.current = map;
      map.on("click", (e) => onChangeRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
      map.on("load", () => {
        map?.addSource("context", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map?.addLayer({
          id: "context",
          type: "circle",
          source: "context",
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "color"],
            "circle-opacity": ["case", ["get", "incident"], 0.55, 0.0],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.55,
          },
        });
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      markerRef.current = null;
      mapRef.current = null;
      setReady(false);
      map?.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !context) return;
    const points: GeoJSON.Feature[] = [
      ...context.incidents
        .filter((i) => i.location && i.status !== "resolved")
        .map((i) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [i.location!.lon, i.location!.lat] },
          properties: { color: CATEGORY_HEX[i.hazard_category], incident: true },
        })),
      ...context.reports.map((r) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [r.location.lon, r.location.lat] },
        properties: { color: r.hazard_category ? CATEGORY_HEX[r.hazard_category] : "#878174", incident: false },
      })),
    ];
    (map.getSource("context") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: points });
  }, [ready, context]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    void loadMapLibre().then((maplibre) => {
      if (!markerRef.current) {
        const marker = new maplibre.Marker({ color: "#2f6b4f", draggable: true });
        marker.on("dragend", () => {
          const p = marker.getLngLat();
          onChangeRef.current({ lat: p.lat, lon: p.lng });
        });
        markerRef.current = marker;
      }
      markerRef.current.setLngLat([value.lon, value.lat]).addTo(map);
      if (!map.getBounds().contains([value.lon, value.lat])) {
        map.easeTo({ center: [value.lon, value.lat], zoom: Math.max(map.getZoom(), 15) });
      }
    });
  }, [ready, value]);

  return <div ref={container} className={className} role="application" aria-label="Choose the hazard location on the map" />;
}
