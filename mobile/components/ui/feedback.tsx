import { CloseCircle, Danger, InfoCircle, TickCircle } from 'iconsax-react-nativejs';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from '@/lib/cn';
import { colors } from '@/theme/tokens';

import { Text } from './Text';

type Tone = 'neutral' | 'info' | 'warn' | 'danger' | 'success';

const tones: Record<Tone, { box: string; icon: typeof InfoCircle; color: string }> = {
  neutral: { box: 'border-line bg-sunken', icon: InfoCircle, color: colors.ink[2] },
  info: { box: 'border-info-line bg-info-soft', icon: InfoCircle, color: colors.info.DEFAULT },
  warn: { box: 'border-warn-line bg-warn-soft', icon: Danger, color: colors.warn.DEFAULT },
  danger: {
    box: 'border-danger-line bg-danger-soft',
    icon: CloseCircle,
    color: colors.danger.DEFAULT,
  },
  success: {
    box: 'border-success-line bg-success-soft',
    icon: TickCircle,
    color: colors.success.DEFAULT,
  },
};

export function Callout({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <View className={cn('flex-row gap-2.5 rounded-xl border px-4 py-3', t.box, className)}>
      <View className="pt-0.5">
        <Icon size={16} color={t.color} />
      </View>
      <View className="flex-1 gap-0.5">
        {title && <Text className="font-semibold text-[14px]">{title}</Text>}
        <Text className="text-[13.5px] leading-5 text-ink-2">{children}</Text>
      </View>
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View className="h-1.5 overflow-hidden rounded-full bg-line">
      <View
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </View>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View className={cn('overflow-hidden rounded-[14px] border border-line bg-surface', className)}>
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="font-semibold text-[12px] uppercase tracking-wider text-ink-3">
      {children}
    </Text>
  );
}
