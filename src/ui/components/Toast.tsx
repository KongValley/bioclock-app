import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { create } from 'zustand'
import { useTheme } from '@/ui/theme'

/**
 * 轻量全局 toast。
 * 不依赖任何 UI 库：一个 zustand 队列 + 一个浮在最上层的宿主组件。
 */

export type ToastTone = 'default' | 'success' | 'error'

interface ToastMessage {
  id: string
  text: string
  tone: ToastTone
}

interface ToastStore {
  messages: ToastMessage[]
  push(text: string, tone: ToastTone): void
  remove(id: string): void
}

let counter = 0
const AUTO_DISMISS_MS = 2800

export const useToastStore = create<ToastStore>((set) => ({
  messages: [],
  push: (text, tone) => {
    const id = `toast-${Date.now()}-${counter++}`
    set((state) => ({ messages: [...state.messages, { id, text, tone }] }))
    setTimeout(() => {
      set((state) => ({ messages: state.messages.filter((item) => item.id !== id) }))
    }, AUTO_DISMISS_MS)
  },
  remove: (id) => {
    set((state) => ({ messages: state.messages.filter((item) => item.id !== id) }))
  },
}))

export function toast(text: string, tone: ToastTone = 'default'): void {
  useToastStore.getState().push(text, tone)
}

function ToastItem({ message }: { message: ToastMessage }) {
  const theme = useTheme()
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start()
  }, [progress])

  const background =
    message.tone === 'error'
      ? theme.colors.danger
      : message.tone === 'success'
        ? theme.colors.success
        : theme.colors.text

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: background,
          borderRadius: theme.radius.md,
          shadowColor: theme.colors.text,
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
            },
          ],
        },
      ]}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: theme.colors.onPrimary,
          fontSize: theme.fontSize.sm,
          lineHeight: theme.lineHeight.sm,
          textAlign: 'center',
        }}
      >
        {message.text}
      </Text>
    </Animated.View>
  )
}

export function ToastHost() {
  const messages = useToastStore((state) => state.messages)
  if (messages.length === 0) return null

  return (
    <View pointerEvents="none" style={styles.host}>
      {messages.map((message) => (
        <ToastItem key={message.id} message={message} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  toast: {
    maxWidth: 420,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
})
