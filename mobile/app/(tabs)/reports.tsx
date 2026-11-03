import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { Camera, ChevronRight, Inbox } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryDot, StatusBadge } from '@/components/badges';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { api, mediaUrl } from '@/lib/api';
import { CATEGORY_LABEL, timeAgo } from '@/lib/format';
import { type Receipt, receiptToken, syncReceipt, useReceipts } from '@/lib/receipts';
import type { MediaRef } from '@/lib/types';
import { colors } from '@/theme/tokens';

export default function MyReportsScreen() {
  const { receipts, loaded } = useReceipts();
  const [thumbs, setThumbs] = useState<Record<string, MediaRef | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(receipts);
  useEffect(() => {
    latest.current = receipts;
  }, [receipts]);

  // Statuses change on the server, so every visit refreshes them; failures keep the last known state.
  const refresh = useCallback(async () => {
    await Promise.all(
      latest.current.slice(0, 30).map(async (r) => {
        try {
          const token = await receiptToken(r.id);
          if (!token) return;
          const report = await api.report(r.id, token);
          setThumbs((prev) => ({ ...prev, [r.id]: report.thumbnail }));
          await syncReceipt(report);
        } catch {
          /* offline or removed: keep the cached row */
        }
      })
    );
  }, []);

  // Re-runs when the stored list finishes loading, since the first focus can come before it.
  useFocusEffect(
    useCallback(() => {
      if (loaded) void refresh();
    }, [loaded, refresh])
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={receipts}
        keyExtractor={(r) => r.id}
        contentContainerClassName="gap-3 px-4 pb-8 pt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent.DEFAULT}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View className="mb-3">
            <ScreenHeader
              title="My reports"
              description="Reports sent from this phone. Only you and MtaaSense reviewers can see your photos."
            />
          </View>
        }
        ListEmptyComponent={loaded ? <Empty /> : undefined}
        renderItem={({ item }) => <ReceiptRow receipt={item} thumbnail={thumbs[item.id] ?? null} />}
      />
    </SafeAreaView>
  );
}

function ReceiptRow({ receipt, thumbnail }: { receipt: Receipt; thumbnail: MediaRef | null }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/reports/[id]', params: { id: receipt.id } })}
      className="flex-row items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 active:bg-sunken">
      <View className="size-16 items-center justify-center overflow-hidden rounded-[10px] bg-sunken">
        {thumbnail ? (
          <Image
            source={{ uri: mediaUrl(thumbnail), cacheKey: thumbnail.id }}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <CategoryDot category={receipt.category} size={12} />
        )}
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="font-mono text-[14px]">{receipt.reference}</Text>
          <Text className="text-[12px] text-ink-3">{timeAgo(receipt.createdAt)}</Text>
        </View>
        <StatusBadge status={receipt.status} />
        <Text className="text-[13px] text-ink-2" numberOfLines={1}>
          {receipt.summary ??
            (receipt.category ? CATEGORY_LABEL[receipt.category] : 'Waiting for a category') +
              (receipt.locationNote ? ` · ${receipt.locationNote}` : '')}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.ink[3]} />
    </Pressable>
  );
}

function Empty() {
  return (
    <View className="items-center gap-3 rounded-[14px] border border-dashed border-line-strong px-4 py-10">
      <View className="size-12 items-center justify-center rounded-full bg-sunken">
        <Inbox size={22} color={colors.ink[3]} />
      </View>
      <Text className="font-semibold text-[16px]">No reports yet</Text>
      <Text className="text-center text-[13.5px] leading-5 text-ink-3">
        When you report a hazard, it appears here with its progress from AI analysis to human
        review.
      </Text>
      <Button
        title="Report a hazard"
        icon={Camera}
        onPress={() => router.navigate('/')}
        className="mt-1"
      />
    </View>
  );
}
