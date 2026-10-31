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
import type { InjectionSite } from '@/types'
import { recommendSite } from '@/domain/rotation'
import { TextField } from '@/ui/components/Field'
import { DateTimeField } from '@/ui/components/TimeField'
import { SitePicker } from '@/ui/components/SitePicker'
import { Icon } from '@/ui/components/Icon'
import { Button } from '@/ui/components/Button'
import { InlineError } from '@/ui/components/Layout'
import { LoadingView } from '@/ui/components/StateView'
import { toast, ToastHost } from '@/ui/components/Toast'
import { useDismissOnRelock } from '@/ui/components/hooks'

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
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const editingId = Array.isArray(params.id) ? params.id[0] : params.id

  const ready = useAppStore((state) => state.ready)
  const regimen = useAppStore((state) => state.regimen)
  const medication = useAppStore((state) => state.medication)
  const medications = useAppStore((state) => state.medications)
  const injections = useAppStore((state) => state.injections)
  const appLockEnabled = useAppStore((state) => state.settings.app_lock === '1')
  const reload = useAppStore((state) => state.reload)
  const addInjection = useAppStore((state) => state.addInjection)
  const updateInjection = useAppStore((state) => state.updateInjection)

  const editing = editingId ? injections.find((item) => item.id === editingId) : undefined

  const [injectedAt, setInjectedAt] = useState<number>(() => Date.now())
  const [medicationId, setMedicationId] = useState<string>('')
  const [doseText, setDoseText] = useState<string>('')
  const [unit, setUnit] = useState<string>('mg')
  const [site, setSite] = useState<InjectionSite>('abdomen_ul')
  const [lotNumber, setLotNumber] = useState<string>('')
  const [note, setNote] = useState<string>('')
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
      setInjectedAt(editing.injectedAt)
      setMedicationId(editing.medicationId)
      setDoseText(editing.dose !== null ? String(editing.dose) : '')
      setUnit(editing.unit)
      setSite(editing.site)
      setLotNumber(editing.lotNumber ?? '')
      setNote(editing.note ?? '')
      setInitialized(true)
      return
    }
    if (medication) {
      setMedicationId(medication.id)
      setDoseText(medication.defaultDose !== null ? String(medication.defaultDose) : '')
      setUnit(medication.unit)
    }
    setSite(recommendSite(injections))
    setInitialized(true)
  }, [ready, initialized, editing, medication, injections])

  const selectedMedication = useMemo(() => {
    return medications.find((item) => item.id === medicationId) ?? null
  }, [medications, medicationId])

  const route = selectedMedication?.route ?? medication?.route ?? 'sc'
  const recommended = useMemo(() => recommendSite(injections), [injections])

  const close = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }

  useDismissOnRelock(close, appLockEnabled)

  const selectMedication = (id: string) => {
    const next = medications.find((item) => item.id === id)
    if (!next) return
    setMedicationId(id)
    setUnit(next.unit)
    setDoseText(next.defaultDose !== null ? String(next.defaultDose) : '')
    if (next.route === 'iv') setSite('abdomen_ul')
  }

  const save = async () => {
    setFormError(null)
    const targetRegimenId = editing?.regimenId ?? regimen?.id
    if (!targetRegimenId) {
      setFormError('还没有用药方案，请先在设置中完成配置。')
      return
    }
    if (!medicationId) {
      setFormError('请选择药物。')
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
    if (!Number.isFinite(injectedAt) || injectedAt <= 0) {
      setFormError('注射时间不合法。')
      return
    }

    const payload = {
      regimenId: targetRegimenId,
      medicationId,
      injectedAt,
      dose: dose.value,
      unit: unit.trim(),
      site: route === 'iv' ? ('abdomen_ul' as InjectionSite) : site,
      lotNumber: lotNumber.trim() === '' ? null : lotNumber.trim(),
      note: note.trim() === '' ? null : note.trim(),
    }

    setSaving(true)
    try {
      const result = editing
        ? await updateInjection(editing.id, payload)
        : await addInjection(payload)
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
                {!regimen && !editing ? (
                  <InlineError message="还没有用药方案，请先在设置里完成配置后再登记注射。" />
                ) : null}
                <DateTimeField
                  label={zh.form.injectedAt}
                  value={injectedAt}
                  onChange={setInjectedAt}
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
                      {medications.map((item) => {
                        const selected = item.id === medicationId
                        return (
                          <Pressable
                            key={item.id}
                            accessibilityRole="button"
                            accessibilityLabel={item.name}
                            accessibilityState={{ selected }}
                            onPress={() => selectMedication(item.id)}
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
                              {item.name}
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
                      这是静脉输注药物，通常在医院完成，不需要记录注射部位。
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
                disabled={!ready || (!regimen && !editing)}
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
