import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View, type ColorValue } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import { ErrorView, LoadingView } from '@/ui/components/StateView'
import { Icon, type IconName } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Layout'

function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <Icon name={name} size={24} color={typeof color === 'string' ? color : undefined} />
}

export default function TabsLayout() {
  const theme = useTheme()
  const router = useRouter()
  const ready = useAppStore((state) => state.ready)
  const settings = useAppStore((state) => state.settings)
  const reload = useAppStore((state) => state.reload)
  const [bootError, setBootError] = useState<string | null>(null)

  const boot = useCallback(() => {
    setBootError(null)
    reload().catch((error: unknown) => {
      setBootError(errorMessage(error))
    })
  }, [reload])

  useEffect(() => {
    if (!ready) boot()
  }, [ready, boot])

  const onboardedAt = settings.onboarded_at

  useEffect(() => {
    if (ready && !onboardedAt) {
      router.replace('/onboarding')
    }
  }, [ready, onboardedAt, router])

  if (!ready) {
    return (
      <Screen>
        {bootError ? (
          <ErrorView message={bootError} onRetry={boot} />
        ) : (
          <LoadingView label={zh.common.loading} />
        )}
      </Screen>
    )
  }

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textTertiary,
          tabBarStyle: {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
          },
          tabBarLabelStyle: { fontSize: theme.fontSize.xs },
          sceneStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: zh.tabs.today,
            tabBarAccessibilityLabel: zh.tabs.today,
            tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: zh.tabs.history,
            tabBarAccessibilityLabel: zh.tabs.history,
            tabBarIcon: ({ color }) => <TabIcon name="list" color={color} />,
          }}
        />
        <Tabs.Screen
          name="trends"
          options={{
            title: zh.tabs.trends,
            tabBarAccessibilityLabel: zh.tabs.trends,
            tabBarIcon: ({ color }) => <TabIcon name="activity" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: zh.tabs.settings,
            tabBarAccessibilityLabel: zh.tabs.settings,
            tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} />,
          }}
        />
      </Tabs>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
