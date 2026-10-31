import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { ToastHost } from './Toast'

export interface SheetAction {
  label: string
  onPress: () => void
  destructive?: boolean
}

export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean
  title?: string
  actions: SheetAction[]
  onClose: () => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zh.common.close}
        style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: Math.max(insets.bottom, theme.spacing.lg),
            gap: theme.spacing.xs,
          }}
          onPress={() => undefined}
        >
          {title ? (
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: theme.fontSize.xs,
                textAlign: 'center',
                paddingVertical: theme.spacing.sm,
              }}
              numberOfLines={2}
            >
              {title}
            </Text>
          ) : null}
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={action.onPress}
              style={({ pressed }) => [
                styles.action,
                {
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                },
              ]}
            >
              <Text
                style={{
                  color: action.destructive ? theme.colors.danger : theme.colors.text,
                  fontSize: theme.fontSize.md,
                  fontWeight: action.destructive ? '600' : '500',
                }}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={zh.common.cancel}
            onPress={onClose}
            style={({ pressed }) => [
              styles.action,
              {
                marginTop: theme.spacing.xs,
                borderColor: theme.colors.border,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
              },
            ]}
          >
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.fontSize.md,
                fontWeight: '500',
              }}
            >
              {zh.common.cancel}
            </Text>
          </Pressable>
        </Pressable>
        <ToastHost />
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  action: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
})
