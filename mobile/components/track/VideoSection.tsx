import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ActivityIndicator, View } from 'react-native';

import { Callout, Card } from '@/components/ui/feedback';
import { Text } from '@/components/ui/Text';
import { mediaUrl } from '@/lib/api';
import { errorLabel } from '@/lib/format';
import type { ReportVideo } from '@/lib/types';
import { colors } from '@/theme/tokens';

/** The report's clip: playable video, tracked stills, and the motion description. */
export function TrackVideo({ video }: { video: ReportVideo }) {
  return (
    <Card className="gap-3 p-4">
      <View className="gap-1">
        <Text className="font-bold text-[16px]">Clip</Text>
        <Text className="text-[13px] text-ink-3">
          {video.concept
            ? `Tracking \u201c${video.concept}\u201d frame by frame.`
            : 'Motion analysis of the attached clip.'}
        </Text>
      </View>
      {video.status === 'failed' ? (
        <Callout tone="warn" title="Clip analysis failed">
          {errorLabel(video.outline_error)}. The photo report is unaffected.
        </Callout>
      ) : video.status !== 'completed' ? (
        <View className="items-center gap-2 py-6">
          <ActivityIndicator color={colors.accent.DEFAULT} />
          <Text className="text-center text-[13.5px] text-ink-2">
            Tracking the hazard frame by frame and describing the motion…
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {video.clip && <ClipPlayer uri={mediaUrl(video.clip)} />}
          {video.stills.length > 0 && (
            <View className="flex-row gap-2">
              {video.stills.map((still) => (
                <View key={still.image.id} className="flex-1 gap-1">
                  <Image
                    source={{ uri: mediaUrl(still.image), cacheKey: still.image.id }}
                    contentFit="cover"
                    accessibilityLabel={`Tracked frame at ${still.time_s.toFixed(1)} seconds`}
                    style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 8 }}
                  />
                  <Text className="text-[11.5px] text-ink-3">
                    {still.time_s.toFixed(1)}s · {still.track_count} tracked
                  </Text>
                </View>
              ))}
            </View>
          )}
          {video.assessment ? (
            <View className="gap-2">
              <Text className="text-[13.5px] leading-5">{video.assessment.summary}</Text>
              <AssessmentRow label="Motion" text={video.assessment.motion} />
              <AssessmentRow label="Spread" text={video.assessment.spread} />
              <AssessmentRow label="Start to end" text={video.assessment.changes_through_clip} />
              <Text className="text-[12.5px] text-ink-3">
                {video.tracked_objects ?? 0} objects tracked · confidence{' '}
                {video.assessment.confidence}
                {video.assessment.hazard_visible ? '' : ' · hazard not visible in the clip'}
              </Text>
            </View>
          ) : (
            <Text className="text-[13.5px] text-ink-3">
              {video.tracked_objects ?? 0} objects tracked. No motion description was produced.
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}

function ClipPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }}
      contentFit="contain"
      nativeControls
      allowsPictureInPicture
    />
  );
}

function AssessmentRow({ label, text }: { label: string; text: string }) {
  return (
    <View className="gap-0.5">
      <Text className="font-semibold text-[13px]">{label}</Text>
      <Text className="text-[13.5px] leading-5 text-ink-2">{text}</Text>
    </View>
  );
}
