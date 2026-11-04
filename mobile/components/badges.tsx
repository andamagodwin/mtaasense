import { View } from 'react-native';

import { cn } from '@/lib/cn';
import { CATEGORY_HEX, CATEGORY_LABEL, REPORT_STATUS_LABEL } from '@/lib/format';
import type { HazardCategory, ReportStatus } from '@/lib/types';
import { colors } from '@/theme/tokens';

import { Text } from './ui/Text';

const statusTone: Record<ReportStatus, { box: string; text: string; dot: string }> = {
  submitted: { box: 'border-line bg-sunken', text: 'text-ink-2', dot: 'bg-ink-2' },
  processing: { box: 'border-info-line bg-info-soft', text: 'text-info-ink', dot: 'bg-info' },
  under_review: { box: 'border-warn-line bg-warn-soft', text: 'text-warn-ink', dot: 'bg-warn-ink' },
  confirmed: {
    box: 'border-success-line bg-success-soft',
    text: 'text-success-ink',
    dot: 'bg-success',
  },
  duplicate: {
    box: 'border-success-line bg-success-soft',
    text: 'text-success-ink',
    dot: 'bg-success',
  },
  rejected: { box: 'border-line bg-sunken', text: 'text-ink-3', dot: 'bg-ink-3' },
  resolved: { box: 'border-line-strong bg-surface', text: 'text-ink-2', dot: 'bg-ink-2' },
  processing_failed: {
    box: 'border-danger-line bg-danger-soft',
    text: 'text-danger',
    dot: 'bg-danger',
  },
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  const tone = statusTone[status];
  return (
    <View
      className={cn(
        'h-[24px] flex-row items-center gap-1.5 self-start rounded-md border px-2',
        tone.box
      )}>
      <View className={cn('size-1.5 rounded-full opacity-80', tone.dot)} />
      <Text className={cn('font-semibold text-[12px]', tone.text)}>
        {REPORT_STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

export function CategoryDot({
  category,
  size = 8,
}: {
  category: HazardCategory | null;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: category ? CATEGORY_HEX[category] : colors.ink[3],
      }}
    />
  );
}

export function CategoryBadge({ category }: { category: HazardCategory | null }) {
  return (
    <View className="h-[24px] flex-row items-center gap-1.5 self-start rounded-md border border-line bg-surface px-2">
      <CategoryDot category={category} />
      <Text className="font-semibold text-[12px]">
        {category ? CATEGORY_LABEL[category] : 'Uncategorised'}
      </Text>
    </View>
  );
}

export function PrivacyBlurredBadge() {
  return (
    <View className="h-[24px] flex-row items-center gap-1.5 self-start rounded-md border border-line bg-sunken px-2">
      <Text className="font-semibold text-[12px] text-ink-2">Faces and plates blurred</Text>
    </View>
  );
}
