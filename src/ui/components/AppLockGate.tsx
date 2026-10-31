import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '@/store/app'
import { useTheme } from '@/ui/theme'
import { Button } from './Button'

/**
 * 应用锁。
 * 加锁判断放在 Tabs 布局里，因为根布局由其他代理维护。
 * 回到前台超过 30 秒会重新上锁。
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const lockEnabled = useAppStore((state) => state.settings.app_lock === '1')
  const [unlocked, setUnlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unlock = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync()
      if (!hasHardware) {
        setError('此设备不支持生物识别，可在下方暂时关闭应用锁。')
        return
      }
      const enrolled = await LocalAuthentication.isEnrolledAsync()
      if (!enrolled) {
        setError('尚未录入指纹或面容，请先在系统设置中录入，或暂时关闭应用锁。')
        return
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '解锁 BioClock',
        cancelLabel: '取消',
        disableDeviceFallback: false,
      })
      if (result.success) {
        setUnlocked(true)
      } else {
        setError('未通过验证，请重试。')
      }
    } catch {
      setError('身份验证失败，请重试。')
    } finally {
      setBusy(false)
    }
  }, [])

  const previousLock = useRef(lockEnabled)

  useEffect(() => {
    if (!lockEnabled) {
      setUnlocked(false)
      previousLock.current = false
      return
    }
    if (!previousLock.current) {
      // 用户刚在设置里开启应用锁；开启前已通过身份验证，本会话保持解锁。
      previousLock.current = true
      setUnlocked(true)
      return
    }
    if (!unlocked) {
      void unlock()
    }
  }, [lockEnabled, unlocked, unlock])

  const appState = useRef(AppState.currentState)
  const backgroundAt = useRef(0)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (appState.current === 'active' && next !== 'active') {
        backgroundAt.current = Date.now()
      }
      if (
        next === 'active' &&
        appState.current !== 'active' &&
        lockEnabled &&
        Date.now() - backgroundAt.current > 30_000
      ) {
        setUnlocked(false)
      }
      appState.current = next
    })
    return () => subscription.remove()
  }, [lockEnabled])

  if (!lockEnabled || unlocked) return <>{children}</>

  const closeLock = () => {
    useAppStore
      .getState()
      .updateSettings({ app_lock: '0' })
      .then((result) => {
        if (result.notifyWarning) setError(result.notifyWarning)
      })
      .catch((error: unknown) => {
        setError(`关闭应用锁失败：${error instanceof Error ? error.message : '请稍后再试'}`)
      })
  }

  return (
    <View
      style={[
        styles.lockScreen,
        {
          backgroundColor: theme.colors.background,
          paddingTop: insets.top + 64,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: theme.spacing.xl,
        },
      ]}
    >
      <View style={styles.lockBody}>
        <Text style={{ fontSize: 44, color: theme.colors.primary }}>🔒</Text>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.xxl,
            fontWeight: '700',
          }}
        >
          BioClock 已锁定
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: theme.lineHeight.md,
            textAlign: 'center',
            maxWidth: 300,
          }}
        >
          使用指纹或面容解锁，查看你的注射与症状记录。
        </Text>
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.colors.danger,
              fontSize: theme.fontSize.sm,
              textAlign: 'center',
              maxWidth: 300,
            }}
          >
            {error}
          </Text>
        ) : null}
        <View style={{ width: '100%', maxWidth: 300, marginTop: theme.spacing.lg, gap: 10 }}>
          <Button
            label={busy ? '验证中…' : '解锁'}
            onPress={() => {
              void unlock()
            }}
            loading={busy}
            size="lg"
            icon="◎"
          />
          {error ? (
            <Button label="暂时关闭应用锁" onPress={closeLock} variant="secondary" />
          ) : null}
        </View>
      </View>
      {busy ? (
        <ActivityIndicator
          style={{ marginTop: 24 }}
          color={theme.colors.primary}
          accessibilityLabel="正在验证"
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  lockScreen: {
    flex: 1,
    alignItems: 'center',
  },
  lockBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
})
