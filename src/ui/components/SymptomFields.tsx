import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { PAIN_BAND_VALUES, PAIN_MAX, PAIN_MIN, painBand, type PainBand } from '@/domain/pain'
import { useAppStore, errorMessage } from '@/store/app'
import { TextField } from './Field'
import { Button } from './Button'
import { Icon } from './Icon'
import { toast } from './Toast'

/**
 * 疼痛评分（NRS 0–10）选择器。
 * 11 个按钮分两行，保证每个点击目标都不小于 44×44。
 */
export function PainScale({
  value,
  onChange,
}: {
  value: number | null
  onChange: (value: number | null) => void
}) {
  const theme = useTheme()
  const scores = useMemo(
    () => Array.from({ length: PAIN_MAX - PAIN_MIN + 1 }, (_, index) => PAIN_MIN + index),
    [],
  )

  const colorOf = (band: PainBand): string => {
    switch (band) {
      case 'none':
        return theme.colors.success
      case 'mild':
        return theme.colors.primary
      case 'moderate':
        return theme.colors.warning
      default:
        return theme.colors.danger
    }
  }

  const labelOf = (band: PainBand): string => {
    switch (band) {
      case 'none':
        return zh.form.painNone
      case 'mild':
        return zh.form.painMild
      case 'moderate':
        return zh.form.painModerate
      default:
        return zh.form.painSevere
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: '500',
          }}
        >
          {zh.form.pain}
        </Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          NRS 0–10
        </Text>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, marginLeft: 'auto' }}>
          {value === null ? '未记录' : `${value} · ${labelOf(painBand(value))}`}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        {[scores.slice(0, 6), scores.slice(6)].map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((score) => {
              const selected = value === score
              const color = colorOf(painBand(score))
              return (
                <Pressable
                  key={score}
                  accessibilityRole="button"
                  accessibilityLabel={`疼痛评分 ${score}，${labelOf(painBand(score))}`}
                  accessibilityState={{ selected }}
                  onPress={() => onChange(selected ? null : score)}
                  style={({ pressed }) => [
                    styles.cell,
                    {
                      borderColor: selected ? color : theme.colors.border,
                      backgroundColor: selected ? color : theme.colors.surface,
                      borderRadius: theme.radius.sm,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? theme.colors.onPrimary : theme.colors.text,
                      fontSize: theme.fontSize.md,
                      fontWeight: selected ? '700' : '500',
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {score}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {PAIN_BAND_VALUES.map((band) => {
          const from = band === 'none' ? 0 : band === 'mild' ? 1 : band === 'moderate' ? 4 : 7
          const to = band === 'none' ? 0 : band === 'mild' ? 3 : band === 'moderate' ? 6 : 10
          return (
            <View key={band} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={[styles.dot, { backgroundColor: colorOf(band) }]} />
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                {from === to ? `${from} ${labelOf(band)}` : `${from}–${to} ${labelOf(band)}`}
              </Text>
            </View>
          )
        })}
      </View>

      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
        {zh.form.painHint}
      </Text>
    </View>
  )
}

/** 症状标签维护：新增 / 删除。删除只影响之后的可选项，历史记录文字不变。 */
export function SymptomTagManager({
  onAdded,
  onRemoved,
}: {
  onAdded?: (name: string) => void
  onRemoved?: (id: string) => void
}) {
  const theme = useTheme()
  const tags = useAppStore((state) => state.symptomTags)
  const addSymptomTag = useAppStore((state) => state.addSymptomTag)
  const removeSymptomTag = useAppStore((state) => state.removeSymptomTag)

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    const name = draft.trim()
    if (name === '') {
      setError('请输入症状名称')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await addSymptomTag(name)
      setDraft('')
      onAdded?.(name)
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string, name: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await removeSymptomTag(id)
      toast(`已删除「${name}」`, 'success')
      onRemoved?.(id)
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceMuted,
      }}
    >
      <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
        {zh.form.tagManagerTitle}
      </Text>
      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
        {zh.form.tagManagerHint}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={draft}
            onChangeText={(text) => {
              setDraft(text)
              setError(null)
            }}
            placeholder={zh.form.tagAddPlaceholder}
            accessibilityLabel="新增症状名称"
            maxLength={20}
            onSubmitEditing={() => {
              void add()
            }}
          />
        </View>
        <Button
          label={zh.form.tagAdd}
          onPress={() => {
            void add()
          }}
          loading={busy}
          icon="plus"
        />
      </View>

      {error ? (
        <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.xs }}>{error}</Text>
      ) : null}

      {tags.length === 0 ? (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          {zh.form.tagEmpty}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {tags.map((tag) => (
            <View
              key={tag.id}
              style={[
                styles.tagChip,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.pill,
                },
              ]}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                {tag.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`删除症状 ${tag.name}`}
                disabled={busy}
                onPress={() => {
                  void remove(tag.id, tag.name)
                }}
                style={({ pressed }) => [
                  styles.deleteButton,
                  { opacity: busy ? 0.35 : pressed ? 0.5 : 1 },
                ]}
              >
                <Icon name="close" size={14} color={theme.colors.textTertiary} strokeWidth={2.5} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  cell: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 6,
    minHeight: 36,
  },
  deleteButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
