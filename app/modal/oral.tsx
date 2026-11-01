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
import { buildSchedule } from '@/domain/schedule'
import type { DoseLogInput } from '@/db/repo'
import type { Medication, TreatmentLine } from '@/types'
import { TextField } from '@/ui/components/Field'
import { DateTimeField } from '@/ui/components/TimeField'
import { Icon } from '@/ui/components/Icon'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { InlineError } from '@/ui/components/Layout'
import { LoadingView } from '@/ui/components/StateView'
import { toast, ToastHost } from '@/ui/components/Toast'
import { useDismissOnRelock } from '@/ui/components/hooks'
import { calendarDayDiff, formatDateTimeFull } from '@/ui/components/date'

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default function OralModal() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ lineId?: string | string[]; scheduledAt?: string | string[] }>()
  const paramLineId = firstParam(params.lineId)
  const paramScheduledRaw = firstParam(params.scheduledAt)
  const paramScheduledAt =
    paramScheduledRaw !== undefined && Number.isFinite(Number(paramScheduledRaw))
      ? Number(paramScheduledRaw)
      : null

  const ready = useAppStore((state) => state.ready)
  const treatment = useAppStore((state) => state.treatment)
  const medications = useAppStore((state) => state.medications)
  const doseLogs = useAppStore((state) => state.doseLogs)
  const appLockEnabled = useAppStore((state) => state.settings.app_lock === '1')
  const reload = useAppStore((state) => state.reload)
  const addDoseLog = useAppStore((state) => state.addDoseLog)

  const oralLines = useMemo(
    () => treatment?.lines.filter((item) => item.kind === 'oral') ?? [],
    [treatment],
  )

  const [selectedLineId, setSelectedLineId] = useState<string>(paramLineId ?? '')
  useEffect(() => {
    if (oralLines.length === 0) return
    if (oralLines.some((item) => item.id === selectedLineId)) return
    setSelectedLineId(paramLineId && oralLines.some((item) => item.id === paramLineId)
      ? paramLineId
      : oralLines[0].id)
  }, [oralLines, selectedLineId, paramLineId])

  const line: TreatmentLine | null = useMemo(() => {
    const found = oralLines.find((item) => item.id === selectedLineId)
    return found ?? oralLines[0] ?? null
  }, [oralLines, selectedLineId])

  const medication: Medication | null = useMemo(
    () => (line ? medications.find((item) => item.id === line.medicationId) ?? null : null),
    [line, medications],
  )

  const [takenAt, setTakenAt] = useState<number>(() => Date.now())
  const [note, setNote] = useState<string>('')
  const [saving, setSaving] = useState<'done' | 'skipped' | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) {
      reload().catch((error: unknown) => {
        setFormError(errorMessage(error))
      })
    }
  }, [ready, reload])

  const close = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }

  useDismissOnRelock(close, appLockEnabled)

  // 计划时间：优先用传入的 scheduledAt，否则按所选时间匹配同一天的打卡点。
  const scheduledAt = useMemo(() => {
    if (paramScheduledAt !== null) return paramScheduledAt
    if (!treatment || !line) return null
    try {
      const plans = buildSchedule({ lines: treatment.lines, logs: doseLogs, now: takenAt })
      const match = plans.find(
        (plan) => plan.lineId === line.id && calendarDayDiff(plan.plannedAt, takenAt) === 0,
      )
      return match ? match.plannedAt : null
    } catch {
      return null
    }
  }, [paramScheduledAt, treatment, line, doseLogs, takenAt])

  const submit = async (status: 'done' | 'skipped') => {
    setFormError(null)
    if (!line) {
      setFormError('没有可登记的口服用药。')
      return
    }
    setSaving(status)
    try {
      const payload: DoseLogInput = {
        lineId: line.id,
        scheduledAt,
        takenAt: status === 'done' ? takenAt : null,
        status,
        dose: medication?.defaultDose ?? null,
        unit: medication?.unit && medication.unit.trim() !== '' ? medication.unit : null,
        note: note.trim() === '' ? null : note.trim(),
      }
      const result = await addDoseLog(payload)
      close()
      toast(status === 'done' ? '已记录服用' : '已跳过这次', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      setFormError(errorMessage(error))
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(null)
    }
  }

  const doseLabel =
    medication?.defaultDose !== null && medication?.defaultDose !== undefined
      ? `${medication.defaultDose} ${medication.unit}`
      : null

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
                口服打卡
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
                {oralLines.length > 1 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {oralLines.map((item) => {
                      const selected = item.id === line?.id
                      const label =
                        medications.find((med) => med.id === item.medicationId)?.name ?? item.label
                      return (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={label}
                          accessibilityState={{ selected }}
                          onPress={() => setSelectedLineId(item.id)}
                          style={({ pressed }) => [
                            styles.chip,
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
                            {label}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : null}

                {!line ? (
                  <InlineError message="没有可登记的口服用药，请先在设置里添加口服用药。" />
                ) : (
                  <Card>
                    <View style={{ gap: 4 }}>
                      <Text
                        style={{
                          color: theme.colors.text,
                          fontSize: theme.fontSize.lg,
                          fontWeight: '700',
                        }}
                      >
                        {medication?.name ?? line.label}
                      </Text>
                      {doseLabel ? (
                        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                          剂量 {doseLabel}
                        </Text>
                      ) : null}
                      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                        计划时间：
                        {scheduledAt !== null ? formatDateTimeFull(scheduledAt) : '未匹配到计划时间'}
                      </Text>
                    </View>
                  </Card>
                )}

                <DateTimeField label="服用时间" value={takenAt} onChange={setTakenAt} />

                <TextField
                  label={`${zh.form.note}（${zh.common.optional}）`}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="服用后的感受、漏服原因等"
                  accessibilityLabel="口服备注"
                />

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
              <Button
                label="跳过"
                onPress={() => {
                  void submit('skipped')
                }}
                variant="secondary"
                loading={saving === 'skipped'}
                disabled={!ready || !line || saving !== null}
                style={{ flex: 1 }}
              />
              <Button
                label="完成"
                onPress={() => {
                  void submit('done')
                }}
                loading={saving === 'done'}
                disabled={!ready || !line || saving !== null}
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
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
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
})
