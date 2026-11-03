import type { LngLat } from '@maplibre/maplibre-react-native';

// Point a development build at a local backend with EXPO_PUBLIC_API_ORIGIN=http://<your-lan-ip>:8000.
export const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_ORIGIN ?? 'https://api.mtaasense.com'
).replace(/\/$/, '');
export const API_BASE = `${API_ORIGIN}/api/v1`;

// Public tracking pages live on the web app; the receipt token goes in the fragment so it never reaches a server.
export const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://mtaasense.com';

// OpenFreeMap: free, keyless vector tiles built from OpenStreetMap data, the same style as the web map.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const KAMPALA: LngLat = [32.5825, 0.3476];
export const UGANDA_BOUNDS = { minLat: -1.6, maxLat: 4.4, minLon: 29.4, maxLon: 35.2 };
