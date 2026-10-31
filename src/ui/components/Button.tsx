import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useTheme } from '@/ui/theme'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger'

export interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  size?: 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  icon?: IconName
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  accessibilityHint?: string
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const theme = useTheme()

  const background: Record<ButtonVariant, string> = {
    primary: theme.colors.primary,
    secondary: theme.colors.surfaceMuted,
    outline: 'transparent',
    danger: theme.colors.danger,
  }
  const foreground: Record<ButtonVariant, string> = {
    primary: theme.colors.onPrimary,
    secondary: theme.colors.text,
    outline: theme.colors.primary,
    danger: theme.colors.onPrimary,
  }

  const height = size === 'lg' ? 52 : 48
  const inactive = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          borderRadius: theme.radius.md,
          backgroundColor: background[variant],
          borderColor: variant === 'outline' ? theme.colors.border : background[variant],
          opacity: inactive ? 0.45 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' || variant === 'outline' ? theme.colors.primary : foreground[variant]}
        />
      ) : (
        <>
          {icon ? (
            <View style={styles.icon}>
              <Icon
                name={icon}
                size={size === 'lg' ? 20 : 18}
                color={foreground[variant]}
                strokeWidth={2.25}
              />
            </View>
          ) : null}
          <Text
            style={{
              color: foreground[variant],
              fontSize: theme.fontSize.md,
              lineHeight: theme.lineHeight.md,
              fontWeight: '600',
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  )
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    minWidth: 44,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  icon: {
    marginRight: 6,
  },
})
