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
import * as DocumentPicker from 'expo-document-picker'
import { readAsStringAsync } from 'expo-file-system/legacy'
import * as LocalAuthentication from 'expo-local-authentication'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'
import type { ThemeMode } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import {
  useAppStore,
  errorMessage,
  type SaveTreatmentInput,
  type TreatmentLineDraft,
} from '@/store/app'
import { resetDatabase } from '@/db'
import { cancelAll, ensurePermissions } from '@/notify/scheduler'
import { exportCsv, exportExcel, exportJson, exportPdf, shareFile } from '@/export'
import { previewImport, type ImportResult } from '@/import'
import { parseImportJson, type ImportPayload } from '@/import/schema'
import { parseSpreadsheet } from '@/import/spreadsheet'
import { DISEASE_GROUPS, diseasesByGroup, resolveDiseaseIds } from '@/data/diseases'
import type {
  Disease,
  EfficacyEvent,
  EfficacyKind,
  LineKind,
  Medication,
  OralFrequency,
  PhaseKind,
  RegimenAnchor,
  Treatment,
  TreatmentLine,
} from '@/types'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Chip } from '@/ui/components/Chip'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { TextField } from '@/ui/components/Field'
import { Icon } from '@/ui/components/Icon'
import { Screen, ScreenHeader, ScrollArea, SectionTitle, InlineError } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { SymptomTagManager } from '@/ui/components/SymptomFields'
import { MedicationManager } from '@/ui/components/MedicationManager'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Stepper } from '@/ui/components/Stepper'
import { DateTimeField, TimeOfDayField } from '@/ui/components/TimeField'
import { toast, ToastHost } from '@/ui/components/Toast'
import { formatDate } from '@/ui/components/date'

const PDF_RANGES = [90, 180, 365]

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

const EFFICACY_KIND_OPTIONS: Array<{ value: EfficacyKind; label: string }> = [
  { value: 'reduced', label: '疗效下降' },
  { value: 'failed', label: '疗效失效' },
  { value: 'intolerance', label: '不耐受' },
  { value: 'antibody', label: '抗药抗体' },
  { value: 'other', label: '其他' },
]

function efficacyKindLabel(kind: EfficacyKind): string {
  return EFFICACY_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? '其他'
}

/** 口服频次的人类可读描述：每周 N 次 / 每周固定几天 / 每天。 */
function oralFrequencyText(oral: {
  frequency: OralFrequency
  timesPerPeriod: number
  daysOfWeek: number[]
}): string {
  if (oral.frequency === 'daily') return '每天'
  if (oral.frequency === 'weekly') return `每周 ${oral.timesPerPeriod} 次`
  const days = [...oral.daysOfWeek]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day])
    .join('、')
  return days === '' ? '自定义' : `每周 ${days}`
}

/**
 * 读取 DocumentPicker 选中的文件。
 *
 * Expo Go 里 expo-file-system 会拒绝读取 DocumentPicker 复制到缓存的文件
 * （Missing 'READ' permission），但 React Native 的 fetch 直接走 Uri 读取，
 * 不受这层权限校验影响；先试 fetch，失败再退回 expo-file-system。
 */
async function readPickedBuffer(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri)
  if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）`)
  return await response.arrayBuffer()
}

async function readPickedText(uri: string): Promise<string> {
  try {
    const response = await fetch(uri)
    if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）`)
    return await response.text()
  } catch (error) {
    // Expo Go 里 expo-file-system 对 picker 缓存文件的权限判断有问题，
    // fetch 能读时优先用 fetch；失败再退回 expo-file-system。
    try {
      return await readAsStringAsync(uri)
    } catch {
      throw error instanceof Error ? error : new Error('读取文件失败')
    }
  }
}

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
        <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
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
      style={({ pressed }) => [
        rowStyle,
        { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
      ]}
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
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
              <Icon name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>{children}</View>
        </View>
        <ToastHost />
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// 治疗方案编辑器草稿
// ---------------------------------------------------------------------------

interface PhaseDraft {
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  doseText: string
  unit: string
}

interface OralDraft {
  startDate: number
  durationText: string
  frequency: OralFrequency
  timesPerPeriod: number
  daysOfWeek: number[]
  remindTime: string
}

interface LineDraft {
  key: string
  id: string | null
  kind: LineKind
  medicationId: string
  label: string
  isHost: boolean
  syncWithHost: boolean
  anchor: RegimenAnchor
  windowDays: number
  phases: PhaseDraft[]
  oral: OralDraft
}

let draftSeq = 0
function nextKey(prefix: string): string {
  draftSeq += 1
  return `${prefix}-${Date.now()}-${draftSeq}`
}

function defaultPhase(): PhaseDraft {
  return { kind: 'maintenance', intervalDays: 28, repeatCount: 0, doseText: '', unit: 'mg' }
}

function defaultOral(): OralDraft {
  return {
    startDate: Date.now(),
    durationText: '',
    frequency: 'daily',
    timesPerPeriod: 1,
    daysOfWeek: [],
    remindTime: '09:00',
  }
}

function newLineDraft(kind: LineKind, medications: Medication[]): LineDraft {
  const eligible =
    kind === 'injection' ? medications.filter((medication) => medication.route !== 'oral') : medications
  const medication = eligible[0] ?? null
  return {
    key: nextKey('line'),
    id: null,
    kind,
    medicationId: medication?.id ?? '',
    label: medication?.name ?? '',
    isHost: false,
    syncWithHost: false,
    anchor: 'actual',
    windowDays: 2,
    phases: [defaultPhase()],
    oral: defaultOral(),
  }
}

function lineToDraft(line: TreatmentLine): LineDraft {
  return {
    key: line.id,
    id: line.id,
    kind: line.kind,
    medicationId: line.medicationId,
    label: line.label,
    isHost: line.isHost,
    syncWithHost: line.syncWithHost,
    anchor: line.anchor,
    windowDays: line.windowDays,
    phases: line.phases.map((phase) => ({
      kind: phase.kind,
      intervalDays: phase.intervalDays,
      repeatCount: phase.repeatCount,
      doseText: phase.dose === null ? '' : String(phase.dose),
      unit: phase.unit,
    })),
    oral: line.oral
      ? {
          startDate: line.oral.startDate,
          durationText: line.oral.durationDays === null ? '' : String(line.oral.durationDays),
          frequency: line.oral.frequency,
          timesPerPeriod: line.oral.timesPerPeriod,
          daysOfWeek: line.oral.daysOfWeek,
          remindTime: line.oral.remindTime,
        }
      : defaultOral(),
  }
}

function draftSummary(line: LineDraft, medications: Medication[]): string {
  const medication = medications.find((item) => item.id === line.medicationId)
  const name = medication?.name ?? (line.label.trim() === '' ? '未选择药物' : line.label)
  if (line.kind === 'oral') {
    const frequency = oralFrequencyText(line.oral)
    const duration =
      line.oral.durationText.trim() === '' ? '长期' : `${line.oral.durationText.trim()} 天`
    return `${name} · 口服 · ${frequency} · ${duration}`
  }
  const last = line.phases[line.phases.length - 1]
  const interval = last ? `每 ${last.intervalDays} 天` : '未设间隔'
  const dose = last && last.doseText.trim() !== '' ? ` · ${last.doseText.trim()} ${last.unit}` : ''
  const phases = line.phases.length > 1 ? ` · ${line.phases.length} 个阶段` : ''
  const host = line.isHost ? ' · 主药' : ''
  return `${name} · 注射 · ${interval}${dose}${phases}${host}`
}

/** 治疗方案卡片里对单条线的摘要（用已入库的 TreatmentLine）。 */
function describeLine(line: TreatmentLine, medications: Medication[]): string {
  const medication = medications.find((item) => item.id === line.medicationId)
  const name = medication?.name ?? line.label
  const ended = line.endedAt !== null ? ' · 已停用' : ''
  if (line.kind === 'oral') {
    const oral = line.oral
    if (!oral) return `${name} · 口服${ended}`
    const frequency = oralFrequencyText(oral)
    const duration = oral.durationDays === null ? '长期' : `${oral.durationDays} 天`
    return `${name} · 口服 · ${frequency} · ${duration}${ended}`
  }
  const last = line.phases[line.phases.length - 1]
  const interval = last ? `每 ${last.intervalDays} 天` : '未设间隔'
  const dose = last && last.dose !== null ? ` · ${last.dose} ${last.unit}` : ''
  const host = line.isHost ? ' · 主药' : ''
  return `${name} · 注射 · ${interval}${dose}${host}${ended}`
}

function validateLine(line: LineDraft): string | null {
  if (line.medicationId === '') return '请选择药物'
  if (line.label.trim() === '') return '请填写用药线名称'
  if (line.kind === 'injection') {
    if (line.phases.length === 0) return '注射线至少需要一个阶段'
    for (const phase of line.phases) {
      if (!Number.isFinite(phase.intervalDays) || phase.intervalDays < 1) return '间隔天数至少为 1'
      if (phase.unit.trim() === '') return '阶段单位不能为空'
      if (phase.doseText.trim() !== '') {
        const dose = Number(phase.doseText.trim())
        if (!Number.isFinite(dose) || dose < 0) return '剂量必须是大于或等于 0 的数字'
      }
    }
    return null
  }
  if (line.oral.durationText.trim() !== '') {
    const days = Number(line.oral.durationText.trim())
    if (!Number.isInteger(days) || days < 1) return '疗程天数必须是大于 0 的整数'
  }
  if (line.oral.frequency === 'weekly') {
    if (line.oral.timesPerPeriod < 1 || line.oral.timesPerPeriod > 7) {
      return '每周服药次数需要在 1 到 7 之间'
    }
  }
  if (line.oral.frequency === 'custom' && line.oral.daysOfWeek.length === 0) {
    return '请至少选择一天服药'
  }
  return null
}

function buildLineInput(line: LineDraft): TreatmentLineDraft {
  const base = {
    medicationId: line.medicationId,
    kind: line.kind,
    label: line.label.trim() === '' ? '用药' : line.label.trim(),
    isHost: line.isHost,
    syncWithHost: line.kind === 'injection' && !line.isHost ? line.syncWithHost : false,
    anchor: line.anchor,
    windowDays: line.windowDays,
    ...(line.id !== null ? { id: line.id } : {}),
  }
  if (line.kind === 'oral') {
    return {
      ...base,
      oral: {
        startDate: line.oral.startDate,
        durationDays:
          line.oral.durationText.trim() === '' ? null : Number(line.oral.durationText.trim()),
        frequency: line.oral.frequency,
        timesPerPeriod:
          line.oral.frequency === 'weekly' ? line.oral.timesPerPeriod : 0,
        daysOfWeek:
          line.oral.frequency === 'custom' ? line.oral.daysOfWeek : [],
        remindTime: line.oral.remindTime,
      },
    }
  }
  return {
    ...base,
    phases: line.phases.map((phase, index) => ({
      orderIdx: index,
      kind: phase.kind,
      intervalDays: phase.intervalDays,
      repeatCount: phase.repeatCount,
      dose: phase.doseText.trim() === '' ? null : Number(phase.doseText.trim()),
      unit: phase.unit.trim(),
    })),
  }
}

function MedicationChips({
  medications,
  value,
  onSelect,
}: {
  medications: Medication[]
  value: string
  onSelect: (medication: Medication) => void
}) {
  const theme = useTheme()
  if (medications.length === 0) {
    return (
      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
        还没有可选的药物，请先在「我的药物」里添加。
      </Text>
    )
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {medications.map((medication) => {
        const selected = medication.id === value
        return (
          <Pressable
            key={medication.id}
            accessibilityRole="button"
            accessibilityLabel={medication.name}
            accessibilityState={{ selected }}
            onPress={() => onSelect(medication)}
            style={({ pressed }) => [
              styles.medChip,
              {
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
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
              {medication.name}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function TreatmentEditor({
  visible,
  treatment,
  medications,
  onSaved,
}: {
  visible: boolean
  treatment: Treatment | null
  medications: Medication[]
  onSaved: () => void
}) {
  const theme = useTheme()
  const saveTreatment = useAppStore((state) => state.saveTreatment)
  const setActiveTreatment = useAppStore((state) => state.setActiveTreatment)

  const [view, setView] = useState<'list' | 'line'>('list')
  const [name, setName] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 打开时把已有方案灌进草稿。只在可见性变化时重置，避免编辑途中被无关刷新覆盖。
  useEffect(() => {
    if (!visible) return
    setName(treatment?.name ?? '')
    setLines(treatment ? treatment.lines.map(lineToDraft) : [])
    setView('list')
    setLineDraft(null)
    setEditingKey(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const openNewLine = (kind: LineKind) => {
    setLineDraft(newLineDraft(kind, medications))
    setEditingKey(null)
    setError(null)
    setView('line')
  }

  const openEditLine = (key: string) => {
    const found = lines.find((line) => line.key === key)
    if (!found) return
    setLineDraft({ ...found, phases: found.phases.map((phase) => ({ ...phase })), oral: { ...found.oral } })
    setEditingKey(key)
    setError(null)
    setView('line')
  }

  const closeLine = () => {
    setView('list')
    setLineDraft(null)
    setEditingKey(null)
    setError(null)
  }

  const commitLine = () => {
    if (!lineDraft) return
    const problem = validateLine(lineDraft)
    if (problem) {
      setError(problem)
      return
    }
    const draft = lineDraft
    setLines((current) => {
      const next = editingKey
        ? current.map((line) => (line.key === editingKey ? draft : line))
        : [...current, draft]
      // 方案内只能有一条主药：设为主药时取消其它线的主药标记。
      return draft.isHost ? next.map((line) => (line.key === draft.key ? line : { ...line, isHost: false })) : next
    })
    closeLine()
  }

  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const removeLine = (key: string) => {
    const target = lines.find((line) => line.key === key)
    if (target?.id) {
      setPendingDelete(key)
      return
    }
    setLines((current) => current.filter((line) => line.key !== key))
  }

  const saveEditor = async () => {
    setError(null)
    const trimmedName = name.trim()
    if (trimmedName === '') {
      setError('请填写方案名称')
      return
    }
    if (lines.length === 0) {
      setError('至少需要一条用药线')
      return
    }
    if (lines.filter((line) => line.isHost).length > 1) {
      setError('方案内只能有一条主药')
      return
    }
    for (const line of lines) {
      const problem = validateLine(line)
      if (problem) {
        setError(problem)
        return
      }
    }

    const beforeIds = new Set(useAppStore.getState().treatments.map((item) => item.id))

    setSaving(true)
    try {
      const input: SaveTreatmentInput = {
        ...(treatment !== null ? { id: treatment.id } : {}),
        name: trimmedName,
        lines: lines.map(buildLineInput),
      }
      const result = await saveTreatment(input)

      // 新建方案时自动激活（store 里 create 默认 is_active = 0）。
      if (treatment === null) {
        const created = useAppStore
          .getState()
          .treatments.find((item) => !beforeIds.has(item.id))
        if (created) {
          const activate = await setActiveTreatment(created.id, true)
          if (activate.notifyWarning) toast(activate.notifyWarning, 'error')
        }
      }

      onSaved()
      toast(treatment !== null ? '治疗方案已更新' : '治疗方案已创建', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const renderList = () => (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      <TextField
        label={zh.settings.regimenName}
        value={name}
        onChangeText={setName}
        placeholder="例如：阿达木单抗 + 甲氨蝶呤"
        accessibilityLabel="治疗方案名称"
      />

      <View style={{ gap: theme.spacing.sm }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
          用药线
        </Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          一个方案里可以有多种药；注射线只能有一条「主药」，排程以它的实际注射时间为锚点。
        </Text>
        {lines.length === 0 ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            还没有用药线，先添加一条注射线或口服线。
          </Text>
        ) : (
          lines.map((line) => (
            <View
              key={line.key}
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                gap: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
                {draftSummary(line, medications)}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Button
                  label={zh.common.edit}
                  variant="secondary"
                  onPress={() => openEditLine(line.key)}
                  style={{ flex: 1 }}
                />
                <Button
                  label={zh.common.delete}
                  variant="danger"
                  onPress={() => removeLine(line.key)}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Button
          label="添加注射线"
          variant="secondary"
          icon="plus"
          onPress={() => openNewLine('injection')}
          style={{ flex: 1 }}
        />
        <Button
          label="添加口服线"
          variant="secondary"
          icon="plus"
          onPress={() => openNewLine('oral')}
          style={{ flex: 1 }}
        />
      </View>

      {error ? <InlineError message={error} /> : null}

      <Button
        label="保存治疗方案"
        onPress={() => {
          void saveEditor()
        }}
        loading={saving}
        size="lg"
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="删除这条用药线？"
        message="这条线的历史打卡记录会一起删除，且无法恢复。只是暂时不打这种药的话，可以在保存后到「疗效记录」里停用这条线。"
        confirmLabel={zh.common.delete}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const key = pendingDelete
          setPendingDelete(null)
          if (key) setLines((current) => current.filter((line) => line.key !== key))
        }}
      />
    </ScrollView>
  )

  const renderInjectionFields = (draft: LineDraft) => {
    const eligible = medications.filter((medication) => medication.route !== 'oral')
    const hostExists = lines.some((line) => line.isHost && line.key !== editingKey)
    const canSync = !draft.isHost && hostExists
    return (
      <>
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
            {zh.form.medicationName}
          </Text>
          {draft.id ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              {medications.find((medication) => medication.id === draft.medicationId)?.name ??
                '已选药物'}
              （换药请新建一条用药线，历史记录会按原药保留）
            </Text>
          ) : (
            <MedicationChips
              medications={eligible}
              value={draft.medicationId}
              onSelect={(medication) =>
                setLineDraft((current) =>
                  current
                    ? {
                        ...current,
                        medicationId: medication.id,
                        label: current.label.trim() === '' ? medication.name : current.label,
                      }
                    : current,
                )
              }
            />
          )}
        </View>

        <TextField
          label="用药线名称"
          value={draft.label}
          onChangeText={(value) => setLineDraft((current) => (current ? { ...current, label: value } : current))}
          placeholder="默认用药名"
          accessibilityLabel="用药线名称"
        />

        <SwitchRow
          label="设为主药"
          hint="方案内只能有一条主药"
          value={draft.isHost}
          onValueChange={(value) =>
            setLineDraft((current) =>
              current ? { ...current, isHost: value, syncWithHost: value ? false : current.syncWithHost } : current,
            )
          }
          last
        />

        <SwitchRow
          label="跟随主药时间"
          hint={hostExists ? '和主药同一天注射' : '方案里还没有主药，无法跟随'}
          value={canSync && draft.syncWithHost}
          onValueChange={(value) => setLineDraft((current) => (current ? { ...current, syncWithHost: value } : current))}
          disabled={!canSync}
          last
        />

        <Stepper
          label={zh.settings.windowDays}
          value={draft.windowDays}
          onChange={(value) => setLineDraft((current) => (current ? { ...current, windowDays: value } : current))}
          min={0}
          max={30}
          suffix={zh.common.unitDay}
          decreaseLabel="按时窗口减少一天"
          increaseLabel="按时窗口增加一天"
        />

        <View style={{ gap: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
            {zh.settings.phases}
          </Text>
          {draft.phases.map((phase, index) => (
            <View
              key={`phase-${index}`}
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                gap: theme.spacing.md,
                backgroundColor: theme.colors.surface,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '700' }}>
                  阶段 {index + 1}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除阶段 ${index + 1}`}
                  accessibilityState={{ disabled: draft.phases.length <= 1 }}
                  disabled={draft.phases.length <= 1}
                  onPress={() =>
                    setLineDraft((current) =>
                      current
                        ? { ...current, phases: current.phases.filter((_, i) => i !== index) }
                        : current,
                    )
                  }
                  style={({ pressed }) => [
                    styles.iconButton,
                    {
                      borderRadius: theme.radius.sm,
                      opacity: draft.phases.length <= 1 ? 0.35 : pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Icon name="trash" size={18} color={theme.colors.danger} />
                </Pressable>
              </View>

              <SegmentedControl<PhaseKind>
                options={[
                  { value: 'loading', label: zh.settings.phaseLoading },
                  { value: 'maintenance', label: zh.settings.phaseMaintenance },
                ]}
                value={phase.kind}
                onChange={(kind) =>
                  setLineDraft((current) =>
                    current
                      ? {
                          ...current,
                          phases: current.phases.map((item, i) => (i === index ? { ...item, kind } : item)),
                        }
                      : current,
                  )
                }
                accessibilityLabel={`阶段 ${index + 1} 类型`}
              />

              <Stepper
                label={zh.settings.intervalDays}
                value={phase.intervalDays}
                onChange={(value) =>
                  setLineDraft((current) =>
                    current
                      ? {
                          ...current,
                          phases: current.phases.map((item, i) =>
                            i === index ? { ...item, intervalDays: value } : item,
                          ),
                        }
                      : current,
                  )
                }
                min={1}
                max={365}
                suffix={zh.common.unitDay}
                decreaseLabel="间隔减少一天"
                increaseLabel="间隔增加一天"
              />

              <Stepper
                label={zh.settings.repeatCount}
                value={phase.repeatCount}
                onChange={(value) =>
                  setLineDraft((current) =>
                    current
                      ? {
                          ...current,
                          phases: current.phases.map((item, i) =>
                            i === index ? { ...item, repeatCount: value } : item,
                          ),
                        }
                      : current,
                  )
                }
                min={0}
                max={52}
                suffix="次"
                decreaseLabel="重复次数减少"
                increaseLabel="重复次数增加"
              />

              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={`${zh.settings.dose}（${zh.common.optional}）`}
                    value={phase.doseText}
                    onChangeText={(value) =>
                      setLineDraft((current) =>
                        current
                          ? {
                              ...current,
                              phases: current.phases.map((item, i) =>
                                i === index ? { ...item, doseText: value } : item,
                              ),
                            }
                          : current,
                      )
                    }
                    keyboardType="decimal-pad"
                    placeholder="40"
                    accessibilityLabel={`阶段 ${index + 1} 剂量`}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label="单位"
                    value={phase.unit}
                    onChangeText={(value) =>
                      setLineDraft((current) =>
                        current
                          ? {
                              ...current,
                              phases: current.phases.map((item, i) => (i === index ? { ...item, unit: value } : item)),
                            }
                          : current,
                      )
                    }
                    placeholder="mg"
                    accessibilityLabel={`阶段 ${index + 1} 单位`}
                  />
                </View>
              </View>
            </View>
          ))}
          <Button
            label={zh.settings.addPhase}
            variant="outline"
            icon="plus"
            onPress={() =>
              setLineDraft((current) => (current ? { ...current, phases: [...current.phases, defaultPhase()] } : current))
            }
          />
        </View>
      </>
    )
  }

  const renderOralFields = (draft: LineDraft) => {
    const eligible = [...medications].sort(
      (a, b) => (a.route === 'oral' ? 0 : 1) - (b.route === 'oral' ? 0 : 1),
    )
    return (
      <>
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
            {zh.form.medicationName}
          </Text>
          {draft.id ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              {medications.find((medication) => medication.id === draft.medicationId)?.name ??
                '已选药物'}
            </Text>
          ) : (
            <MedicationChips
              medications={eligible}
              value={draft.medicationId}
              onSelect={(medication) =>
                setLineDraft((current) =>
                  current
                    ? {
                        ...current,
                        medicationId: medication.id,
                        label: current.label.trim() === '' ? medication.name : current.label,
                      }
                    : current,
                )
              }
            />
          )}
        </View>

        <TextField
          label="用药线名称"
          value={draft.label}
          onChangeText={(value) => setLineDraft((current) => (current ? { ...current, label: value } : current))}
          placeholder="默认用药名"
          accessibilityLabel="用药线名称"
        />

        <DateTimeField
          label="开始日期"
          value={draft.oral.startDate}
          onChange={(value) =>
            setLineDraft((current) => (current ? { ...current, oral: { ...current.oral, startDate: value } } : current))
          }
        />

        <TextField
          label={`疗程天数（${zh.common.optional}）`}
          value={draft.oral.durationText}
          onChangeText={(value) =>
            setLineDraft((current) =>
              current ? { ...current, oral: { ...current.oral, durationText: value } } : current,
            )
          }
          keyboardType="number-pad"
          placeholder="留空表示长期"
          hint="留空表示长期服用"
          accessibilityLabel="疗程天数"
        />

        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
            服药频次
          </Text>
          <SegmentedControl<OralFrequency>
            options={[
              { value: 'daily', label: '每天' },
              { value: 'weekly', label: '每周 N 次' },
              { value: 'custom', label: '固定周几' },
            ]}
            value={draft.oral.frequency}
            onChange={(frequency) =>
              setLineDraft((current) => (current ? { ...current, oral: { ...current.oral, frequency } } : current))
            }
            accessibilityLabel="服药频次"
          />
        </View>

        {draft.oral.frequency === 'weekly' ? (
          <Stepper
            label="每周次数"
            value={draft.oral.timesPerPeriod}
            onChange={(value) =>
              setLineDraft((current) =>
                current ? { ...current, oral: { ...current.oral, timesPerPeriod: value } } : current,
              )
            }
            min={1}
            max={7}
            suffix="次"
            decreaseLabel="每周次数减少"
            increaseLabel="每周次数增加"
          />
        ) : null}

        {draft.oral.frequency === 'custom' ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              服药星期（可多选）
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {WEEKDAY_LABELS.map((label, day) => (
                <Chip
                  key={day}
                  label={label}
                  selected={draft.oral.daysOfWeek.includes(day)}
                  onPress={() =>
                    setLineDraft((current) => {
                      if (!current) return current
                      const days = current.oral.daysOfWeek.includes(day)
                        ? current.oral.daysOfWeek.filter((item) => item !== day)
                        : [...current.oral.daysOfWeek, day].sort((a, b) => a - b)
                      return { ...current, oral: { ...current.oral, daysOfWeek: days } }
                    })
                  }
                  accessibilityLabel={label}
                />
              ))}
            </View>
          </View>
        ) : null}

        <TimeOfDayField
          label="服药提醒时间"
          value={draft.oral.remindTime}
          onChange={(value) =>
            setLineDraft((current) => (current ? { ...current, oral: { ...current.oral, remindTime: value } } : current))
          }
        />
      </>
    )
  }

  const renderLineForm = (draft: LineDraft) => (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={zh.common.back}
          onPress={closeLine}
          style={({ pressed }) => [
            styles.iconButton,
            { borderRadius: theme.radius.pill, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Icon name="chevron-left" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}>
          {editingKey ? '编辑用药线' : draft.kind === 'injection' ? '添加注射线' : '添加口服线'}
        </Text>
      </View>

      {draft.kind === 'injection' ? renderInjectionFields(draft) : renderOralFields(draft)}

      {error ? <InlineError message={error} /> : null}

      <Button label={zh.common.confirm} onPress={commitLine} size="lg" />
    </ScrollView>
  )

  return view === 'line' && lineDraft ? renderLineForm(lineDraft) : renderList()
}

// ---------------------------------------------------------------------------
// 疗效记录
// ---------------------------------------------------------------------------

/**
 * 记录生物制剂（或口服药）疗效下降 / 失效。
 *
 * 不根据症状推断结论：只保存用户自己填写的事件、发生时间和已用药次数快照，
 * 是否停用、是否换药仍由用户和医生决定。
 */
function EfficacyManager({
  visible,
  lines,
  medications,
  events,
}: {
  visible: boolean
  lines: TreatmentLine[]
  medications: Medication[]
  events: EfficacyEvent[]
}) {
  const theme = useTheme()
  const addEfficacyEvent = useAppStore((state) => state.addEfficacyEvent)
  const removeEfficacyEvent = useAppStore((state) => state.removeEfficacyEvent)
  const setLineEnded = useAppStore((state) => state.setLineEnded)

  const [lineId, setLineId] = useState('')
  const [kind, setKind] = useState<EfficacyKind>('reduced')
  const [occurredAt, setOccurredAt] = useState<number>(() => Date.now())
  const [note, setNote] = useState('')
  const [stopLine, setStopLine] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EfficacyEvent | null>(null)

  const orderedLines = useMemo(
    () =>
      [...lines].sort(
        (a, b) => (a.kind === 'injection' ? 0 : 1) - (b.kind === 'injection' ? 0 : 1),
      ),
    [lines],
  )

  useEffect(() => {
    if (!visible) return
    setLineId((current) =>
      current !== '' && orderedLines.some((line) => line.id === current)
        ? current
        : orderedLines[0]?.id ?? '',
    )
  }, [visible, orderedLines])

  useEffect(() => {
    if (!visible) return
    setKind('reduced')
    setOccurredAt(Date.now())
    setNote('')
    setStopLine(true)
    setError(null)
  }, [visible])

  const selectedLine = orderedLines.find((line) => line.id === lineId) ?? null
  const selectedMedication = selectedLine
    ? medications.find((medication) => medication.id === selectedLine.medicationId) ?? null
    : null
  const scopedEvents = events.filter((event) => lines.some((line) => line.id === event.lineId))

  const lineName = (line: TreatmentLine) =>
    medications.find((medication) => medication.id === line.medicationId)?.name ?? line.label

  const save = async () => {
    setError(null)
    if (!selectedLine) {
      setError('请先选择一条用药线。')
      return
    }
    if (!Number.isFinite(occurredAt) || occurredAt <= 0) {
      setError('请选择有效的事件时间。')
      return
    }
    setSaving(true)
    try {
      const result = await addEfficacyEvent({
        lineId: selectedLine.id,
        kind,
        occurredAt,
        note: note.trim() === '' ? null : note.trim(),
        stopLine: selectedLine.endedAt === null ? stopLine : false,
      })
      toast(
        selectedLine.endedAt === null && stopLine ? '已记录，并停用这条用药线' : '已记录疗效事件',
        'success',
      )
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
      setNote('')
      setOccurredAt(Date.now())
      setStopLine(true)
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      toast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const restoreLine = async (line: TreatmentLine) => {
    try {
      const result = await setLineEnded(line.id, null)
      toast('已恢复这条用药线', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const removeEvent = async (event: EfficacyEvent) => {
    try {
      const result = await removeEfficacyEvent(event.id)
      toast('已删除疗效记录', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.lg,
        gap: theme.spacing.lg,
      }}
    >
      {orderedLines.length === 0 ? (
        <Card>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
            还没有用药线，请先创建治疗方案。
          </Text>
        </Card>
      ) : (
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                用药线
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {orderedLines.map((line) => (
                  <Chip
                    key={line.id}
                    label={`${lineName(line)}${line.kind === 'injection' ? ' · 注射' : ' · 口服'}`}
                    selected={line.id === lineId}
                    onPress={() => setLineId(line.id)}
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                事件类型
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {EFFICACY_KIND_OPTIONS.map((item) => (
                  <Chip
                    key={item.value}
                    label={item.label}
                    selected={item.value === kind}
                    onPress={() => setKind(item.value)}
                  />
                ))}
              </View>
            </View>

            <DateTimeField label="发生时间" value={occurredAt} onChange={setOccurredAt} />

            <TextField
              label={`备注（${zh.common.optional}）`}
              value={note}
              onChangeText={setNote}
              placeholder="例如：医生评估后调整方案"
              multiline
              accessibilityLabel="疗效事件备注"
            />

            {selectedLine?.endedAt === null ? (
              <SwitchRow
                label="同时停用这条用药线"
                hint="停用后不再生成后续计划，历史打卡保留"
                value={stopLine}
                onValueChange={setStopLine}
                last
              />
            ) : selectedLine ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                  这条用药线已于{' '}
                  {selectedLine.endedAt !== null ? formatDate(selectedLine.endedAt) : ''} 停用
                </Text>
                <Button
                  label="恢复这条用药线"
                  variant="secondary"
                  onPress={() => {
                    void restoreLine(selectedLine)
                  }}
                />
              </View>
            ) : null}

            {error ? <InlineError message={error} /> : null}

            <Button label="保存疗效记录" onPress={() => void save()} loading={saving} />

            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: theme.fontSize.xs,
                lineHeight: theme.lineHeight.xs,
              }}
            >
              仅用于自我观察和就诊时回顾，不构成疗效或因果判断。是否停药、换药请遵医嘱。
            </Text>
          </View>
        </Card>
      )}

      <View style={{ gap: theme.spacing.sm }}>
        <SectionTitle title="已有记录" hint={`${scopedEvents.length} 条`} />
        {scopedEvents.length === 0 ? (
          <Card>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              还没有疗效记录。
            </Text>
          </Card>
        ) : (
          scopedEvents.map((event) => {
            const line = lines.find((item) => item.id === event.lineId)
            return (
              <Card key={event.id}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}
                    >
                      {line ? lineName(line) : '已删除的用药线'} · {efficacyKindLabel(event.kind)}
                    </Text>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                      {formatDate(event.occurredAt)} · 当时已完成 {event.dosesCount} 次
                    </Text>
                    {event.note ? (
                      <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                        {event.note}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`删除 ${efficacyKindLabel(event.kind)} 记录`}
                    onPress={() => setDeleteTarget(event)}
                    style={({ pressed }) => [
                      styles.iconButton,
                      {
                        borderRadius: theme.radius.pill,
                        backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Icon name="trash" size={18} color={theme.colors.textTertiary} />
                  </Pressable>
                </View>
              </Card>
            )
          })
        )}
      </View>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="删除疗效记录"
        message={
          deleteTarget
            ? `确定删除「${efficacyKindLabel(deleteTarget.kind)}」这条记录吗？用药线不会自动恢复。`
            : ''
        }
        confirmLabel={zh.common.delete}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void removeEvent(target)
        }}
      />
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// 设置页
// ---------------------------------------------------------------------------

type DiseaseRow =
  | { type: 'header'; key: string; title: string }
  | { type: 'disease'; key: string; disease: Disease }

export default function SettingsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const ready = useAppStore((state) => state.ready)
  const treatment = useAppStore((state) => state.treatment)
  const treatments = useAppStore((state) => state.treatments)
  const medicines = useAppStore((state) => state.medications)
  const disease = useAppStore((state) => state.disease)
  const diseases = useAppStore((state) => state.diseases)
  const symptomTags = useAppStore((state) => state.symptomTags)
  const efficacyEvents = useAppStore((state) => state.efficacyEvents)
  const settings = useAppStore((state) => state.settings)
  const reminder = useAppStore((state) => state.reminder)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)
  const updateReminder = useAppStore((state) => state.updateReminder)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const setActiveTreatment = useAppStore((state) => state.setActiveTreatment)
  const importRecords = useAppStore((state) => state.importRecords)

  const [reminderTime, setReminderTime] = useState('09:00')
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([-2, -1, 0])
  const [snoozeMinutes, setSnoozeMinutes] = useState(10)
  const [savingReminder, setSavingReminder] = useState(false)
  const [savingDnd, setSavingDnd] = useState(false)
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('08:00')

  const [editorOpen, setEditorOpen] = useState(false)
  const [efficacyOpen, setEfficacyOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const [diseaseOpen, setDiseaseOpen] = useState(false)
  const [diseaseSaving, setDiseaseSaving] = useState(false)
  const [diseaseDraft, setDiseaseDraft] = useState<string[]>([])
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [medicationsOpen, setMedicationsOpen] = useState(false)

  const [lockBusy, setLockBusy] = useState(false)
  const [themeSaving, setThemeSaving] = useState(false)

  const themeMode: ThemeMode =
    settings.theme_mode === 'light' || settings.theme_mode === 'dark'
      ? settings.theme_mode
      : 'system'

  const changeThemeMode = async (mode: ThemeMode) => {
    if (mode === themeMode || themeSaving) return
    setThemeSaving(true)
    try {
      const result = await updateSettings({ theme_mode: mode })
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setThemeSaving(false)
    }
  }

  const [pdfOpen, setPdfOpen] = useState(false)
  const [patientName, setPatientName] = useState('')
  const [rangeDays, setRangeDays] = useState(180)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingJson, setExportingJson] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [pendingImport, setPendingImport] = useState<ImportPayload | null>(null)
  const [importPreview, setImportPreview] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importBusy, setImportBusy] = useState(false)

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

  const deactivateTreatment = async () => {
    if (!treatment) return
    setDeactivating(true)
    try {
      const result = await setActiveTreatment(treatment.id, false)
      setDeactivateOpen(false)
      toast('当前治疗方案已停用', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setDeactivating(false)
    }
  }

  const openDiseaseSheet = () => {
    setDiseaseDraft(resolveDiseaseIds(settings))
    setDiseaseOpen(true)
  }

  const toggleDiseaseDraft = (id: string) => {
    setDiseaseDraft((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const saveDiseases = async () => {
    if (diseaseDraft.length === 0) {
      toast('请至少选择一个病种', 'error')
      return
    }
    setDiseaseSaving(true)
    try {
      const result = await updateSettings({
        disease_ids: JSON.stringify(diseaseDraft),
        disease_id: diseaseDraft[0] ?? '',
      })
      setDiseaseOpen(false)
      toast('病种已更新', 'success')
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
    }
    if (reminderOffsets.length === 0) {
      toast('至少选择一个提前提醒时间', 'error')
      return
    }
    setSavingReminder(true)
    try {
      const result = await updateReminder({
        treatmentId: reminder.treatmentId,
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
    if (!treatment) return
    try {
      const result = await updateReminder({
        treatmentId: treatment.id,
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
      let permissionWarning: string | null = null
      if (enabled) {
        const permission = await ensurePermissions()
        if (!permission.granted) {
          permissionWarning = '系统通知权限未开启，提醒不会显示'
        } else if (!permission.exactAlarm) {
          permissionWarning = '精确闹钟未开启，提醒可能会延迟'
        }
      }
      const result = await updateReminder({
        treatmentId: reminder.treatmentId,
        offsets: reminderOffsets.length > 0 ? reminderOffsets : reminder.offsets,
        timeOfDay: reminderTime,
        snoozeMinutes,
        enabled,
      })
      toast(enabled ? '提醒已开启' : '提醒已关闭', 'success')
      if (permissionWarning) toast(permissionWarning, 'error')
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

  const pickImportFile = async () => {
    setImportBusy(true)
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (picked.canceled) return
      const asset = picked.assets?.[0]
      if (!asset) return

      const name = (asset.name ?? '').toLowerCase()
      let payload: ImportPayload
      if (name.endsWith('.json')) {
        payload = parseImportJson(await readPickedText(asset.uri))
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        payload = parseSpreadsheet(await readPickedBuffer(asset.uri))
      } else {
        throw new Error('只支持 .xlsx / .xls / .json 文件')
      }

      setImportPreview(null)
      setPendingImport(payload)
      try {
        const preview = await previewImport(payload)
        setImportPreview(preview)
      } catch (error) {
        setPendingImport(null)
        toast(errorMessage(error), 'error')
      }
    } catch (error) {
      toast(`读取失败：${errorMessage(error)}`, 'error')
    } finally {
      setImportBusy(false)
    }
  }

  const runImport = async () => {
    if (!pendingImport) return
    setImporting(true)
    try {
      const { result, notifyWarning } = await importRecords(pendingImport)
      setPendingImport(null)
      setImportPreview(null)
      const parts: string[] = []
      if (result.injections > 0) parts.push(`${result.injections} 条注射`)
      if (result.oralLogs > 0) parts.push(`${result.oralLogs} 条口服`)
      if (result.symptoms > 0) parts.push(`${result.symptoms} 条症状`)
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条重复`)
      if (result.skippedNoLine > 0) parts.push(`${result.skippedNoLine} 条找不到对应用药线`)
      if (result.medicationsCreated > 0) parts.push(`新建 ${result.medicationsCreated} 种药物`)
      if (result.linesCreated > 0) parts.push(`新建 ${result.linesCreated} 条用药线`)
      if (result.efficacyEvents > 0) parts.push(`恢复 ${result.efficacyEvents} 条疗效记录`)
      if (result.tags > 0) parts.push(`新增 ${result.tags} 个症状标签`)
      toast(parts.length === 0 ? '没有可导入的新记录' : `已导入：${parts.join('，')}`, 'success')
      if (notifyWarning) toast(notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setImporting(false)
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

  const doExportExcel = async () => {
    setExportingExcel(true)
    try {
      const file = await exportExcel()
      await shareFile(file.path)
      toast(zh.disclaimer.exportWarning, 'default')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setExportingExcel(false)
    }
  }

  const doExportJson = async () => {
    setExportingJson(true)
    try {
      const file = await exportJson()
      await shareFile(file.path)
      toast(zh.disclaimer.exportWarning, 'default')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setExportingJson(false)
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
  const activeEfficacyCount = treatment
    ? efficacyEvents.filter((event) => treatment.lines.some((line) => line.id === event.lineId))
        .length
    : 0

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
        {treatment ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}>
                {treatment.name}
              </Text>
              <View style={{ gap: 4 }}>
                {treatment.lines.map((line) => (
                  <Text
                    key={line.id}
                    style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
                  >
                    {describeLine(line, medicines)}
                  </Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
                <Button
                  label="编辑治疗方案"
                  onPress={() => setEditorOpen(true)}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
                <Button
                  label="停用治疗方案"
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
              icon="plus"
              title="还没有治疗方案"
              message="添加药物与用药间隔，开始记录。"
              actionLabel="新建治疗方案"
              onAction={() => setEditorOpen(true)}
              compact
            />
          </Card>
        )}

        <SectionTitle
          title="疗效记录"
          hint="打完一定次数后疗效下降、失效或不耐受时记一笔；可同时停用用药线"
        />
        <RowGroup>
          <SettingRow
            label="疗效事件"
            hint="只做记录，不推断原因，也不提供停药建议"
            value={`${activeEfficacyCount} 条`}
            onPress={() => setEfficacyOpen(true)}
            last
          />
        </RowGroup>

        {treatments.some((item) => !item.isActive) ? (
          <>
            <SectionTitle title="其他治疗方案" hint="停用的方案记录仍在，可随时重新启用" />
            <RowGroup>
              {treatments
                .filter((item) => !item.isActive)
                .map((item, index, list) => (
                  <SettingRow
                    key={item.id}
                    label={item.name}
                    hint={`${item.lines.length} 条用药线`}
                    right={
                      <Button
                        label="启用"
                        variant="secondary"
                        onPress={() => {
                          void (async () => {
                            try {
                              const result = await setActiveTreatment(item.id, true)
                              toast('已切换治疗方案', 'success')
                              if (result.notifyWarning) toast(result.notifyWarning, 'error')
                            } catch (error) {
                              toast(errorMessage(error), 'error')
                            }
                          })()
                        }}
                      />
                    }
                    last={index === list.length - 1}
                  />
                ))}
            </RowGroup>
          </>
        ) : null}

        <SectionTitle title="药物" hint="目录药由版本维护，自定义药可自行增删改" />
        <RowGroup>
          <SettingRow
            label="我的药物"
            hint="调整默认剂量，或添加目录外的药"
            value={`${medicines.length} 种`}
            onPress={() => setMedicationsOpen(true)}
            last
          />
        </RowGroup>

        <SectionTitle title="病种" hint="可以多选；切换后会影响新建方案时的药物列表" />
        <RowGroup>
          <SettingRow
            label="当前病种"
            value={diseases.length > 0 ? diseases.map((item) => item.name).join('、') : '未选择病种'}
            onPress={openDiseaseSheet}
            last
          />
        </RowGroup>

        <SectionTitle title="症状记录" hint="标签只影响记录时可选的名称，历史记录文字不变" />
        <RowGroup>
          <SettingRow
            label="症状标签"
            hint="添加或删除记录症状时的可选项"
            value={`${symptomTags.length} 个`}
            onPress={() => setTagManagerOpen(true)}
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
          {!reminder && treatment ? (
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
                    <Icon name="minus" size={20} color={theme.colors.text} strokeWidth={2.25} />
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
                    <Icon name="plus" size={20} color={theme.colors.text} strokeWidth={2.25} />
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

        <SectionTitle title={zh.settings.theme} hint="跟随系统时，手机切换深色模式会立即生效" />
        <RowGroup>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <SegmentedControl<ThemeMode>
              options={[
                { value: 'system', label: zh.settings.themeSystem },
                { value: 'light', label: zh.settings.themeLight },
                { value: 'dark', label: zh.settings.themeDark },
              ]}
              value={themeMode}
              onChange={(mode) => {
                void changeThemeMode(mode)
              }}
              accessibilityLabel={zh.settings.theme}
            />
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              仅影响界面配色，不影响提醒与数据。
            </Text>
          </View>
        </RowGroup>

        <SectionTitle title={zh.settings.exportSection} hint={zh.disclaimer.exportWarning} />
        <RowGroup>
          <SettingRow
            label="导入数据"
            hint={
              importBusy
                ? '正在读取文件…'
                : '从 Excel（.xlsx）或 JSON 文件批量补录，重复记录会自动跳过'
            }
            onPress={
              importBusy
                ? undefined
                : () => {
                    void pickImportFile()
                  }
            }
          />
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
            label="导出 Excel（可编辑）"
            hint="注射 / 口服 / 症状 / 药物 / 用药线，可用表格软件编辑"
            value={exportingExcel ? '导出中…' : undefined}
            onPress={
              exportingExcel
                ? undefined
                : () => {
                    void doExportExcel()
                  }
            }
          />
          <SettingRow
            label="导出 JSON（可编辑）"
            hint="可再次导入还原，适合备份或迁移"
            value={exportingJson ? '导出中…' : undefined}
            onPress={
              exportingJson
                ? undefined
                : () => {
                    void doExportJson()
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
            hint="删除全部注射、口服、症状与方案，内置药物保留"
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

      <BottomSheet
        visible={editorOpen}
        title={treatment ? '编辑治疗方案' : '新建治疗方案'}
        onClose={() => setEditorOpen(false)}
        height="90%"
      >
        <TreatmentEditor
          visible={editorOpen}
          treatment={treatment}
          medications={medicines}
          onSaved={() => setEditorOpen(false)}
        />
      </BottomSheet>

      <BottomSheet
        visible={efficacyOpen}
        title="疗效记录"
        onClose={() => setEfficacyOpen(false)}
        height="90%"
      >
        <EfficacyManager
          visible={efficacyOpen}
          lines={treatment?.lines ?? []}
          medications={medicines}
          events={efficacyEvents}
        />
      </BottomSheet>

      <BottomSheet visible={diseaseOpen} title="选择病种（可多选）" onClose={() => setDiseaseOpen(false)}>
        <FlatList<DiseaseRow>
          data={diseaseRows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 96, gap: 8 }}
          ListHeaderComponent={
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: theme.fontSize.xs,
                lineHeight: theme.lineHeight.xs,
                paddingBottom: theme.spacing.sm,
              }}
            >
              可以多选（例如同时有克罗恩病和强直性脊柱炎）。这里只改变新建方案时的药物列表，当前方案与已有记录保持不变。
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
            const selected = diseaseDraft.includes(item.disease.id)
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={item.disease.name}
                accessibilityState={{ checked: selected, disabled: diseaseSaving }}
                disabled={diseaseSaving}
                onPress={() => toggleDiseaseDraft(item.disease.id)}
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
                  <Icon name="check" size={20} color={theme.colors.primary} strokeWidth={2.5} />
                ) : null}
              </Pressable>
            )
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          }}
        >
          <Button
            label={`保存（已选 ${diseaseDraft.length} 个）`}
            onPress={() => {
              void saveDiseases()
            }}
            loading={diseaseSaving}
            disabled={diseaseDraft.length === 0}
          />
        </View>
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

      <BottomSheet
        visible={tagManagerOpen}
        title={zh.form.tagManagerTitle}
        onClose={() => setTagManagerOpen(false)}
        height="70%"
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
          }}
        >
          <SymptomTagManager />
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={medicationsOpen}
        title="我的药物"
        onClose={() => setMedicationsOpen(false)}
        height="88%"
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
          }}
        >
          <MedicationManager />
        </ScrollView>
      </BottomSheet>

      <ConfirmDialog
        visible={pendingImport !== null}
        title="导入数据"
        message={
          pendingImport
            ? importPreview
              ? `将导入 ${importPreview.injections} 条注射、${importPreview.oralLogs} 条口服、${importPreview.symptoms} 条症状记录。` +
                `将新建 ${importPreview.medicationsCreated} 种药物、${importPreview.linesCreated} 条用药线；${importPreview.skippedNoLine} 条找不到对应用药线会被跳过。` +
                `重复的记录会自动跳过（按分钟比对），导入后可以逐条删除。${importPreview.efficacyEvents > 0 ? `另有 ${importPreview.efficacyEvents} 条疗效记录会尝试还原。` : ''}`
              : `将导入 ${pendingImport.injections.length} 条注射、${pendingImport.oralLogs.length} 条口服、${pendingImport.symptoms.length} 条症状记录。重复的记录会自动跳过（按分钟比对），导入后可以逐条删除。`
            : ''
        }
        confirmLabel="导入"
        busy={importing}
        onCancel={() => {
          if (!importing) {
            setPendingImport(null)
            setImportPreview(null)
          }
        }}
        onConfirm={() => {
          void runImport()
        }}
      />

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
        title="停用当前治疗方案？"
        message="停用后会取消所有已排程的提醒，历史记录仍会保留。可以重新编辑并启用方案。"
        confirmLabel="停用"
        destructive
        busy={deactivating}
        onCancel={() => {
          if (!deactivating) setDeactivateOpen(false)
        }}
        onConfirm={() => {
          void deactivateTreatment()
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
  iconButton: {
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
  medChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
  },
})
