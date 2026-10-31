import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type DimensionValue,
} from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import * as LocalAuthentication from 'expo-local-authentication'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import { resetDatabase } from '@/db'
import { regimens as regimenRepo } from '@/db/repo'
import { cancelAll, rescheduleAll } from '@/notify/scheduler'
import { exportCsv, exportPdf, shareFile } from '@/export'
import { DISEASE_GROUPS, diseasesByGroup } from '@/data/diseases'
import type { Disease, Regimen } from '@/types'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Chip } from '@/ui/components/Chip'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { TextField } from '@/ui/components/Field'
import { Screen, ScreenHeader, ScrollArea, SectionTitle } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { TimeOfDayField } from '@/ui/components/TimeField'
import { toast, ToastHost } from '@/ui/components/Toast'
import { formatDate } from '@/ui/components/date'

const PDF_RANGES = [90, 180, 365]

function RowGroup({ children }: { children: ReactNode }) {
  return <Card padding={false}>{children}</Card>
}

function SettingRow({
  label,
  hint,
  value,
  onPress,
  right,
  destructive = false,
  last = false,
}: {
  label: string
  hint?: string
  value?: string
  onPress?: () => void
  right?: ReactNode
  destructive?: boolean
  last?: boolean
}) {
  const theme = useTheme()
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            color: destructive ? theme.colors.danger : theme.colors.text,
            fontSize: theme.fontSize.md,
            fontWeight: '500',
          }}
        >
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }}>›</Text>
      ) : null}
    </>
  )

  const rowStyle = {
    minHeight: 56,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  }

  if (!onPress) return <View style={rowStyle}>{content}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' }]}
    >
      {content}
    </Pressable>
  )
}

function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
  last = false,
}: {
  label: string
  hint?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  last?: boolean
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '500' }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
        thumbColor={theme.colors.surface}
      />
    </View>
  )
}

function BottomSheet({
  visible,
  title,
  onClose,
  children,
  height = '75%',
}: {
  visible: boolean
  title: string
  onClose: () => void
  children: ReactNode
  height?: DimensionValue
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.sheetOverlay, { backgroundColor: theme.colors.overlay }]}
      >
        <View
          style={{
            height,
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
              style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.xl, fontWeight: '700' }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zh.common.close}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  borderRadius: theme.radius.pill,
                  backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                },
              ]}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xl }}>✕</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>{children}</View>
        </View>
        <ToastHost />
      </KeyboardAvoidingView>
    </Modal>
  )
}

type DiseaseRow =
  | { type: 'header'; key: string; title: string }
  | { type: 'disease'; key: string; disease: Disease }

export default function SettingsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const ready = useAppStore((state) => state.ready)
  const regimen = useAppStore((state) => state.regimen)
  const medication = useAppStore((state) => state.medication)
  const disease = useAppStore((state) => state.disease)
  const settings = useAppStore((state) => state.settings)
  const reminder = useAppStore((state) => state.reminder)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)
  const updateReminder = useAppStore((state) => state.updateReminder)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const [reminderTime, setReminderTime] = useState('09:00')
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([-2, -1, 0])
  const [snoozeMinutes, setSnoozeMinutes] = useState(10)
  const [savingReminder, setSavingReminder] = useState(false)
  const [savingDnd, setSavingDnd] = useState(false)
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('08:00')

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [regimenList, setRegimenList] = useState<Regimen[]>([])
  const [loadingRegimens, setLoadingRegimens] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const [diseaseOpen, setDiseaseOpen] = useState(false)
  const [diseaseSaving, setDiseaseSaving] = useState(false)

  const [lockBusy, setLockBusy] = useState(false)

  const [pdfOpen, setPdfOpen] = useState(false)
  const [patientName, setPatientName] = useState('')
  const [rangeDays, setRangeDays] = useState(180)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  const [disclaimerOpen, setDisclaimerOpen] = useState(false)
  const [clearStage, setClearStage] = useState<0 | 1 | 2>(0)
  const [clearing, setClearing] = useState(false)

  const reminderOffsetsKey = reminder?.offsets.join(',') ?? ''

  useEffect(() => {
    if (reminder) {
      setReminderTime(reminder.timeOfDay)
      setReminderOffsets(reminder.offsets)
      setSnoozeMinutes(reminder.snoozeMinutes)
    }
    // 只在提醒规则本身变化时同步草稿，避免无关的数据刷新覆盖未保存的编辑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reminder?.id,
    reminder?.timeOfDay,
    reminderOffsetsKey,
    reminder?.snoozeMinutes,
    reminder?.enabled,
  ])

  useEffect(() => {
    setDndStart(settings.dnd_start ?? '22:00')
    setDndEnd(settings.dnd_end ?? '08:00')
  }, [settings.dnd_start, settings.dnd_end])

  useEffect(() => {
    if (!ready) {
      reload().catch((error: unknown) => {
        toast(errorMessage(error), 'error')
      })
    }
  }, [ready, reload])

  const refresh = useCallback(() => {
    reload().catch((error: unknown) => {
      toast(errorMessage(error), 'error')
    })
  }, [reload])

  const diseaseRows = useMemo<DiseaseRow[]>(() => {
    const rows: DiseaseRow[] = []
    for (const group of DISEASE_GROUPS) {
      rows.push({ type: 'header', key: `group-${group.id}`, title: group.name })
      for (const item of diseasesByGroup(group.id)) {
        rows.push({ type: 'disease', key: item.id, disease: item })
      }
    }
    return rows
  }, [])

  const openSwitcher = async () => {
    setSwitcherOpen(true)
    setLoadingRegimens(true)
    try {
      const list = await regimenRepo.list()
      setRegimenList(list)
    } catch (error) {
      setSwitcherOpen(false)
      toast(errorMessage(error), 'error')
    } finally {
      setLoadingRegimens(false)
    }
  }

  const activateRegimen = async (target: Regimen) => {
    if (!target.isActive) {
      setSwitchingId(target.id)
      try {
        await regimenRepo.setActive(target.id, true)
        let warning: string | null = null
        try {
          await rescheduleAll()
        } catch (error) {
          warning = `提醒更新失败：${errorMessage(error)}`
        }
        await reload()
        setSwitcherOpen(false)
        toast('已切换当前方案', 'success')
        if (warning) toast(warning, 'error')
      } catch (error) {
        toast(errorMessage(error), 'error')
      } finally {
        setSwitchingId(null)
      }
    } else {
      setSwitcherOpen(false)
    }
  }

  const deactivateRegimen = async () => {
    if (!regimen) return
    setDeactivating(true)
    try {
      await regimenRepo.setActive(regimen.id, false)
      let warning: string | null = null
      try {
        await cancelAll()
      } catch (error) {
        warning = `取消提醒失败：${errorMessage(error)}`
      }
      await reload()
      setDeactivateOpen(false)
      toast('当前方案已停用', 'success')
      if (warning) toast(warning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setDeactivating(false)
    }
  }

  const chooseDisease = async (item: Disease) => {
    if (item.id === settings.disease_id) {
      setDiseaseOpen(false)
      return
    }
    setDiseaseSaving(true)
    try {
      const result = await updateSettings({ disease_id: item.id })
      setDiseaseOpen(false)
      toast('病种已切换', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setDiseaseSaving(false)
    }
  }

  const saveReminder = async () => {
    if (!reminder) {
      toast('尚未设置提醒，请先完成方案配置', 'error')
      return
    }    if (reminderOffsets.length === 0) {
      toast('至少选择一个提前提醒时间', 'error')
      return
    }
    setSavingReminder(true)
    try {
      const result = await updateReminder({
        regimenId: reminder.regimenId,
        offsets: reminderOffsets,
        timeOfDay: reminderTime,
        snoozeMinutes,
        enabled: reminder.enabled,
      })
      toast('提醒设置已保存', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSavingReminder(false)
    }
  }

  const createDefaultReminder = async () => {
    if (!regimen) return
    try {
      const result = await updateReminder({
        regimenId: regimen.id,
        offsets: [-2, -1, 0],
        timeOfDay: '09:00',
        snoozeMinutes: 10,
        enabled: true,
      })
      toast('已创建默认提醒', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const toggleReminder = async (enabled: boolean) => {
    if (!reminder) return
    try {
      const result = await updateReminder({
        regimenId: reminder.regimenId,
        offsets: reminderOffsets.length > 0 ? reminderOffsets : reminder.offsets,
        timeOfDay: reminderTime,
        snoozeMinutes,
        enabled,
      })
      toast(enabled ? '提醒已开启' : '提醒已关闭', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const saveDnd = async () => {
    setSavingDnd(true)
    try {
      const result = await updateSettings({ dnd_start: dndStart, dnd_end: dndEnd })
      toast('免打扰时段已保存', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSavingDnd(false)
    }
  }

  const toggleAppLock = async (next: boolean) => {
    if (lockBusy) return
    setLockBusy(true)
    try {
      if (next) {
        const hasHardware = await LocalAuthentication.hasHardwareAsync()
        if (!hasHardware) throw new Error('此设备不支持生物识别，无法开启应用锁。')
        const enrolled = await LocalAuthentication.isEnrolledAsync()
        if (!enrolled) throw new Error('请先在系统设置中录入指纹或面容。')
      }
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: next ? '开启应用锁' : '关闭应用锁',
        cancelLabel: zh.common.cancel,
        disableDeviceFallback: false,
      })
      if (!auth.success) {
        toast('未通过身份验证，应用锁未变更', 'error')
        return
      }
      const result = await updateSettings({ app_lock: next ? '1' : '0' })
      toast(next ? '应用锁已开启' : '应用锁已关闭', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setLockBusy(false)
    }
  }

  const doExportCsv = async () => {
    setExportingCsv(true)
    try {
      const file = await exportCsv()
      await shareFile(file.path)
      toast(zh.disclaimer.exportWarning, 'default')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setExportingCsv(false)
    }
  }

  const openPdf = () => {
    setPatientName(settings.patient_name ?? '')
    setRangeDays(180)
    setPdfOpen(true)
  }

  const doExportPdf = async () => {
    setExportingPdf(true)
    try {
      const name = patientName.trim()
      if (name !== (settings.patient_name ?? '')) {
        const nameResult = await updateSettings({ patient_name: name })
        if (nameResult.notifyWarning) toast(nameResult.notifyWarning, 'error')
      }
      const file = await exportPdf({ patientName: name === '' ? undefined : name, rangeDays })
      await shareFile(file.path)
      setPdfOpen(false)
      toast(zh.disclaimer.exportWarning, 'default')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  const doClearAll = async () => {
    setClearing(true)
    try {
      await resetDatabase()
    } catch (error) {
      toast(errorMessage(error), 'error')
      setClearing(false)
      return
    }

    let warning: string | null = null
    try {
      await cancelAll()
    } catch (error) {
      warning = `取消提醒失败：${errorMessage(error)}`
    }
    try {
      await reload()
    } catch (error) {
      warning = warning
        ? `${warning}；刷新失败：${errorMessage(error)}`
        : `刷新失败：${errorMessage(error)}`
    }

    setClearing(false)
    setClearStage(0)
    router.replace('/onboarding')
    toast('已清空全部数据', 'success')
    if (warning) toast(warning, 'error')
  }

  const version = Constants.expoConfig?.version ?? '1.0.0'

  return (
    <Screen>
      <ScreenHeader title={zh.settings.title} subtitle={disease ? disease.name : undefined} />
      <ScrollArea
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: 40,
          gap: theme.spacing.md,
        }}
      >
        <SectionTitle title={zh.settings.regimenSection} />
        {regimen ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}>
                {regimen.name}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                {medication ? medication.name : zh.common.unknown}
                {medication?.genericName && medication.genericName !== medication.name
                  ? `（${medication.genericName}）`
                  : ''}
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                {regimen.anchor === 'actual' ? zh.settings.anchorActual : zh.settings.anchorPlanned} ·
                按时窗口 ±{regimen.windowDays} 天
              </Text>
              <View style={{ gap: 4, marginTop: theme.spacing.xs }}>
                {regimen.phases.map((phase, index) => (
                  <Text
                    key={phase.id}
                    style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}
                  >
                    阶段 {index + 1} · {phase.kind === 'loading' ? zh.settings.phaseLoading : zh.settings.phaseMaintenance} ·
                    每 {phase.intervalDays} 天
                    {phase.repeatCount === 0 ? '（长期）' : ` × ${phase.repeatCount}`}
                    {phase.dose !== null ? ` · ${phase.dose} ${phase.unit}` : ''}
                  </Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
                <Button
                  label="切换方案"
                  onPress={() => {
                    void openSwitcher()
                  }}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
                <Button
                  label="停用方案"
                  onPress={() => setDeactivateOpen(true)}
                  variant="danger"
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </Card>
        ) : (
          <Card>
            <StateView
              glyph="＋"
              title={zh.empty.todayNoRegimen}
              message="先选择病种、药物与注射间隔。"
              actionLabel="去设置"
              onAction={() => router.push('/onboarding')}
              compact
            />
          </Card>
        )}

        <SectionTitle title="病种" hint="切换后会影响新建方案时的药物列表" />
        <RowGroup>
          <SettingRow
            label={disease?.name ?? '未选择病种'}
            value="更改"
            onPress={() => setDiseaseOpen(true)}
            last
          />
        </RowGroup>

        <SectionTitle title={zh.settings.reminderSection} />
        <RowGroup>
          <SwitchRow
            label={zh.settings.reminderEnabled}
            value={reminder?.enabled ?? false}
            onValueChange={(value) => {
              void toggleReminder(value)
            }}
            disabled={!reminder}
            hint={reminder ? undefined : zh.empty.settingsNoReminder}
            last={!reminder}
          />
          {!reminder && regimen ? (
            <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: 6 }}>
              <Button
                label="创建默认提醒"
                onPress={() => {
                  void createDefaultReminder()
                }}
                variant="secondary"
              />
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                09:00 · 提前 2 / 1 / 0 天
              </Text>
            </View>
          ) : null}
          {reminder ? (
            <View
              style={{
                padding: theme.spacing.lg,
                gap: theme.spacing.md,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.border,
              }}
            >
              <TimeOfDayField
                label={zh.settings.reminderTime}
                value={reminderTime}
                onChange={setReminderTime}
              />
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                  {zh.settings.reminderOffsets}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    { value: -3, label: '提前 3 天' },
                    { value: -2, label: '提前 2 天' },
                    { value: -1, label: '提前 1 天' },
                    { value: 0, label: '当天' },
                  ].map((item) => (
                    <Chip
                      key={item.value}
                      label={item.label}
                      selected={reminderOffsets.includes(item.value)}
                      onPress={() =>
                        setReminderOffsets((current) =>
                          current.includes(item.value)
                            ? current.filter((offset) => offset !== item.value)
                            : [...current, item.value].sort((a, b) => a - b),
                        )
                      }
                    />
                  ))}
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Text style={{ flex: 1, color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                  {zh.settings.snoozeMinutes}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="稍后提醒分钟数减少"
                    onPress={() => setSnoozeMinutes((value) => Math.max(0, value - 5))}
                    style={({ pressed }) => [
                      styles.miniButton,
                      {
                        borderColor: theme.colors.border,
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.colors.surfaceMuted,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.text }}>−</Text>
                  </Pressable>
                  <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, minWidth: 36, textAlign: 'center' }}>
                    {snoozeMinutes}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="稍后提醒分钟数增加"
                    onPress={() => setSnoozeMinutes((value) => Math.min(60, value + 5))}
                    style={({ pressed }) => [
                      styles.miniButton,
                      {
                        borderColor: theme.colors.border,
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.colors.surfaceMuted,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.text }}>＋</Text>
                  </Pressable>
                </View>
              </View>
              <Button
                label="保存提醒设置"
                onPress={() => {
                  void saveReminder()
                }}
                loading={savingReminder}
                variant="secondary"
              />
            </View>
          ) : null}
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
              免打扰时段
            </Text>
            <View style={{ gap: theme.spacing.md }}>
              <TimeOfDayField label="开始" value={dndStart} onChange={setDndStart} />
              <TimeOfDayField label="结束" value={dndEnd} onChange={setDndEnd} />
            </View>
            <Button
              label="保存免打扰时段"
              onPress={() => {
                void saveDnd()
              }}
              loading={savingDnd}
              variant="secondary"
            />
          </View>
        </RowGroup>

        <SectionTitle title={zh.settings.securitySection} />
        <RowGroup>
          <SwitchRow
            label={zh.settings.appLock}
            hint={lockBusy ? '正在验证身份…' : zh.settings.appLockHint}
            value={settings.app_lock === '1'}
            onValueChange={(value) => {
              void toggleAppLock(value)
            }}
            disabled={lockBusy}
            last
          />
        </RowGroup>

        <SectionTitle title={zh.settings.exportSection} hint={zh.disclaimer.exportWarning} />
        <RowGroup>
          <SettingRow
            label={zh.settings.exportCsv}
            hint="全部注射与症状原始数据"
            value={exportingCsv ? '导出中…' : undefined}
            onPress={
              exportingCsv
                ? undefined
                : () => {
                    void doExportCsv()
                  }
            }
          />
          <SettingRow
            label={zh.settings.exportPdf}
            hint="可填写姓名，生成就诊报告"
            onPress={openPdf}
            last
          />
        </RowGroup>

        <SectionTitle title={zh.settings.aboutSection} />
        <RowGroup>
          <SettingRow label={zh.settings.disclaimer} onPress={() => setDisclaimerOpen(true)} />
          <SettingRow label={zh.settings.version} value={version} last />
        </RowGroup>

        <RowGroup>
          <SettingRow
            label={zh.settings.clearData}
            hint="删除全部注射、症状与方案，内置药物保留"
            destructive
            onPress={() => setClearStage(1)}
            last
          />
        </RowGroup>

        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            lineHeight: theme.lineHeight.xs,
            textAlign: 'center',
            paddingTop: theme.spacing.sm,
          }}
        >
          {zh.disclaimer.short}
        </Text>
      </ScrollArea>

      <BottomSheet visible={switcherOpen} title="切换用药方案" onClose={() => setSwitcherOpen(false)}>
        {loadingRegimens ? (
          <StateView glyph="◔" title="正在加载方案…" compact />
        ) : (
          <FlatList<Regimen>
            data={regimenList}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: 8 }}
            renderItem={({ item }) => {
              const active = item.id === regimen?.id
              const busy = switchingId === item.id
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityState={{ selected: active, busy }}
                  disabled={switchingId !== null}
                  onPress={() => {
                    void activateRegimen(item)
                  }}
                  style={({ pressed }) => [
                    styles.listRow,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primaryMuted : theme.colors.surface,
                      borderRadius: theme.radius.md,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
                      {item.name}
                    </Text>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                      创建于 {formatDate(item.createdAt)} · {item.phases.length} 个阶段
                    </Text>
                  </View>
                  {busy ? (
                    <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm }}>切换中…</Text>
                  ) : active ? (
                    <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
                      当前
                    </Text>
                  ) : (
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }}>›</Text>
                  )}
                </Pressable>
              )
            }}
            ListEmptyComponent={<StateView glyph="◔" title="暂无其他方案" compact />}
          />
        )}
      </BottomSheet>

      <BottomSheet visible={diseaseOpen} title="切换病种" onClose={() => setDiseaseOpen(false)}>
        <FlatList<DiseaseRow>
          data={diseaseRows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: 8 }}
          ListHeaderComponent={
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: theme.fontSize.xs,
                lineHeight: theme.lineHeight.xs,
                paddingBottom: theme.spacing.sm,
              }}
            >
              切换病种只会改变新建方案时的药物列表，当前方案与已有记录保持不变。
            </Text>
          }
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <Text
                  accessibilityRole="header"
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.sm,
                    fontWeight: '600',
                    marginTop: theme.spacing.sm,
                  }}
                >
                  {item.title}
                </Text>
              )
            }
            const selected = item.disease.id === settings.disease_id
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.disease.name}
                accessibilityState={{ selected, disabled: diseaseSaving }}
                disabled={diseaseSaving}
                onPress={() => {
                  void chooseDisease(item.disease)
                }}
                style={({ pressed }) => [
                  styles.listRow,
                  {
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                    borderRadius: theme.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}>
                  {item.disease.name}
                </Text>
                {selected ? (
                  <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
                    当前
                  </Text>
                ) : (
                  <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }}>›</Text>
                )}
              </Pressable>
            )
          }}
        />
      </BottomSheet>

      <BottomSheet visible={pdfOpen} title={zh.settings.exportPdf} onClose={() => setPdfOpen(false)} height="80%">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.md }}
        >
          <TextField
            label={`${zh.form.patientName}（${zh.common.optional}）`}
            value={patientName}
            onChangeText={setPatientName}
            placeholder="用于报告抬头"
            accessibilityLabel="患者姓名"
          />
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              {zh.form.rangeDays}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {PDF_RANGES.map((days) => (
                <Chip
                  key={days}
                  label={`${days} 天`}
                  selected={rangeDays === days}
                  onPress={() => setRangeDays(days)}
                />
              ))}
            </View>
          </View>
          <Text
            style={{
              color: theme.colors.warning,
              fontSize: theme.fontSize.xs,
              lineHeight: theme.lineHeight.xs,
            }}
          >
            {zh.disclaimer.exportWarning}
          </Text>
          <Button
            label="生成并分享 PDF"
            onPress={() => {
              void doExportPdf()
            }}
            loading={exportingPdf}
            size="lg"
          />
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={disclaimerOpen}
        title={zh.disclaimer.title}
        onClose={() => setDisclaimerOpen(false)}
        height="80%"
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.fontSize.md,
              lineHeight: theme.lineHeight.xl,
            }}
          >
            {zh.disclaimer.body}
          </Text>
          <Button
            label={zh.common.close}
            onPress={() => setDisclaimerOpen(false)}
            variant="secondary"
            style={{ marginTop: theme.spacing.lg }}
          />
        </ScrollView>
      </BottomSheet>

      <ConfirmDialog
        visible={clearStage > 0}
        title={clearStage === 1 ? zh.settings.clearDataTitle : '最后确认'}
        message={
          clearStage === 1
            ? zh.settings.clearDataMessage
            : '所有记录将被永久删除，且无法恢复。确定继续吗？'
        }
        confirmLabel={clearStage === 1 ? '继续' : '清空全部数据'}
        destructive
        busy={clearing}
        onCancel={() => {
          if (!clearing) setClearStage(0)
        }}
        onConfirm={() => {
          if (clearStage === 1) {
            setClearStage(2)
          } else {
            void doClearAll()
          }
        }}
      />
      <ConfirmDialog
        visible={deactivateOpen}
        title="停用当前方案？"
        message="停用后会取消所有已排程的提醒，历史记录仍会保留。可以随时在「切换方案」里重新启用。"
        confirmLabel="停用"
        destructive
        busy={deactivating}
        onCancel={() => {
          if (!deactivating) setDeactivateOpen(false)
        }}
        onConfirm={() => {
          void deactivateRegimen()
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    padding: 14,
    minHeight: 60,
  },
})
