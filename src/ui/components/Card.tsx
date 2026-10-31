import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/theme'

export type CardTone = 'default' | 'primary' | 'danger' | 'warning' | 'success'

export function Card({
  children,
  tone = 'default',
  style,
  padding = true,
}: {
  children: ReactNode
  tone?: CardTone
  style?: StyleProp<ViewStyle>
  padding?: boolean
}) {
  const theme = useTheme()
  const background: Record<CardTone, string> = {
    default: theme.colors.surface,
    primary: theme.colors.primaryMuted,
    danger: theme.colors.dangerMuted,
    warning: theme.colors.warningMuted,
    success: theme.colors.successMuted,
  }
  const border: Record<CardTone, string> = {
    default: theme.colors.border,
    primary: theme.colors.primary,
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    success: theme.colors.success,
  }
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: background[tone],
          borderColor: tone === 'default' ? theme.colors.border : border[tone],
          borderWidth: tone === 'default' ? StyleSheet.hairlineWidth : 1,
          borderRadius: theme.radius.lg,
          padding: padding ? theme.spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
})
