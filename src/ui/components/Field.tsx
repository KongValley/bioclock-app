import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useTheme } from '@/ui/theme'

export interface TextFieldProps extends TextInputProps {
  label?: string
  hint?: string
  error?: string | null
  suffix?: string
}

export function TextField({
  label,
  hint,
  error,
  suffix,
  multiline,
  style,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme()

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            lineHeight: theme.lineHeight.sm,
            fontWeight: '500',
          }}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: error ? theme.colors.danger : theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          minHeight: 48,
        }}
      >
        <TextInput
          {...inputProps}
          multiline={multiline}
          placeholderTextColor={theme.colors.textTertiary}
          selectionColor={theme.colors.primary}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          style={[
            {
              flex: 1,
              minHeight: multiline ? 96 : 48,
              paddingVertical: multiline ? theme.spacing.md : 0,
              color: theme.colors.text,
              fontSize: theme.fontSize.md,
              lineHeight: theme.lineHeight.md,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
        />
        {suffix ? (
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.sm,
              marginLeft: 6,
            }}
          >
            {suffix}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  )
}
