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
import { buildSchedule, selectNextPlan } from '@/domain/schedule'
import { recommendSite } from '@/domain/rotation'
import type { DoseLogInput } from '@/db/repo'
import type { Injection, InjectionSite, Medication } from '@/types'
import { TextField } from '@/ui/components/Field'
import { DateTimeField } from '@/ui/components/TimeField'
import { SitePicker } from '@/ui/components/SitePicker'
import { Icon } from '@/ui/components/Icon'
import { Button } from '@/ui/components/Button'
import { InlineError } from '@/ui/components/Layout'
import { LoadingView } from '@/ui/components/StateView'
import { toast, ToastHost } from '@/ui/components/Toast'
import { useDismissOnRelock } from '@/ui/components/hooks'
import { calendarDayDiff } from '@/ui/components/date'

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseDose(text: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return { ok: false }
  return { ok: true, value }
}

export default function InjectionModal() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string | string[]; lineId?: string | string[] }>()
  const editingId = firstParam(params.id)
  const paramLineId = firstParam(params.lineId)

  const ready = useAppStore((state) => state.ready)
  const treatment = useAppStore((state) => state.treatment)
  const medications = useAppStore((state) => state.medications)
  const doseLogs = useAppStore((state) => state.doseLogs)
  const appLockEnabled = useAppStore((state) => state.settings.app_lock === '1')
  const reload = useAppStore((state) => state.reload)
  const addDoseLog = useAppStore((state) => state.addDoseLog)
  const updateDoseLog = useAppStore((state) => state.updateDoseLog)

  const editing = editingId ? doseLogs.find((item) => item.id === editingId) : undefined

  const [lineId, setLineId] = useState<string>('')
  const [takenAt, setTakenAt] = useState<number>(() => Date.now())
  const [doseText, setDoseText] = useState<string>('')
  const [unit, setUnit] = useState<string>('mg')
  const [site, setSite] = useState<InjectionSite>('abdomen_ul')
  const [lotNumber, setLotNumber] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const injectionLines = useMemo(
    () =>
      treatment?.lines.filter(
        (line) => line.kind === 'injection' && line.endedAt === null,
      ) ?? [],
    [treatment],
  )

  // 可切换的药：本治疗组合里的注射线；编辑记录时锁定原用药线，避免历史记录被改标到另一种药。
  const selectableLines = useMemo(() => {
    if (!treatment) return []
    if (editing) {
      const current = treatment.lines.find((line) => line.id === editing.lineId)
      return current ? [current] : []
    }
    return injectionLines
  }, [treatment, editing, injectionLines])

  const medicationById = useMemo(() => {
    const map = new Map<string, Medication>()
    for (const med of medications) map.set(med.id, med)
    return map
  }, [medications])

  const selectedLine = treatment?.lines.find((line) => line.id === lineId) ?? null
  const selectedMedication = selectedLine
    ? medicationById.get(selectedLine.medicationId) ?? null
    : null
  const route = selectedMedication?.route ?? 'sc'

  const siteHistory = useMemo(
    () =>
      doseLogs
        .filter((log) => log.site !== null)
        .map((log) => ({
          site: log.site as InjectionSite,
          injectedAt: log.takenAt ?? log.scheduledAt ?? log.createdAt,
        })),
    [doseLogs],
  )
  const recommended = useMemo(() => recommendSite(siteHistory as Injection[]), [siteHistory])

  const nextPlanFor = (targetLineId: string) => {
    if (!treatment) return null
    try {
      const now = Date.now()
      const plans = buildSchedule({ lines: treatment.lines, logs: doseLogs, now })
      const linePlans = plans.filter((plan) => plan.lineId === targetLineId)
      return selectNextPlan(linePlans, now)
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!ready) {
      reload().catch((error: unknown) => {
        setFormError(errorMessage(error))
      })
    }
  }, [ready, reload])

  useEffect(() => {
    if (!ready || initialized || !treatment) return
    if (editing) {
      const line = treatment.lines.find((item) => item.id === editing.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      setLineId(editing.lineId)
      setTakenAt(editing.takenAt ?? Date.now())
      setDoseText(editing.dose !== null ? String(editing.dose) : '')
      setUnit(editing.unit || medication?.unit || 'mg')
      setSite(editing.site ?? recommended)
      setLotNumber(editing.lotNumber ?? '')
      setNote(editing.note ?? '')
      setInitialized(true)
      return
    }

    const preferred =
      (paramLineId ? injectionLines.find((line) => line.id === paramLineId) : undefined) ??
      injectionLines.find((line) => line.isHost) ??
      injectionLines[0] ??
      null
    if (preferred) {
      const medication = medicationById.get(preferred.medicationId)
      const plan = nextPlanFor(preferred.id)
      const dose = plan?.dose ?? medication?.defaultDose ?? null
      setLineId(preferred.id)
      setDoseText(dose !== null ? String(dose) : '')
      setUnit(plan?.unit || medication?.unit || 'mg')
    }
    setSite(recommended)
    setInitialized(true)
    // 只在首次拿到数据时回填；后续切换用药由 selectLine 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialized, editing, treatment, injectionLines, paramLineId, medicationById, recommended])

  const close = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }

  useDismissOnRelock(close, appLockEnabled)

  const selectLine = (id: string) => {
    const line = treatment?.lines.find((item) => item.id === id)
    if (!line) return
    const medication = medicationById.get(line.medicationId)
    const plan = nextPlanFor(line.id)
    const dose = plan?.dose ?? medication?.defaultDose ?? null
    setLineId(id)
    setDoseText(dose !== null ? String(dose) : '')
    setUnit(plan?.unit || medication?.unit || 'mg')
    if (medication?.route === 'iv' || medication?.route === 'oral') setSite('abdomen_ul')
  }

  const matchScheduledAt = (targetLineId: string, at: number): number | null => {
    if (!treatment) return null
    try {
      const logs = editing ? doseLogs.filter((log) => log.id !== editing.id) : doseLogs
      const plans = buildSchedule({ lines: treatment.lines, logs, now: at })
      const match = plans.find(
        (plan) => plan.lineId === targetLineId && calendarDayDiff(plan.plannedAt, at) === 0,
      )
      return match ? match.plannedAt : null
    } catch {
      return null
    }
  }

  const save = async () => {
    setFormError(null)
    if (!treatment) {
      setFormError('还没有治疗方案，请先在设置中完成配置。')
      return
    }
    if (!selectedLine) {
      setFormError('请选择要登记的用药。')
      return
    }
    if (unit.trim() === '') {
      setFormError('单位不能为空。')
      return
    }
    const dose = parseDose(doseText)
    if (!dose.ok) {
      setFormError('剂量必须是大于或等于 0 的数字。')
      return
    }
    if (!Number.isFinite(takenAt) || takenAt <= 0) {
      setFormError('注射时间不合法。')
      return
    }

    const isSc = selectedMedication?.route === 'sc'
    const payload: DoseLogInput = {
      lineId: selectedLine.id,
      scheduledAt: matchScheduledAt(selectedLine.id, takenAt),
      takenAt,
      status: 'done',
      dose: dose.value,
      unit: unit.trim(),
      site: isSc ? site : null,
      lotNumber: lotNumber.trim() === '' ? null : lotNumber.trim(),
      note: note.trim() === '' ? null : note.trim(),
    }

    setSaving(true)
    try {
      const result = editing
        ? await updateDoseLog(editing.id, {
            scheduledAt: payload.scheduledAt,
            takenAt: payload.takenAt,
            status: payload.status,
            dose: payload.dose,
            unit: payload.unit,
            site: payload.site,
            lotNumber: payload.lotNumber,
            note: payload.note,
          })
        : await addDoseLog(payload)
      close()
      toast(editing ? '注射记录已更新' : '已记录，下次提醒已更新', 'success')
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
                {editing ? '编辑注射记录' : zh.today.registerInjection}
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
                {!treatment && !editing ? (
                  <InlineError message="还没有治疗方案，请先在设置里完成配置后再登记注射。" />
                ) : null}

                <DateTimeField
                  label={zh.form.injectedAt}
                  value={takenAt}
                  onChange={setTakenAt}
                />

                <View style={{ gap: 8 }}>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.fontSize.sm,
                      fontWeight: '500',
                    }}
                  >
                    {zh.form.medicationName}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                      {selectableLines.map((line) => {
                        const medication = medicationById.get(line.medicationId)
                        const selected = line.id === lineId
                        return (
                          <Pressable
                            key={line.id}
                            accessibilityRole="button"
                            accessibilityLabel={medication?.name ?? line.label}
                            accessibilityState={{ selected }}
                            onPress={() => selectLine(line.id)}
                            style={({ pressed }) => [
                              styles.medChip,
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
                                color: selected ? theme.colors.primary : theme.colors.text,
                                fontSize: theme.fontSize.sm,
                                fontWeight: selected ? '600' : '400',
                              }}
                            >
                              {medication?.name ?? line.label}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </ScrollView>
                  {selectedMedication?.genericName ? (
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                      通用名 {selectedMedication.genericName}
                    </Text>
                  ) : null}
                </View>

                <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={zh.form.dose}
                      value={doseText}
                      onChangeText={setDoseText}
                      keyboardType="decimal-pad"
                      placeholder="40"
                      accessibilityLabel="注射剂量"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={zh.form.unit}
                      value={unit}
                      onChangeText={setUnit}
                      placeholder="mg"
                      accessibilityLabel="剂量单位"
                    />
                  </View>
                </View>

                {route === 'sc' ? (
                  <View style={{ gap: 8 }}>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        fontWeight: '500',
                      }}
                    >
                      {zh.form.site}
                    </Text>
                    <SitePicker value={site} onChange={setSite} recommended={recommended} />
                  </View>
                ) : (
                  <View
                    style={{
                      backgroundColor: theme.colors.primaryMuted,
                      borderRadius: theme.radius.md,
                      padding: theme.spacing.md,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.colors.primary,
                        fontSize: theme.fontSize.sm,
                        lineHeight: theme.lineHeight.md,
                      }}
                    >
                      {route === 'oral'
                        ? '这是口服用药，不需要记录注射部位。'
                        : '这是静脉输注药物，通常在医院完成，不需要记录注射部位。'}
                    </Text>
                  </View>
                )}

                <TextField
                  label={`${zh.form.lotNumber}（${zh.common.optional}）`}
                  value={lotNumber}
                  onChangeText={setLotNumber}
                  placeholder="药盒上的批号"
                  accessibilityLabel="药品批号"
                />

                <TextField
                  label={`${zh.form.note}（${zh.common.optional}）`}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="注射后的感受、异常情况等"
                  accessibilityLabel="注射备注"
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
              <Button label={zh.common.cancel} onPress={close} variant="secondary" style={{ flex: 1 }} />
              <Button
                label={editing ? zh.common.save : '保存记录'}
                onPress={() => {
                  void save()
                }}
                loading={saving}
                disabled={!ready || (!treatment && !editing)}
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
  medChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
  },
})
