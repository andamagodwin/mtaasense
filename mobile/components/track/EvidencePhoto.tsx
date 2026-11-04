import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PrivacyBlurredBadge } from '@/components/badges';
import { Text } from '@/components/ui/Text';
import { mediaUrl } from '@/lib/api';
import type { MediaRef, SegmentationRegion, SegmentationView } from '@/lib/types';
import { colors } from '@/theme/tokens';

/** SAM's outlines over a photo laid out with `contentFit="contain"` in the same box. */
export function MaskOverlay({
  regions,
  width,
  height,
}: {
  regions: SegmentationRegion[];
  width: number;
  height: number;
}) {
  return (
    <Svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={StyleSheet.absoluteFill}
      pointerEvents="none">
      {regions.map((r) => {
        // Mask paths use pixel-centre coordinates; boxes are half-open source pixels (as on the web).
        const sx = (r.box.right - r.box.left) / r.mask.width;
        const sy = (r.box.bottom - r.box.top) / r.mask.height;
        return (
          <Path
            key={r.object_id}
            d={r.mask.svg_path}
            transform={`translate(${r.box.left} ${r.box.top}) scale(${sx} ${sy}) translate(0.5 0.5)`}
            fill={colors.highlight.DEFAULT}
            fillOpacity={0.32}
            fillRule="evenodd"
            stroke="#ffffff"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        );
      })}
    </Svg>
  );
}

/** The submitted photo with SAM's hazard outline drawn over it once segmentation has finished. */
export function EvidencePhoto({
  image,
  redacted,
  segmentations,
}: {
  image: MediaRef | null;
  redacted: boolean;
  segmentations: SegmentationView[];
}) {
  const [width, setWidth] = useState(0);
  const active =
    segmentations.find((s) => s.status === 'completed' && (s.regions?.length ?? 0) > 0) ?? null;
  const W = active?.image_width ?? image?.width ?? 4;
  const H = active?.image_height ?? image?.height ?? 3;
  const height = width ? Math.min(width * (H / W), 440) : 0;

  if (!image) {
    return (
      <View className="items-center gap-2 px-4 py-10">
        <ActivityIndicator color={colors.accent.DEFAULT} />
        <Text className="text-center text-[13.5px] text-ink-2">
          Preparing your photo… faces and number plates are blurred before anyone else sees it.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View
        className="bg-photo"
        style={{ height }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {/* Signed URLs change on every fetch; caching by media id stops the photo reloading while we poll. */}
        <Image
          source={{ uri: mediaUrl(image), cacheKey: image.id }}
          contentFit="contain"
          transition={200}
          accessibilityLabel="Your submitted photo"
          style={StyleSheet.absoluteFill}
        />
        {active?.regions && <MaskOverlay regions={active.regions} width={W} height={H} />}
      </View>
      {redacted && (
        <View className="px-4 pt-3">
          <PrivacyBlurredBadge />
        </View>
      )}
      {/* Progress is on the timeline; the caption only names what was outlined. */}
      {active && (
        <Text className="px-4 py-3 text-[12.5px] text-ink-3">
          {`Outlined by SAM 3.1: “${active.prompt}”, ${active.regions!.length} region${active.regions!.length === 1 ? '' : 's'}`}
        </Text>
      )}
    </View>
  );
}
