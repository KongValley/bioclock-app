import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '@/ui/theme'
import { Icon, type IconName } from './Icon'

export function Fab({
  label,
  onPress,
  accessibilityLabel,
  icon = 'plus',
}: {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  icon?: IconName
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radius.pill,
          shadowColor: theme.colors.text,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Icon name={icon} size={20} color={theme.colors.onPrimary} strokeWidth={2.25} />
      <Text
        style={{
          color: theme.colors.onPrimary,
          fontSize: theme.fontSize.md,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
})
