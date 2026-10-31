import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/ui/theme'
import { Button } from './Button'
import { zh } from '@/i18n/zh'

export function StateView({
  glyph = '○',
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  glyph?: string
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  compact?: boolean
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.container,
        {
          paddingVertical: compact ? theme.spacing.xl : theme.spacing.xxl,
          paddingHorizontal: theme.spacing.lg,
        },
      ]}
    >
      <Text style={{ fontSize: compact ? 28 : 36, color: theme.colors.textTertiary }}>{glyph}</Text>
      <Text
        accessibilityRole="header"
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.lg,
          lineHeight: theme.lineHeight.lg,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: theme.lineHeight.md,
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={{ marginTop: 8 }} />
      ) : null}
    </View>
  )
}

export function LoadingView({ label = zh.common.loading }: { label?: string }) {
  const theme = useTheme()
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>{label}</Text>
    </View>
  )
}

export function ErrorView({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <StateView
      glyph="!"
      title={zh.common.loadFailed}
      message={message}
      actionLabel={onRetry ? zh.common.retry : undefined}
      onAction={onRetry}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
})
