import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Share as ShareIcon, Trash } from 'iconsax-react-nativejs';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Share, View } from 'react-native';

import { StatusBadge } from '@/components/badges';
import { EvidencePhoto } from '@/components/track/EvidencePhoto';
import { TrackVideo } from '@/components/track/VideoSection';
import { FixCheckCard } from '@/components/track/FixCheckCard';
import { AnalysisCard, ResidentFacts } from '@/components/track/ReportSections';
import { isProcessing, Timeline } from '@/components/track/Timeline';
import { Button } from '@/components/ui/Button';
import { Callout, Card } from '@/components/ui/feedback';
import { SCREEN_CONTENT } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { WEB_ORIGIN } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import { useApi, usePolling } from '@/lib/hooks';
import { receiptToken, removeReceipt, syncReceipt } from '@/lib/receipts';
import { colors } from '@/theme/tokens';

export default function TrackReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // undefined while the Keychain lookup runs; null when this phone has no receipt for the report.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let live = true;
    receiptToken(id).then(
      (t) => live && setToken(t),
      () => live && setToken(null)
    );
    return () => {
      live = false;
    };
  }, [id]);

  const state = useApi((signal) => api.report(id, token!, signal), token ? id : null);
  const report = state.data;
  usePolling(state.reload, 2500, !!report && isProcessing(report));

  useEffect(() => {
    if (report) void syncReceipt(report);
  }, [report]);

  if (token === null) {
    return (
      <View className="flex-1 p-5">
        <Callout tone="warn" title="This report isn’t saved on this phone">
          Only the phone that sent a report holds its receipt. Open the tracking link you shared
          instead.
        </Callout>
      </View>
    );
  }

  if (!report) {
    return (
      <View className="flex-1 items-center justify-center p-5">
        {state.error ? (
          <Callout
            tone={state.error.status === 404 ? 'warn' : 'danger'}
            title={state.error.status === 404 ? 'Report not found' : 'Couldn’t load the report'}>
            {state.error.status === 404
              ? 'The server no longer has this report.'
              : `${state.error.message} Pull down to try again.`}
          </Callout>
        ) : (
          <ActivityIndicator color={colors.accent.DEFAULT} />
        )}
      </View>
    );
  }

  function share() {
    void Share.share({
      message: `MtaaSense report ${report!.reference}: ${WEB_ORIGIN}/track/${report!.id}#${token}`,
    });
  }

  function forget() {
    Alert.alert(
      'Remove from this phone?',
      'The report stays with MtaaSense, but this phone will no longer be able to open it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeReceipt(report!.id).then(() => router.back());
          },
        },
      ]
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: report.reference }} />
      <ScrollView
        contentContainerClassName={SCREEN_CONTENT}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent.DEFAULT}
            onRefresh={() => {
              setRefreshing(true);
              void state.refresh().finally(() => setRefreshing(false));
            }}
          />
        }>
        <View className="gap-2">
          <Text className="text-[13px] text-ink-3">
            Received {formatDateTime(report.created_at)}
          </Text>
          <StatusBadge status={report.status} />
          {state.error && (
            <Text className="text-[12.5px] text-warn">
              Showing the last update; {state.error.message}
            </Text>
          )}
        </View>

        {report.incident && (
          <Callout tone="success" title={`Linked to incident ${report.incident.reference}`}>
            A reviewer grouped this report into “{report.incident.title}”. Your photo and words stay
            part of the evidence.
          </Callout>
        )}

        <FixCheckCard report={report} token={token!} onSent={state.reload} />

        <Card className="p-4">
          <Timeline report={report} />
        </Card>

        <Card>
          <EvidencePhoto
            image={report.image}
            redacted={report.redacted}
            segmentations={report.segmentations}
          />
        </Card>

        {report.video && <TrackVideo video={report.video} />}

        <AnalysisCard report={report} />
        <ResidentFacts report={report} />

        <View className="gap-2">
          <Button
            title="Share tracking link"
            variant="secondary"
            icon={ShareIcon}
            onPress={share}
          />
          <Text className="text-center text-[12px] text-ink-3">
            Anyone with the link can see this report
            {report.video ? ', its photo and its clip' : ' and its photo'}.
          </Text>
        </View>
        <Button title="Remove from this phone" variant="ghost" icon={Trash} onPress={forget} />
      </ScrollView>
    </>
  );
}
