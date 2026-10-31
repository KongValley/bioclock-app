import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/ui/theme'

export interface StepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  label?: string
  decreaseLabel?: string
  increaseLabel?: string
  formatValue?: (value: number) => string
  disabled?: boolean
}

export function Stepper({
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  suffix,
  label,
  decreaseLabel = '减少',
  increaseLabel = '增加',
  formatValue,
  disabled = false,
}: StepperProps) {
  const theme = useTheme()

  const clamp = (next: number): number => Math.min(max, Math.max(min, next))
  const canDecrease = !disabled && value - step >= min
  const canIncrease = !disabled && value + step <= max

  const button = (glyph: string, onPress: () => void, enabled: boolean, name: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.sm,
          opacity: !enabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.lg }}>{glyph}</Text>
    </Pressable>
  )

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
          {label}
        </Text>
      ) : null}
      <View style={styles.row}>
        {button('−', () => onChange(clamp(value - step)), canDecrease, decreaseLabel)}
        <View
          style={[
            styles.valueBox,
            {
              borderColor: theme.colors.border,
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.fontSize.lg,
              fontWeight: '600',
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatValue ? formatValue(value) : value}
            {suffix ? (
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }}>
                {' '}
                {suffix}
              </Text>
            ) : null}
          </Text>
        </View>
        {button('＋', () => onChange(clamp(value + step)), canIncrease, increaseLabel)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  valueBox: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 8,
  },
})
