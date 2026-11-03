import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
} from '@maplibre/maplibre-react-native';
import { MapPin } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';

import { KAMPALA, MAP_STYLE_URL } from '@/lib/config';
import type { LatLon, MapFeatures } from '@/lib/types';
import { colors } from '@/theme/tokens';

import { hazardsGeoJSON } from './features';

const UGANDA_VIEW: [number, number, number, number] = [28.5, -2.5, 36.2, 5.2];

/**
 * Tap to drop the pin at the hazard. `recenter` flies to the value when it comes from the device, not from a
 * tap. `onTouchingChange` lets a parent ScrollView stop scrolling while a finger is on the map.
 */
export function LocationPicker({
  value,
  recenter,
  onChange,
  context,
  onTouchingChange,
  className,
}: {
  value: LatLon | null;
  recenter: boolean;
  onChange: (value: LatLon) => void;
  context: MapFeatures | null;
  onTouchingChange?: (touching: boolean) => void;
  className?: string;
}) {
  const camera = useRef<CameraRef>(null);
  const known = useMemo(() => (context ? hazardsGeoJSON(context) : null), [context]);

  useEffect(() => {
    if (value && recenter)
      camera.current?.flyTo({ center: [value.lon, value.lat], zoom: 16.5, duration: 900 });
  }, [value, recenter]);

  return (
    <View
      className={className}
      onTouchStart={() => onTouchingChange?.(true)}
      onTouchEnd={() => onTouchingChange?.(false)}
      onTouchCancel={() => onTouchingChange?.(false)}>
      <Map
        style={{ flex: 1 }}
        mapStyle={MAP_STYLE_URL}
        tintColor={colors.accent.DEFAULT}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        attributionPosition={{ bottom: 6, right: 6 }}
        onPress={(e) => {
          const [lon, lat] = e.nativeEvent.lngLat;
          onChange({ lat, lon });
        }}>
        <Camera
          ref={camera}
          initialViewState={{
            center: value ? [value.lon, value.lat] : KAMPALA,
            zoom: value ? 16.5 : 11.5,
          }}
          maxBounds={UGANDA_VIEW}
        />
        {known && (
          <GeoJSONSource id="known-hazards" data={known}>
            <Layer
              id="known-hazard-dots"
              type="circle"
              paint={{
                'circle-radius': 4.5,
                'circle-color': ['get', 'color'],
                'circle-opacity': 0.4,
                'circle-stroke-width': 1,
                'circle-stroke-color': colors.surface,
              }}
            />
          </GeoJSONSource>
        )}
        {value && (
          <Marker lngLat={[value.lon, value.lat]} anchor="bottom">
            <MapPin
              size={40}
              color={colors.surface}
              fill={colors.highlight.DEFAULT}
              strokeWidth={1.5}
            />
          </Marker>
        )}
      </Map>
    </View>
  );
}
