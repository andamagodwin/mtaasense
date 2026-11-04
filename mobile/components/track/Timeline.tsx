import { TickCircle } from 'iconsax-react-nativejs';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import type { ReportDetail } from '@/lib/types';
import { colors } from '@/theme/tokens';

type StepState = 'done' | 'active' | 'todo' | 'skipped';

export function isProcessing(report: ReportDetail): boolean {
  return (
    report.status === 'submitted' ||
    report.status === 'processing' ||
    report.analysis.status === 'pending' ||
    report.analysis.status === 'running' ||
    report.segmentations.some((s) => s.status === 'queued' || s.status === 'running') ||
    report.fix_checks.some((c) => c.status === 'queued' || c.status === 'running')
  );
}

export function Timeline({ report }: { report: ReportDetail }) {
  const seg = report.segmentations;
  const analysis = report.analysis.status;
  const analysisDone =
    analysis === 'completed' || analysis === 'failed' || analysis === 'unavailable';
  const segDone = seg.some((s) => s.status === 'completed' || s.status === 'failed');
  const segActive = seg.some((s) => s.status === 'queued' || s.status === 'running');
  const reviewed = ['confirmed', 'duplicate', 'rejected', 'resolved'].includes(report.status);
  const steps: { label: string; detail: string; state: StepState }[] = [
    { label: 'Received', detail: 'Photo and details stored', state: 'done' },
    {
      label: 'AI analysis',
      detail:
        analysis === 'unavailable'
          ? 'Unavailable, a reviewer will read it'
          : analysis === 'failed'
            ? 'Failed, a reviewer will read it'
            : 'Muse Spark reads the photo and your words',
      state: analysisDone ? (analysis === 'completed' ? 'done' : 'skipped') : 'active',
    },
    {
      label: 'Segmentation',
      detail: 'SAM 3.1 outlines the hazard',
      state: segDone ? 'done' : segActive ? 'active' : analysisDone ? 'skipped' : 'todo',
    },
    {
      label: 'Human review',
      detail: reviewed ? 'A reviewer has decided' : 'Waiting for a reviewer',
      state: reviewed ? 'done' : analysisDone ? 'active' : 'todo',
    },
  ];
  return (
    <View>
      {steps.map((s, i) => (
        <View key={s.label} className="flex-row gap-3">
          <View className="items-center">
            <StepMark state={s.state} />
            {i < steps.length - 1 && (
              <View className={cn('w-0.5 flex-1', s.state === 'done' ? 'bg-accent' : 'bg-line')} />
            )}
          </View>
          <View className={cn('flex-1 gap-0.5', i < steps.length - 1 && 'pb-4')}>
            <Text className={cn('font-semibold text-[14.5px]', s.state === 'todo' && 'text-ink-3')}>
              {s.label}
            </Text>
            <Text className="text-[12.5px] text-ink-3">{s.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function StepMark({ state }: { state: StepState }) {
  if (state === 'done') {
    return <TickCircle size={24} color={colors.accent.DEFAULT} variant="Bold" />;
  }
  if (state === 'active') {
    return (
      <View className="size-6 items-center justify-center rounded-full border border-accent bg-accent-soft">
        <ActivityIndicator
          size="small"
          color={colors.accent.DEFAULT}
          style={{ transform: [{ scale: 0.7 }] }}
        />
      </View>
    );
  }
  return (
    <View
      className={cn(
        'size-6 rounded-full border-2 bg-surface',
        state === 'skipped' ? 'border-dashed border-ink-3' : 'border-line-strong'
      )}
    />
  );
}
