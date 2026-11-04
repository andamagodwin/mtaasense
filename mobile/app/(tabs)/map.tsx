import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { CloseCircle } from 'iconsax-react-nativejs';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryDot } from '@/components/badges';
import { hazardsGeoJSON, type HazardProperties } from '@/components/map/features';
import { Callout } from '@/components/ui/feedback';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { KAMPALA, MAP_STYLE_URL } from '@/lib/config';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  formatHour,
  REPORT_STATUS_LABEL,
  SEVERITY_LABEL,
  timeAgo,
} from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { HazardCategory, IncidentSummary, MapFeatures } from '@/lib/types';
import { colors } from '@/theme/tokens';

export default function MapScreen() {
  const features = useApi((signal) => api.mapFeatures(signal), 'map-features');
  const rain = useApi((signal) => api.rain(signal), 'rain');
  const [filter, setFilter] = useState<HazardCategory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = useMemo(
    () => (features.data ? hazardsGeoJSON(features.data, (c) => !filter || c === filter) : null),
    [features.data, filter]
  );
  const total = data?.features.length ?? 0;
  // Open blocked drains, longest waiting first: the "clear before tonight's rain" list.
  const drains = useMemo(
    () =>
      (features.data?.incidents ?? [])
        .filter((i) => i.hazard_category === 'blocked_drainage' && i.status === 'confirmed')
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [features.data]
  );
  const warning = rain.data?.active ? rain.data : null;

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
        {warning && (
          <View className="mx-4">
            <Callout tone="warn" title="Heavy rain expected">
              {warning.expected_mm_24h} mm in the next 24 hours
              {warning.peak_hour && `, heaviest around ${formatHour(warning.peak_hour)}`}.{' '}
              {features.data
                ? drains.length > 0
                  ? `${drains.length} open blocked drain${drains.length === 1 ? '' : 's'} below.`
                  : 'No open blocked drains right now.'
                : 'Checking open drains…'}
            </Callout>
          </View>
        )}
      </SafeAreaView>

      {selectedId && features.data && (
        <SelectedCard
          features={features.data}
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
      {warning && !selectedId && drains.length > 0 && (
        <ClearList drains={drains} onPick={setSelectedId} />
      )}
    </View>
  );
}

function ClearList({
  drains,
  onPick,
}: {
  drains: IncidentSummary[];
  onPick: (id: string) => void;
}) {
  return (
    <View className="absolute inset-x-4 bottom-4 max-h-[42%] gap-1 rounded-[14px] border border-line bg-surface p-4">
      <Text className="font-bold text-[15px]">Clear before tonight&apos;s rain</Text>
      <Text className="text-[12.5px] text-ink-3">
        {drains.length} open blocked drain{drains.length === 1 ? '' : 's'}, longest waiting first.
        Tap one to see it.
      </Text>
      <ScrollView showsVerticalScrollIndicator={false} className="mt-1">
        {drains.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            onPress={() => onPick(d.id)}
            className="flex-row items-center gap-2.5 border-t border-line py-2.5 active:bg-sunken">
            <CategoryDot category={d.hazard_category} />
            <View className="flex-1 gap-0.5">
              <Text className="font-semibold text-[14px]" numberOfLines={1}>
                {d.title}
              </Text>
              <Text className="font-mono text-[12px] text-ink-3">
                {d.reference} · {d.report_count} report{d.report_count === 1 ? '' : 's'} ·{' '}
                {timeAgo(d.created_at)}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
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
          <CloseCircle size={18} color={colors.ink[3]} />
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
