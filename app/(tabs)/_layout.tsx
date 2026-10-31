import { Text, type ColorValue } from 'react-native'
import { Tabs } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>
}

export default function TabsLayout() {
  const theme = useTheme()

  return (
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
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: zh.tabs.today,
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: zh.tabs.history,
          tabBarIcon: ({ color }) => <TabIcon glyph="☰" color={color} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: zh.tabs.trends,
          tabBarIcon: ({ color }) => <TabIcon glyph="◔" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: zh.tabs.settings,
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  )
}
