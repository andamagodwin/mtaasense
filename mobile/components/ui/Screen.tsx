import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from './Text';

/**
 * One spacing scale for every screen: a 16pt gutter, 16pt at the top, 24pt between sections and 32pt at the
 * bottom. Cards and rows inside use 16pt.
 */
export const SCREEN_CONTENT = 'gap-6 px-4 pb-8 pt-4';

export function ScreenHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}): ReactNode {
  return (
    <View className="gap-1">
      <Text className="font-bold text-[28px] tracking-tight">{title}</Text>
      {description && (
        <Text className="text-[14.5px] leading-[21px] text-ink-2">{description}</Text>
      )}
    </View>
  );
}
