import { useEffect, useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import type { SymptomLog } from '@/types'
import { TextField } from '@/ui/components/Field'
import { DateTimeField } from '@/ui/components/TimeField'
import { Icon } from '@/ui/components/Icon'
import { Button } from '@/ui/components/Button'
import { PainScale, SymptomTagManager } from '@/ui/components/SymptomFields'
import { InlineError } from '@/ui/components/Layout'
import { LoadingView } from '@/ui/components/StateView'
import { toast, ToastHost } from '@/ui/components/Toast'
import { useDismissOnRelock } from '@/ui/components/hooks'
import { formatDate } from '@/ui/components/date'

const SEVERITIES: Array<{ value: SymptomLog['severity']; label: string }> = [
  { value: 1, label: zh.form.severity1 },
  { value: 2, label: zh.form.severity2 },
  { value: 3, label: zh.form.severity3 },
  { value: 4, label: zh.form.severity4 },
  { value: 5, label: zh.form.severity5 },
]

export default function SymptomModal() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const editingId = Array.isArray(params.id) ? params.id[0] : params.id

  const ready = useAppStore((state) => state.ready)
  const medications = useAppStore((state) => state.medications)
  const injections = useAppStore((state) => state.injections)
  const symptoms = useAppStore((state) => state.symptoms)
  const symptomTags = useAppStore((state) => state.symptomTags)
  const appLockEnabled = useAppStore((state) => state.settings.app_lock === '1')
  const reload = useAppStore((state) => state.reload)
  const addSymptom = useAppStore((state) => state.addSymptom)
  const updateSymptom = useAppStore((state) => state.updateSymptom)

  const editing = editingId ? symptoms.find((item) => item.id === editingId) : undefined

  const [loggedAt, setLoggedAt] = useState<number>(() => Date.now())
  const [severity, setSeverity] = useState<SymptomLog['severity']>(3)
  const [painScore, setPainScore] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [temperatureText, setTemperatureText] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [injectionId, setInjectionId] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) {
      reload().catch((error: unknown) => {
        setFormError(errorMessage(error))
      })
    }
  }, [ready, reload])

  useEffect(() => {
    if (!ready || initialized) return
    if (editing) {
      setLoggedAt(editing.loggedAt)
      setSeverity(editing.severity)
      setPainScore(editing.painScore)
      setTags(editing.tags)
      setTemperatureText(editing.temperature !== null ? String(editing.temperature) : '')
      setNote(editing.note ?? '')
      setInjectionId(editing.injectionId)
    }
    setInitialized(true)
  }, [ready, initialized, editing])

  const medicationNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const medication of medications) map.set(medication.id, medication.name)
    return map
  }, [medications])

  const recentInjections = useMemo(() => {
    return [...injections].sort((a, b) => b.injectedAt - a.injectedAt).slice(0, 5)
  }, [injections])

  const close = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }

  useDismissOnRelock(close, appLockEnabled)

  const toggleTag = (tag: string) => {
    setTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    )
  }

  // 已选但已被删除的标签仍然要显示出来，否则编辑旧记录时看不见、也取消不掉。
  const tagOptions = useMemo(() => {
    const names = symptomTags.map((item) => item.name)
    const orphan = tags.filter((tag) => !names.includes(tag))
    return [...names, ...orphan]
  }, [symptomTags, tags])

  const save = async () => {
    setFormError(null)
    let temperature: number | null = null
    if (temperatureText.trim() !== '') {
      const parsed = Number(temperatureText.trim())
      if (!Number.isFinite(parsed) || parsed < 30 || parsed > 45) {
        setFormError('体温应在 30℃ 到 45℃ 之间。')
        return
      }
      temperature = Math.round(parsed * 10) / 10
    }

    setSaving(true)
    try {
      const payload = {
        loggedAt,
        severity,
        painScore,
        tags,
        note: note.trim() === '' ? null : note.trim(),
        temperature,
        injectionId,
      }
      const result = editing
        ? await updateSymptom(editing.id, payload)
        : await addSymptom(payload)
      close()
      toast(editing ? '症状记录已更新' : '症状已记录', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      setFormError(errorMessage(error))
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <View
            style={{
              maxHeight: '94%',
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: Math.max(insets.bottom, theme.spacing.md),
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.lg,
                paddingBottom: theme.spacing.sm,
                gap: theme.spacing.md,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  flex: 1,
                  color: theme.colors.text,
                  fontSize: theme.fontSize.xl,
                  fontWeight: '700',
                }}
              >
                {editing ? '编辑症状' : zh.history.addSymptom}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zh.common.close}
                onPress={close}
                style={({ pressed }) => [
                  styles.closeButton,
                  {
                    borderRadius: theme.radius.pill,
                    backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                  },
                ]}
              >
                <Icon name="close" size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            {!ready ? (
              <LoadingView />
            ) : (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ flexShrink: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: theme.spacing.lg,
                  paddingBottom: theme.spacing.lg,
                  gap: theme.spacing.lg,
                }}
              >
                <DateTimeField label={zh.form.loggedAt} value={loggedAt} onChange={setLoggedAt} />

                <View style={{ gap: 8 }}>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.fontSize.sm,
                      fontWeight: '500',
                    }}
                  >
                    {zh.form.severity}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {SEVERITIES.map((item) => {
                      const selected = severity === item.value
                      const color =
                        item.value === 1
                          ? theme.colors.success
                          : item.value === 2
                            ? theme.colors.primary
                            : item.value === 3
                              ? theme.colors.warning
                              : theme.colors.danger
                      return (
                        <Pressable
                          key={item.value}
                          accessibilityRole="button"
                          accessibilityLabel={`严重程度 ${item.value}，${item.label}`}
                          accessibilityState={{ selected }}
                          onPress={() => setSeverity(item.value)}
                          style={({ pressed }) => [
                            styles.severity,
                            {
                              backgroundColor: selected ? color : theme.colors.surface,
                              borderColor: selected ? color : theme.colors.border,
                              borderRadius: theme.radius.md,
                              opacity: pressed ? 0.8 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: selected ? theme.colors.onPrimary : theme.colors.text,
                              fontSize: theme.fontSize.lg,
                              fontWeight: '700',
                            }}
                          >
                            {item.value}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={{
                              color: selected ? theme.colors.onPrimary : theme.colors.textTertiary,
                              fontSize: theme.fontSize.xs,
                              marginTop: 2,
                            }}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        fontWeight: '500',
                      }}
                    >
                      {zh.form.symptomTags}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={zh.form.manageTags}
                      accessibilityState={{ expanded: managerOpen }}
                      onPress={() => setManagerOpen((open) => !open)}
                      style={({ pressed }) => [
                        styles.manageButton,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Icon
                        name={managerOpen ? 'close' : 'settings'}
                        size={14}
                        color={theme.colors.primary}
                      />
                      <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.xs }}>
                        {zh.form.manageTags}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {tagOptions.map((tag) => {
                      const selected = tags.includes(tag)
                      return (
                        <Pressable
                          key={tag}
                          accessibilityRole="button"
                          accessibilityLabel={tag}
                          accessibilityState={{ selected }}
                          onPress={() => toggleTag(tag)}
                          style={({ pressed }) => [
                            styles.tag,
                            {
                              borderColor: selected ? theme.colors.primary : theme.colors.border,
                              backgroundColor: selected
                                ? theme.colors.primaryMuted
                                : theme.colors.surface,
                              borderRadius: theme.radius.pill,
                              opacity: pressed ? 0.75 : 1,
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
                            {tag}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                  {tagOptions.length === 0 ? (
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                      {zh.form.tagEmpty}
                    </Text>
                  ) : null}
                  {managerOpen ? (
                    <SymptomTagManager
                      onAdded={(name) => {
                        setTags((current) =>
                          current.includes(name) ? current : [...current, name],
                        )
                      }}
                    />
                  ) : null}
                </View>

                <PainScale value={painScore} onChange={setPainScore} />

                <TextField
                  label={`${zh.form.temperature}（${zh.common.optional}）`}
                  value={temperatureText}
                  onChangeText={setTemperatureText}
                  keyboardType="decimal-pad"
                  placeholder="36.8"
                  suffix="℃"
                  accessibilityLabel="体温"
                />

                <TextField
                  label={`${zh.form.note}（${zh.common.optional}）`}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="症状出现的时间、持续多久、是否缓解…"
                  accessibilityLabel="症状备注"
                />

                <View style={{ gap: 8 }}>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.fontSize.sm,
                      fontWeight: '500',
                    }}
                  >
                    {zh.form.relatedInjection}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="不关联注射记录"
                      accessibilityState={{ selected: injectionId === null }}
                      onPress={() => setInjectionId(null)}
                      style={({ pressed }) => [
                        styles.tag,
                        {
                          borderColor:
                            injectionId === null ? theme.colors.primary : theme.colors.border,
                          backgroundColor:
                            injectionId === null
                              ? theme.colors.primaryMuted
                              : theme.colors.surface,
                          borderRadius: theme.radius.pill,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color:
                            injectionId === null
                              ? theme.colors.primary
                              : theme.colors.textSecondary,
                          fontSize: theme.fontSize.sm,
                        }}
                      >
                        不关联
                      </Text>
                    </Pressable>
                    {recentInjections.map((injection) => {
                      const selected = injectionId === injection.id
                      return (
                        <Pressable
                          key={injection.id}
                          accessibilityRole="button"
                          accessibilityLabel={`关联 ${formatDate(injection.injectedAt)} 的注射`}
                          accessibilityState={{ selected }}
                          onPress={() => setInjectionId(selected ? null : injection.id)}
                          style={({ pressed }) => [
                            styles.tag,
                            {
                              borderColor: selected ? theme.colors.primary : theme.colors.border,
                              backgroundColor: selected
                                ? theme.colors.primaryMuted
                                : theme.colors.surface,
                              borderRadius: theme.radius.pill,
                              opacity: pressed ? 0.75 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: selected ? theme.colors.primary : theme.colors.textSecondary,
                              fontSize: theme.fontSize.sm,
                            }}
                          >
                            {formatDate(injection.injectedAt)} ·{' '}
                            {medicationNames.get(injection.medicationId) ?? zh.common.unknown}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                  {recentInjections.length === 0 ? (
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                      还没有注射记录可关联。
                    </Text>
                  ) : null}
                </View>

                {formError ? <InlineError message={formError} /> : null}
              </ScrollView>
            )}

            <View
              style={{
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.sm,
                flexDirection: 'row',
                gap: theme.spacing.md,
              }}
            >
              <Button label={zh.common.cancel} onPress={close} variant="secondary" style={{ flex: 1 }} />
              <Button
                label={editing ? zh.common.save : '保存记录'}
                onPress={() => {
                  void save()
                }}
                loading={saving}
                disabled={!ready}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
        <ToastHost />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  keyboard: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severity: {
    flex: 1,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 2,
  },
  tag: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 44,
    paddingHorizontal: 8,
  },
})
