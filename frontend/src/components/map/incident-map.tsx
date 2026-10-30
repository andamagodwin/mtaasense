"use client";

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_HEX } from "@/lib/format";
import type { MapFeatures } from "@/lib/types";
import { Callout } from "../ui/feedback";
import { createMap, loadMapLibre } from "./maplibre";

export type Selection = { kind: "incident" | "report"; id: string } | null;

const NEUTRAL = "#878174";

function toGeoJSON(features: MapFeatures, selection: Selection): {
  incidents: GeoJSON.FeatureCollection;
  reports: GeoJSON.FeatureCollection;
} {
  return {
    incidents: {
      type: "FeatureCollection",
      features: features.incidents
        .filter((i) => i.location)
        .map((i) => ({
          type: "Feature",
          id: i.id,
          geometry: { type: "Point", coordinates: [i.location!.lon, i.location!.lat] },
          properties: {
            id: i.id,
            color: CATEGORY_HEX[i.hazard_category],
            resolved: i.status === "resolved",
            count: i.report_count,
            selected: selection?.kind === "incident" && selection.id === i.id,
          },
        })),
    },
    reports: {
      type: "FeatureCollection",
      features: features.reports.map((r) => ({
        type: "Feature",
        id: r.id,
        geometry: { type: "Point", coordinates: [r.location.lon, r.location.lat] },
        properties: {
          id: r.id,
          color: r.hazard_category ? CATEGORY_HEX[r.hazard_category] : NEUTRAL,
          selected: selection?.kind === "report" && selection.id === r.id,
        },
      })),
    },
  };
}

export function IncidentMap({
  features,
  selection,
  onSelect,
  className,
}: {
  features: MapFeatures | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      let maplibre: typeof import("maplibre-gl");
      try {
        maplibre = await loadMapLibre();
      } catch {
        setFailed(true);
        return;
      }
      if (cancelled || !container.current) return;
      try {
        map = createMap(maplibre, container.current);
      } catch {
        setFailed(true);
        return;
      }
      mapRef.current = map;
      map.on("error", () => undefined);
      map.on("load", () => {
        if (!map) return;
        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        map.addSource("incidents", { type: "geojson", data: empty });
        map.addSource("reports", { type: "geojson", data: empty });
        map.addLayer({
          id: "selection-halo",
          type: "circle",
          source: "incidents",
          filter: ["==", ["get", "selected"], true],
          paint: { "circle-radius": 22, "circle-color": ["get", "color"], "circle-opacity": 0.18 },
        });
        map.addLayer({
          id: "report-halo",
          type: "circle",
          source: "reports",
          filter: ["==", ["get", "selected"], true],
          paint: { "circle-radius": 18, "circle-color": ["get", "color"], "circle-opacity": 0.18 },
        });
        map.addLayer({
          id: "reports",
          type: "circle",
          source: "reports",
          paint: {
            "circle-radius": 6.5,
            "circle-color": "#ffffff",
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2.5,
          },
        });
        map.addLayer({
          id: "incidents",
          type: "circle",
          source: "incidents",
          paint: {
            "circle-radius": ["+", 7, ["*", 1.6, ["min", ["get", "count"], 6]]],
            "circle-color": ["get", "color"],
            "circle-opacity": ["case", ["get", "resolved"], 0.45, 0.95],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        for (const layer of ["incidents", "reports"] as const) {
          map.on("click", layer, (e) => {
            const id = e.features?.[0]?.properties?.id as string | undefined;
            if (id) onSelectRef.current({ kind: layer === "incidents" ? "incident" : "report", id });
          });
          map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current = null;
      setReady(false);
      fitted.current = false;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !features) return;
    const data = toGeoJSON(features, selection);
    (map.getSource("incidents") as GeoJSONSource | undefined)?.setData(data.incidents);
    (map.getSource("reports") as GeoJSONSource | undefined)?.setData(data.reports);
    const coords = [...data.incidents.features, ...data.reports.features].map(
      (f) => (f.geometry as GeoJSON.Point).coordinates as [number, number],
    );
    if (!fitted.current && coords.length > 0) {
      fitted.current = true;
      void loadMapLibre().then((maplibre) => {
        const bounds = coords.reduce((b, c) => b.extend(c), new maplibre.LngLatBounds(coords[0], coords[0]));
        map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
      });
    }
  }, [ready, features, selection]);

  // Pan to a selection made from the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !features || !selection) return;
    const loc =
      selection.kind === "incident"
        ? features.incidents.find((i) => i.id === selection.id)?.location
        : features.reports.find((r) => r.id === selection.id)?.location;
    if (loc) map.easeTo({ center: [loc.lon, loc.lat], zoom: Math.max(map.getZoom(), 14), duration: 450 });
  }, [ready, features, selection]);

  if (failed) {
    return (
      <div className={className}>
        <Callout tone="warn" title="The map couldn't load">
          WebGL may be unavailable in this browser. Every incident is still listed alongside.
        </Callout>
      </div>
    );
  }

  return <div ref={container} className={className} role="region" aria-label="Incident map" />;
}
