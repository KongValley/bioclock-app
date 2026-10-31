import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'

export default function SettingsScreen() {
  const theme = useTheme()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{zh.settings.title}</Text>
        <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
          {zh.empty.todayNoRegimen}
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  title: { fontSize: 24, fontWeight: '600' },
  hint: { fontSize: 14, textAlign: 'center' },
})
