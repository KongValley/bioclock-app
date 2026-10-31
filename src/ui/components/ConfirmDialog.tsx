import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { ToastHost } from './Toast'

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = zh.common.confirm,
  cancelLabel = zh.common.cancel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const theme = useTheme()

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
    >
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.xl,
            gap: theme.spacing.sm,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              color: theme.colors.text,
              fontSize: theme.fontSize.lg,
              lineHeight: theme.lineHeight.lg,
              fontWeight: '700',
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
              }}
            >
              {message}
            </Text>
          ) : null}
          <View style={[styles.actions, { marginTop: theme.spacing.md }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              disabled={busy}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceMuted,
                  opacity: busy ? 0.5 : pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md }}>
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: destructive ? theme.colors.danger : theme.colors.primary,
                  borderRadius: theme.radius.md,
                  backgroundColor: destructive ? theme.colors.danger : theme.colors.primary,
                  opacity: busy ? 0.6 : pressed ? 0.8 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.onPrimary} />
              ) : (
                <Text
                  style={{
                    color: theme.colors.onPrimary,
                    fontSize: theme.fontSize.md,
                    fontWeight: '600',
                  }}
                >
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
        <ToastHost />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
})
