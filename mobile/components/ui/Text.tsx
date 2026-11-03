import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { cn } from '@/lib/cn';
import { colors } from '@/theme/tokens';

// React Native text doesn't inherit a font from its parent view, so every string goes through this.
export function Text({ className, ...props }: TextProps) {
  return <RNText {...props} className={cn('font-sans text-[15px] text-ink', className)} />;
}

export function TextInput({ className, ...props }: TextInputProps) {
  return (
    <RNTextInput
      placeholderTextColor={colors.ink[3]}
      selectionColor={colors.accent.DEFAULT}
      {...props}
      className={cn(
        'rounded-xl border border-line-strong bg-surface px-3.5 py-3 font-sans text-[15px] text-ink',
        className
      )}
    />
  );
}
