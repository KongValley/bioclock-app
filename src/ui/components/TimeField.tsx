import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/ui/theme'
import {
  addDays,
  addMinutes,
  formatDateTimeFull,
  formatManualInput,
  formatTime,
  parseManualDateTime,
  parseTimeOfDay,
  toTimeOfDay,
} from './date'
import { TextField } from './Field'

function StepButton({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string
  onPress: () => void
  accessibilityLabel: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.sm,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm }}>{label}</Text>
    </Pressable>
  )
}

/** HH:mm 时间选择：小时/分钟步进 + 手动输入，避免引入日期时间选择器依赖。 */
export function TimeOfDayField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
}) {
  const theme = useTheme()
  const parsed = parseTimeOfDay(value) ?? { hour: 9, minute: 0 }
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const apply = (hour: number, minute: number) => {
    const next = toTimeOfDay(hour, minute)
    setError(null)
    setDraft(next)
    onChange(next)
  }

  const commitManual = () => {
    const parsedDraft = parseTimeOfDay(draft)
    if (!parsedDraft) {
      setError('时间格式应为 HH:mm，例如 09:00')
      return
    }
    setError(null)
    onChange(toTimeOfDay(parsedDraft.hour, parsedDraft.minute))
  }

  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
          {label}
        </Text>
      ) : null}
      <View style={styles.clockRow}>
        <Text
          accessibilityLabel={`当前时间 ${value}`}
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.xxl,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}
        >
          {value}
        </Text>
        <View style={styles.stepGroup}>
          <StepButton
            label="−1 时"
            accessibilityLabel="时间减少一小时"
            onPress={() => apply(parsed.hour - 1, parsed.minute)}
          />
          <StepButton
            label="＋1 时"
            accessibilityLabel="时间增加一小时"
            onPress={() => apply(parsed.hour + 1, parsed.minute)}
          />
        </View>
      </View>
      <View style={styles.stepGroup}>
        <StepButton
          label="−5 分"
          accessibilityLabel="时间减少五分钟"
          onPress={() => apply(parsed.hour, parsed.minute - 5)}
        />
        <StepButton
          label="＋5 分"
          accessibilityLabel="时间增加五分钟"
          onPress={() => apply(parsed.hour, parsed.minute + 5)}
        />
        <StepButton
          label="整点"
          accessibilityLabel="分钟归零"
          onPress={() => apply(parsed.hour, 0)}
        />
      </View>
      <TextField
        value={draft}
        onChangeText={(text) => {
          setDraft(text)
          setError(null)
        }}
        onBlur={commitManual}
        onSubmitEditing={commitManual}
        keyboardType="numbers-and-punctuation"
        placeholder="09:00"
        error={error}
        accessibilityLabel="手动输入提醒时间"
        maxLength={5}
      />
    </View>
  )
}

/** 注射时间选择：现在 / 昨天 / 手动输入 + 天、分钟步进。 */
export function DateTimeField({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (value: number) => void
  label?: string
}) {
  const theme = useTheme()
  const [mode, setMode] = useState<'quick' | 'manual'>('quick')
  const [draft, setDraft] = useState(formatManualInput(value))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'manual') setDraft(formatManualInput(value))
  }, [value, mode])

  const quick = (timestamp: number) => {
    setMode('quick')
    setError(null)
    onChange(timestamp)
  }

  const applyManual = () => {
    const parsed = parseManualDateTime(draft)
    if (parsed === null) {
      setError('请输入有效时间，例如 2026-10-31 09:00')
      return
    }
    setError(null)
    onChange(parsed)
    setMode('quick')
  }

  return (
    <View style={{ gap: 10 }}>
      {label ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          gap: 4,
        }}
      >
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.lg,
            fontWeight: '600',
          }}
        >
          {formatDateTimeFull(value)}
        </Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          当地时间 · {formatTime(value)}
        </Text>
      </View>
      <View style={styles.quickRow}>
        {[
          { label: '现在', onPress: () => quick(Date.now()) },
          { label: '昨天', onPress: () => quick(addDays(Date.now(), -1)) },
          {
            label: '手动输入',
            onPress: () => {
              setMode(mode === 'manual' ? 'quick' : 'manual')
              setError(null)
            },
          },
        ].map((item) => {
          const active =
            (item.label === '手动输入' && mode === 'manual') ||
            (item.label === '昨天' && mode === 'quick' && formatManualInput(value) === formatManualInput(addDays(Date.now(), -1)))
          return (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={item.onPress}
              style={({ pressed }) => [
                styles.quickButton,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primaryMuted : theme.colors.surface,
                  borderRadius: theme.radius.sm,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: active ? theme.colors.primary : theme.colors.textSecondary,
                  fontSize: theme.fontSize.sm,
                  fontWeight: active ? '600' : '400',
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.quickRow}>
        <StepButton
          label="−1 天"
          accessibilityLabel="注射时间提前一天"
          onPress={() => onChange(addDays(value, -1))}
        />
        <StepButton
          label="＋1 天"
          accessibilityLabel="注射时间推后一天"
          onPress={() => onChange(addDays(value, 1))}
        />
        <StepButton
          label="−15 分"
          accessibilityLabel="注射时间提前十五分钟"
          onPress={() => onChange(addMinutes(value, -15))}
        />
        <StepButton
          label="＋15 分"
          accessibilityLabel="注射时间推后十五分钟"
          onPress={() => onChange(addMinutes(value, 15))}
        />
      </View>
      {mode === 'manual' ? (
        <View style={{ gap: 8 }}>
          <TextField
            value={draft}
            onChangeText={(text) => {
              setDraft(text)
              setError(null)
            }}
            placeholder="2026-10-31 09:00"
            keyboardType="numbers-and-punctuation"
            error={error}
            accessibilityLabel="手动输入注射时间"
            onSubmitEditing={applyManual}
            hint="格式：年-月-日 时:分"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="应用手动输入的时间"
            onPress={applyManual}
            style={({ pressed }) => [
              styles.applyButton,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.radius.sm,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: theme.colors.onPrimary,
                fontSize: theme.fontSize.sm,
                fontWeight: '600',
              }}
            >
              应用时间
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  stepGroup: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  stepButton: {
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  quickButton: {
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  applyButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
