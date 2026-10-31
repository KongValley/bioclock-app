import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { initDatabase } from '@/db'
import { useAppStore } from '@/store/app'
import { ThemeProvider, useTheme } from '@/ui/theme'
import { ToastHost } from '@/ui/components/Toast'
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
  const handledId = useRef<string | null>(null)

  // 点击「该注射了」通知 -> 直达登记页，省掉用户在首页再点一次。
  useEffect(() => {
    if (!lastResponse) return
    const identifier = lastResponse.notification.request.identifier
    if (handledId.current === identifier) return
    handledId.current = identifier

    const data: unknown = lastResponse.notification.request.content.data
    if (typeof data !== 'object' || data === null) return
    const payload = data as { type?: unknown }
    if (payload.type !== 'dose') return
    if (!useAppStore.getState().settings.onboarded_at) return

    router.push('/modal/injection')
  }, [lastResponse])

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <ToastHost />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  )
}

export default function RootLayout() {
  const [state, setState] = useState<BootState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    setError(null)

    initDatabase()
      .then(() => useAppStore.getState().reload())
      .then(() => {
        if (alive) setState('ready')
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
      <ThemeProvider>
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
