import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryDot } from '@/components/badges';
import { hazardsGeoJSON, type HazardProperties } from '@/components/map/features';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { KAMPALA, MAP_STYLE_URL } from '@/lib/config';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  REPORT_STATUS_LABEL,
  SEVERITY_LABEL,
  timeAgo,
} from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { HazardCategory, MapFeatures } from '@/lib/types';
import { colors } from '@/theme/tokens';

export default function MapScreen() {
  const features = useApi((signal) => api.mapFeatures(signal), 'map-features');
  const [filter, setFilter] = useState<HazardCategory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = useMemo(
    () => (features.data ? hazardsGeoJSON(features.data, (c) => !filter || c === filter) : null),
    [features.data, filter]
  );
  const total = data?.features.length ?? 0;

  return (
    <View className="flex-1 bg-paper">
      <Map
        style={{ flex: 1 }}
        mapStyle={MAP_STYLE_URL}
        tintColor={colors.accent.DEFAULT}
        logo={false}
        compass={false}
        touchPitch={false}
        attributionPosition={{ bottom: 8, right: 8 }}>
        <Camera
          initialViewState={{ center: KAMPALA, zoom: 11.5 }}
          maxBounds={[28.5, -2.5, 36.2, 5.2]}
        />
        {data && (
          <GeoJSONSource
            id="hazards"
            data={data}
            hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}
            onPress={(e) => {
              const props = e.nativeEvent.features[0]?.properties as HazardProperties | undefined;
              if (props) setSelectedId(props.id);
            }}>
            <Layer
              id="hazard-selected"
              type="circle"
              filter={['==', ['get', 'id'], selectedId ?? '']}
              paint={{
                'circle-radius': 16,
                'circle-color': ['get', 'color'],
                'circle-opacity': 0.22,
              }}
            />
            <Layer
              id="hazard-dots"
              type="circle"
              paint={{
                'circle-radius': ['case', ['==', ['get', 'kind'], 'incident'], 8, 5.5],
                'circle-color': ['get', 'color'],
                'circle-opacity': ['case', ['==', ['get', 'kind'], 'incident'], 1, 0.7],
                'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'incident'], 2.5, 1.5],
                'circle-stroke-color': colors.surface,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      <SafeAreaView edges={['top']} pointerEvents="box-none" className="absolute inset-x-0 top-0">
        <View className="mx-4 mt-4 flex-row items-center justify-between rounded-[14px] border border-line bg-surface/95 px-4 py-3">
          <View className="gap-0.5">
            <Text className="font-bold text-[17px]">Hazard map</Text>
            <Text className="text-[12.5px] text-ink-3">
              {features.data
                ? `${total} on the map · large dots are confirmed incidents`
                : features.error
                  ? features.error.message
                  : 'Loading hazards…'}
            </Text>
          </View>
          {features.loading && <ActivityIndicator size="small" color={colors.accent.DEFAULT} />}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-4 py-3">
          <FilterChip label="All" selected={!filter} onPress={() => setFilter(null)} />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              label={CATEGORY_LABEL[c]}
              category={c}
              selected={filter === c}
              onPress={() => setFilter(filter === c ? null : c)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>

      {selectedId && features.data && (
        <SelectedCard
          features={features.data}
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </View>
  );
}

function FilterChip({
  label,
  category,
  selected,
  onPress,
}: {
  label: string;
  category?: HazardCategory;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'h-9 flex-row items-center gap-1.5 rounded-full border px-3.5',
        selected ? 'border-ink bg-ink' : 'border-line-strong bg-surface active:bg-sunken'
      )}>
      {category && <CategoryDot category={category} />}
      <Text className={cn('font-semibold text-[13px]', selected && 'text-white')}>{label}</Text>
    </Pressable>
  );
}

function SelectedCard({
  features,
  id,
  onClose,
}: {
  features: MapFeatures;
  id: string;
  onClose: () => void;
}) {
  const incident = features.incidents.find((i) => i.id === id);
  const report = incident ? undefined : features.reports.find((r) => r.id === id);
  if (!incident && !report) return null;
  const category = incident?.hazard_category ?? report?.hazard_category ?? null;
  return (
    <View className="absolute inset-x-4 bottom-4 gap-2 rounded-[14px] border border-line bg-surface p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-1.5">
            <CategoryDot category={category} />
            <Text className="font-semibold text-[12.5px] text-ink-2">
              {category ? CATEGORY_LABEL[category] : 'Uncategorised'}
            </Text>
          </View>
          <Text className="font-bold text-[16px]">
            {incident ? incident.title : 'Reported, awaiting review'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={onClose}>
          <X size={18} color={colors.ink[3]} />
        </Pressable>
      </View>
      <Text className="text-[13px] text-ink-2">
        {incident
          ? `${incident.status === 'resolved' ? 'Resolved' : 'Confirmed incident'} · ${SEVERITY_LABEL[incident.severity]} severity · ${incident.report_count} report${incident.report_count === 1 ? '' : 's'}`
          : REPORT_STATUS_LABEL[report!.status]}
      </Text>
      <Text className="font-mono text-[12px] text-ink-3">
        {incident ? incident.reference : report!.reference} ·{' '}
        {timeAgo(incident ? incident.updated_at : report!.created_at)}
      </Text>
    </View>
  );
}
