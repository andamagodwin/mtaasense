import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from './Text';

export function Field({
  label,
  optional,
  hint,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="font-semibold text-[14px]">
        {label}
        {optional && <Text className="text-[13px] text-ink-3"> · optional</Text>}
      </Text>
      {children}
      {hint && <Text className="text-[12.5px] leading-[18px] text-ink-3">{hint}</Text>}
    </View>
  );
}
