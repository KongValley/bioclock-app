import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import * as SystemUI from 'expo-system-ui'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { initDatabase } from '@/db'
import { useAppStore } from '@/store/app'
import { ThemeProvider, useTheme, type ThemeMode } from '@/ui/theme'
import { ToastHost } from '@/ui/components/Toast'
import { AppLockGate } from '@/ui/components/AppLockGate'
import { zh } from '@/i18n/zh'

export { useTheme } from '@/ui/theme'

type BootState = 'loading' | 'ready' | 'error'

function BootScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const theme = useTheme()
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {error ? (
        <>
          <Text style={[styles.title, { color: theme.colors.text }]}>{zh.common.loadFailed}</Text>
          <Text style={[styles.message, { color: theme.colors.textSecondary }]}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>
              {zh.common.retry}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.message, { color: theme.colors.textSecondary }]}>
            {zh.common.loading}
          </Text>
        </>
      )}
    </View>
  )
}

function RootNavigator() {
  const theme = useTheme()
  const lastResponse = Notifications.useLastNotificationResponse()
  const onboardedAt = useAppStore((state) => state.settings.onboarded_at)
  const pendingResponse = useRef<Notifications.NotificationResponse | null>(null)
  const lastHandled = useRef<{ id: string; at: number } | null>(null)

  // Android 根视图背景跟着主题走，避免切页/回弹时闪白。
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // 部分平台不支持，忽略即可。
    })
  }, [theme.colors.background])

  const handleResponse = useCallback((response: Notifications.NotificationResponse) => {
    const identifier = response.notification.request.identifier
    const now = Date.now()
    // 冷启动时 hook 和 listener 可能同时拿到同一条响应，短时间内去重一次即可；
    // 不能永久记住 identifier，否则用户第二次点同一条通知会没有反应。
    if (lastHandled.current?.id === identifier && now - lastHandled.current.at < 5_000) {
      return
    }
    if (!useAppStore.getState().settings.onboarded_at) {
      pendingResponse.current = response
      return
    }

    const data: unknown = response.notification.request.content.data
    if (typeof data !== 'object' || data === null) return
    const payload = data as {
      type?: unknown
      kind?: unknown
      lineId?: unknown
      plannedAt?: unknown
    }
    if (payload.type !== 'dose') return

    lastHandled.current = { id: identifier, at: now }
    const lineId = typeof payload.lineId === 'string' ? payload.lineId : undefined
    if (payload.kind === 'oral') {
      router.push({
        pathname: '/modal/oral',
        params: {
          ...(lineId ? { lineId } : {}),
          ...(typeof payload.plannedAt === 'number'
            ? { scheduledAt: String(payload.plannedAt) }
            : {}),
        },
      })
      return
    }
    router.push({
      pathname: '/modal/injection',
      params: lineId ? { lineId } : {},
    })
  }, [])

  // 冷启动 / 后台恢复时都通过同一个处理函数，避免两套去重逻辑。
  useEffect(() => {
    if (lastResponse) handleResponse(lastResponse)
  }, [lastResponse, handleResponse])

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse)
    return () => subscription.remove()
  }, [handleResponse])

  // 引导期间点通知时先暂存，完成引导后再补跳。
  useEffect(() => {
    if (!onboardedAt || !pendingResponse.current) return
    const response = pendingResponse.current
    pendingResponse.current = null
    handleResponse(response)
  }, [onboardedAt, handleResponse])

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <ToastHost />
      <AppLockGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AppLockGate>
    </SafeAreaProvider>
  )
}

export default function RootLayout() {
  const [state, setState] = useState<BootState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const savedMode = useAppStore((store) => store.settings.theme_mode)
  const themeMode: ThemeMode =
    savedMode === 'light' || savedMode === 'dark' ? savedMode : 'system'

  useEffect(() => {
    let alive = true
    setState('loading')
    setError(null)

    initDatabase()
      .then(() => useAppStore.getState().reload())
      .then(() => {
        if (!alive) return
        setState('ready')
        // 启动时补一次排程：口服提醒只预排两周，长时间不写数据时需要续上。
        void import('@/notify/scheduler')
          .then(({ rescheduleAll }) => rescheduleAll())
          .catch(() => {
            // 通知权限/系统限制导致的失败不阻塞启动，用户可在设置里重新保存提醒。
          })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setState('error')
      })

    return () => {
      alive = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider mode={themeMode}>
        {state === 'ready' ? <RootNavigator /> : <BootScreen error={error} onRetry={retry} />}
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
})
