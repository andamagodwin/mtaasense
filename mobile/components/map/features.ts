import { CATEGORY_HEX } from '@/lib/format';
import type { HazardCategory, MapFeatures } from '@/lib/types';
import { colors } from '@/theme/tokens';

export interface HazardProperties {
  id: string;
  kind: 'incident' | 'report';
  category: HazardCategory | null;
  color: string;
}

/** Confirmed incidents and unreviewed reports as one GeoJSON layer; paint reads `kind` and `color`. */
export function hazardsGeoJSON(
  features: MapFeatures,
  include: (category: HazardCategory | null) => boolean = () => true
): GeoJSON.FeatureCollection<GeoJSON.Point, HazardProperties> {
  const point = (lat: number, lon: number): GeoJSON.Point => ({
    type: 'Point',
    coordinates: [lon, lat],
  });
  const color = (c: HazardCategory | null) => (c ? CATEGORY_HEX[c] : colors.ink[3]);
  return {
    type: 'FeatureCollection',
    features: [
      ...features.reports
        .filter((r) => include(r.hazard_category))
        .map((r) => ({
          type: 'Feature' as const,
          id: r.id,
          geometry: point(r.location.lat, r.location.lon),
          properties: {
            id: r.id,
            kind: 'report' as const,
            category: r.hazard_category,
            color: color(r.hazard_category),
          },
        })),
      ...features.incidents
        .filter((i) => i.location && include(i.hazard_category))
        .map((i) => ({
          type: 'Feature' as const,
          id: i.id,
          geometry: point(i.location!.lat, i.location!.lon),
          properties: {
            id: i.id,
            kind: 'incident' as const,
            category: i.hazard_category,
            color: color(i.hazard_category),
          },
        })),
    ],
  };
}
