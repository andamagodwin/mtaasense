import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';

import { cn } from '@/lib/cn';
import { colors } from '@/theme/tokens';

import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const container: Record<Variant, string> = {
  primary: 'bg-accent active:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface active:bg-sunken',
  ghost: 'active:bg-sunken',
  danger: 'bg-danger active:opacity-90',
};

const label: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-ink',
  ghost: 'text-ink-2',
  danger: 'text-white',
};

const tint: Record<Variant, string> = {
  primary: '#ffffff',
  secondary: colors.ink.DEFAULT,
  ghost: colors.ink[2],
  danger: '#ffffff',
};

const sizing: Record<Size, { box: string; text: string; icon: number }> = {
  sm: { box: 'h-9 px-3 gap-1.5 rounded-[10px]', text: 'text-[13px]', icon: 15 },
  md: { box: 'h-11 px-4 gap-2 rounded-xl', text: 'text-[15px]', icon: 17 },
  lg: { box: 'h-[52px] px-5 gap-2 rounded-[14px]', text: 'text-[16px]', icon: 18 },
};

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  className?: string;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const s = sizing[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      {...props}
      className={cn(
        'flex-row items-center justify-center',
        s.box,
        container[variant],
        inactive && 'opacity-50',
        className
      )}>
      {loading ? (
        <ActivityIndicator size="small" color={tint[variant]} />
      ) : (
        Icon && <Icon size={s.icon} color={tint[variant]} strokeWidth={2.1} />
      )}
      <Text className={cn('font-semibold', s.text, label[variant])}>{title}</Text>
      {IconRight && (
        <View>
          <IconRight size={s.icon} color={tint[variant]} strokeWidth={2.1} />
        </View>
      )}
    </Pressable>
  );
}
