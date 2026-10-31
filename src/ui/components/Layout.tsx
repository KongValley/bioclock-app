import type { ReactNode } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'

export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: ReactNode
  edges?: Edge[]
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  return (
    <SafeAreaView
      edges={edges}
      style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}
    >
      {children}
    </SafeAreaView>
  )
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.xxl,
            lineHeight: theme.lineHeight.xxl,
            fontWeight: '700',
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.fontSize.sm,
              lineHeight: theme.lineHeight.sm,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: string
  hint?: string
  right?: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.md,
            lineHeight: theme.lineHeight.md,
            fontWeight: '600',
          }}
        >
          {title}
        </Text>
        {hint ? (
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.xs,
              lineHeight: theme.lineHeight.xs,
              marginTop: 2,
            }}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border,
        marginLeft: inset,
      }}
    />
  )
}

export function ScrollArea({
  children,
  refreshing = false,
  onRefresh,
  contentContainerStyle,
  style,
  keyboardShouldPersistTaps = 'handled',
}: {
  children: ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  contentContainerStyle?: StyleProp<ViewStyle>
  style?: StyleProp<ViewStyle>
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled'
}) {
  const theme = useTheme()
  return (
    <ScrollView
      style={style}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  )
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: theme.colors.dangerMuted,
        borderColor: theme.colors.danger,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Text
        style={{
          flex: 1,
          color: theme.colors.danger,
          fontSize: theme.fontSize.sm,
          lineHeight: theme.lineHeight.sm,
        }}
      >
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试"
          onPress={onRetry}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
        >
          <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
            重试
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
