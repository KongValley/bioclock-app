import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '@/ui/theme'

export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityLabel,
  disabled = false,
}: {
  label: string
  selected?: boolean
  onPress?: () => void
  accessibilityLabel?: string
  disabled?: boolean
}) {
  const theme = useTheme()
  const interactive = typeof onPress === 'function'

  return (
    <Pressable
      accessibilityRole={interactive ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={!interactive || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
          borderRadius: theme.radius.pill,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? theme.colors.primary : theme.colors.textSecondary,
          fontSize: theme.fontSize.sm,
          fontWeight: selected ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
  },
})
