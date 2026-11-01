import { useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { DISEASE_DISCLAIMER, DISEASE_GROUPS, diseasesByGroup } from '@/data/diseases'
import {
  DRUGS_BY_KEY,
  diseaseIdsForDrug,
  drugsForDiseases,
  regimenForDiseases,
} from '@/data/catalog'
import {
  medications as medicationRepo,
  reminderRules,
  settings as settingsRepo,
  treatments as treatmentRepo,
} from '@/db/repo'
import { rescheduleAll, ensurePermissions } from '@/notify/scheduler'
import { useAppStore, errorMessage } from '@/store/app'
import type { Disease, MedicationRoute, PhaseKind, RegimenPhaseTemplate } from '@/types'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Chip } from '@/ui/components/Chip'
import { TextField } from '@/ui/components/Field'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Stepper } from '@/ui/components/Stepper'
import { TimeOfDayField } from '@/ui/components/TimeField'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Layout'
import { toast, ToastHost } from '@/ui/components/Toast'
import { parseTimeOfDay } from '@/ui/components/date'

const CUSTOM_KEY = '__custom__'

interface EditablePhase {
  key: string
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  doseText: string
  unit: string
}

interface PreviewDose {
  index: number
  dayOffset: number
  kind: PhaseKind
  doseText: string
  unit: string
}

type DiseaseRow =
  | { type: 'header'; key: string; title: string }
  | { type: 'disease'; key: string; disease: Disease }

function toEditablePhases(
  template: RegimenPhaseTemplate[],
  fallback: { doseText: string; unit: string },
): EditablePhase[] {
  if (template.length === 0) {
    return [
      {
        key: 'phase-0',
        kind: 'maintenance',
        intervalDays: 28,
        repeatCount: 0,
        doseText: fallback.doseText,
        unit: fallback.unit || 'mg',
      },
    ]
  }
  return template.map((phase, index) => ({
    key: `phase-${index}`,
    kind: phase.kind,
    intervalDays: phase.intervalDays,
    repeatCount: phase.repeatCount,
    doseText: phase.dose !== null ? String(phase.dose) : '',
    unit: phase.unit,
  }))
}

function buildPreview(phases: EditablePhase[], max: number = 5): PreviewDose[] {
  if (phases.length === 0) return []
  const result: PreviewDose[] = [
    {
      index: 0,
      dayOffset: 0,
      kind: phases[0].kind,
      doseText: phases[0].doseText,
      unit: phases[0].unit,
    },
  ]
  let dayOffset = 0
  let guard = 0
  for (const phase of phases) {
    const repeats = phase.repeatCount === 0 ? max : phase.repeatCount
    for (let i = 0; i < repeats && result.length < max; i += 1) {
      dayOffset += Math.max(1, phase.intervalDays)
      result.push({
        index: result.length,
        dayOffset,
        kind: phase.kind,
        doseText: phase.doseText,
        unit: phase.unit,
      })
    }
    guard += 1
    if (result.length >= max || guard > 60) break
  }
  return result
}

function phaseLabel(kind: PhaseKind): string {
  return kind === 'loading' ? zh.settings.phaseLoading : zh.settings.phaseMaintenance
}

function routeLabel(route: MedicationRoute): string {
  if (route === 'iv') return '医院输注'
  if (route === 'oral') return '口服'
  return '皮下注射'
}

export default function OnboardingScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [step, setStep] = useState(0)
  const [query, setQuery] = useState('')
  const [diseaseIds, setDiseaseIds] = useState<string[]>([])

  const [drugKey, setDrugKey] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customGeneric, setCustomGeneric] = useState('')
  const [customRoute, setCustomRoute] = useState<MedicationRoute>('sc')
  const [customDose, setCustomDose] = useState('')
  const [customUnit, setCustomUnit] = useState('mg')
  const [customError, setCustomError] = useState<string | null>(null)

  const [treatmentName, setTreatmentName] = useState('')
  const [basePhases, setBasePhases] = useState<EditablePhase[]>([])
  const [phases, setPhases] = useState<EditablePhase[]>([])
  const [noLoading, setNoLoading] = useState(false)

  const [timeOfDay, setTimeOfDay] = useState('09:00')
  const [offsets, setOffsets] = useState<number[]>([-2, -1, 0])
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('08:00')
  const [permission, setPermission] = useState<{ granted: boolean; exactAlarm: boolean } | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [checkingPermission, setCheckingPermission] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  const entries = useMemo(() => drugsForDiseases(diseaseIds), [diseaseIds])
  const selectedEntry = useMemo(
    () => (drugKey && drugKey !== CUSTOM_KEY ? regimenForDiseases(diseaseIds, drugKey) : undefined),
    [diseaseIds, drugKey],
  )

  const selectedRoute: MedicationRoute =
    drugKey === CUSTOM_KEY
      ? customRoute
      : drugKey && DRUGS_BY_KEY[drugKey]?.route === 'iv'
        ? 'iv'
        : 'sc'
  const selectedDrugName =
    drugKey === CUSTOM_KEY
      ? customName.trim() || '自定义药物'
      : drugKey
        ? DRUGS_BY_KEY[drugKey]?.name ?? '所选药物'
        : '所选药物'

  const diseaseRows = useMemo<DiseaseRow[]>(() => {
    const keyword = query.trim().toLowerCase()
    const rows: DiseaseRow[] = []
    for (const group of DISEASE_GROUPS) {
      const matches = diseasesByGroup(group.id).filter((disease) => {
        if (keyword === '') return true
        if (disease.name.toLowerCase().includes(keyword)) return true
        return disease.aliases.some((alias) => alias.toLowerCase().includes(keyword))
      })
      if (matches.length === 0) continue
      rows.push({ type: 'header', key: `group-${group.id}`, title: group.name })
      for (const disease of matches) {
        rows.push({ type: 'disease', key: disease.id, disease })
      }
    }
    return rows
  }, [query])

  useEffect(() => {
    if (step !== 3) return
    let alive = true
    setCheckingPermission(true)
    ensurePermissions()
      .then((result) => {
        if (alive) {
          setPermission(result)
          setPermissionError(null)
        }
      })
      .catch((error: unknown) => {
        if (alive) setPermissionError(errorMessage(error))
      })
      .finally(() => {
        if (alive) setCheckingPermission(false)
      })
    return () => {
      alive = false
    }
  }, [step])

  const hasLoadingPhase = basePhases.some((phase) => phase.kind === 'loading')
  const preview = useMemo(() => buildPreview(phases), [phases])

  const selectDisease = (disease: Disease) => {
    setDiseaseIds((current) => {
      const next = current.includes(disease.id)
        ? current.filter((id) => id !== disease.id)
        : [...current, disease.id]

      // 取消某个病种后，原先选的药可能就不再适用了。
      if (drugKey && drugKey !== CUSTOM_KEY) {
        const stillAvailable = drugsForDiseases(next).some((item) => item.drug.key === drugKey)
        if (!stillAvailable) {
          setDrugKey(null)
          setCustomOpen(false)
          setCustomError(null)
        }
      }
      return next
    })
  }

  const customProblem = (): string | null => {
    if (customName.trim() === '') return '请输入药物名称。'
    if (customUnit.trim() === '') return '请输入剂量单位。'
    if (customDose.trim() !== '') {
      const dose = Number(customDose.trim())
      if (!Number.isFinite(dose) || dose < 0) return '默认剂量必须是大于或等于 0 的数字。'
    }
    return null
  }

  const validateCustom = (): boolean => {
    const problem = customProblem()
    setCustomError(problem)
    return problem === null
  }

  const goNext = () => {
    if (step === 0) {
      if (diseaseIds.length === 0) {
        toast('请至少选择一个病种')
        return
      }
      setStep(1)
      return
    }

    if (step === 1) {
      if (!drugKey) {
        toast('请选择一种药物，或使用自定义药物')
        return
      }
      if (drugKey === CUSTOM_KEY) {
        if (!validateCustom()) {
          toast(customProblem() ?? '请检查自定义药物信息', 'error')
          return
        }
        const fallback = { doseText: customDose.trim(), unit: customUnit.trim() || 'mg' }
        setBasePhases(toEditablePhases([], fallback))
        setPhases(toEditablePhases([], fallback))
        setNoLoading(false)
        setTreatmentName(`${customName.trim()} 方案`)
        setStep(2)
        return
      }
      const template = selectedEntry?.regimen.phases ?? []
      const editable = toEditablePhases(template, { doseText: '', unit: 'mg' })
      setBasePhases(editable)
      setPhases(editable)
      setNoLoading(false)
      setTreatmentName(selectedEntry?.regimen.name ?? '我的用药方案')
      setStep(2)
      return
    }

    if (step === 2) {
      if (treatmentName.trim() === '') {
        toast('请给方案起个名字')
        return
      }
      if (phases.length === 0) {
        toast('至少需要一个剂量阶段')
        return
      }
      for (const phase of phases) {
        if (phase.unit.trim() === '') {
          toast('阶段单位不能为空')
          return
        }
        if (phase.doseText.trim() !== '') {
          const dose = Number(phase.doseText.trim())
          if (!Number.isFinite(dose) || dose < 0) {
            toast('剂量必须是大于或等于 0 的数字')
            return
          }
        }
      }
      setStep(3)
    }
  }

  const toggleOffset = (offset: number) => {
    setOffsets((current) =>
      current.includes(offset) ? current.filter((item) => item !== offset) : [...current, offset].sort((a, b) => a - b),
    )
  }

  const toggleNoLoading = (value: boolean) => {
    setNoLoading(value)
    if (!value) {
      setPhases(basePhases)
      return
    }
    const maintenance = basePhases.filter((phase) => phase.kind === 'maintenance')
    if (maintenance.length > 0) {
      setPhases(maintenance)
      return
    }
    const last = basePhases[basePhases.length - 1]
    setPhases([
      {
        key: 'phase-maintenance',
        kind: 'maintenance',
        intervalDays: last?.intervalDays ?? 28,
        repeatCount: 0,
        doseText: last?.doseText ?? '',
        unit: last?.unit ?? 'mg',
      },
    ])
  }

  const updatePhase = (key: string, patch: Partial<EditablePhase>) => {
    setPhases((current) =>
      current.map((phase) => (phase.key === key ? { ...phase, ...patch } : phase)),
    )
  }

  const requestPermission = () => {
    setCheckingPermission(true)
    setPermissionError(null)
    ensurePermissions()
      .then((result) => {
        setPermission(result)
        if (!result.granted) toast('通知权限未开启，仍可先完成设置', 'error')
      })
      .catch((error: unknown) => {
        setPermissionError(errorMessage(error))
      })
      .finally(() => {
        setCheckingPermission(false)
      })
  }

  const finish = async () => {
    setFinishError(null)
    if (diseaseIds.length === 0 || !drugKey) {
      setFinishError('请先完成病种与药物选择。')
      return
    }
    if (offsets.length === 0) {
      setFinishError('至少选择一个提醒时间点。')
      return
    }
    if (!parseTimeOfDay(timeOfDay)) {
      setFinishError('提醒时间格式不合法。')
      return
    }
    if (!parseTimeOfDay(dndStart) || !parseTimeOfDay(dndEnd)) {
      setFinishError('免打扰时间格式不合法。')
      return
    }

    setFinishing(true)
    try {
      let medicationId = ''
      if (drugKey === CUSTOM_KEY) {
        if (!validateCustom()) {
          const problem = customProblem() ?? '自定义药物信息不完整'
          setFinishError(`${problem}请返回第二步检查。`)
          setFinishing(false)
          return
        }
        const dose = customDose.trim() === '' ? null : Number(customDose.trim())
        const medication = await medicationRepo.create({
          name: customName.trim(),
          genericName: customGeneric.trim() === '' ? null : customGeneric.trim(),
          brandNames: [],
          defaultDose: dose,
          unit: customUnit.trim(),
          color: theme.colors.primary,
          route: customRoute,
          diseaseIds,
          catalogKey: null,
          isBuiltin: false,
          extra: {},
        })
        medicationId = medication.id
      } else {
        const existing = (await medicationRepo.list()).find((item) => item.catalogKey === drugKey)
        if (existing) {
          medicationId = existing.id
        } else {
          const drug = DRUGS_BY_KEY[drugKey]
          if (!drug) throw new Error('所选药物不在目录中，请改用自定义药物')
          const medication = await medicationRepo.create({
            name: drug.name,
            genericName: drug.genericName,
            brandNames: drug.brandNames,
            defaultDose: drug.defaultDose,
            unit: drug.unit,
            color: drug.color,
            route: drug.route,
            diseaseIds: diseaseIdsForDrug(drug.key),
            catalogKey: drug.key,
            isBuiltin: true,
            extra: {},
          })
          medicationId = medication.id
        }
      }

      const oralRoute = selectedRoute === 'oral'
      const startOfToday = (() => {
        const date = new Date()
        date.setHours(0, 0, 0, 0)
        return date.getTime()
      })()

      const treatment = await treatmentRepo.create({
        name: treatmentName.trim(),
        lines: [
          oralRoute
            ? {
                medicationId,
                kind: 'oral',
                label: selectedDrugName,
                isHost: false,
                syncWithHost: false,
                anchor: 'actual',
                windowDays: selectedEntry?.regimen.windowDays ?? 2,
                phases: [],
                oral: {
                  startDate: startOfToday,
                  durationDays: null,
                  frequency: 'daily',
                  timesPerPeriod: 1,
                  daysOfWeek: [],
                  remindTime: timeOfDay,
                },
              }
            : {
                medicationId,
                kind: 'injection',
                label: selectedDrugName,
                isHost: true,
                syncWithHost: false,
                anchor: 'actual',
                windowDays: selectedEntry?.regimen.windowDays ?? 2,
                phases: phases.map((phase, index) => ({
                  orderIdx: index,
                  kind: phase.kind,
                  intervalDays: phase.intervalDays,
                  repeatCount: phase.repeatCount,
                  dose: phase.doseText.trim() === '' ? null : Number(phase.doseText.trim()),
                  unit: phase.unit.trim(),
                })),
                oral: null,
              },
        ],
      })
      await treatmentRepo.setActive(treatment.id, true)
      await reminderRules.upsert({
        treatmentId: treatment.id,
        offsets,
        timeOfDay,
        snoozeMinutes: 10,
        enabled: true,
      })
      await settingsRepo.set('disease_ids', JSON.stringify(diseaseIds))
      await settingsRepo.set('disease_id', diseaseIds[0] ?? '')
      await settingsRepo.set('onboarded_at', String(Date.now()))
      await settingsRepo.set('dnd_start', dndStart)
      await settingsRepo.set('dnd_end', dndEnd)

      let warning: string | null = null
      try {
        await rescheduleAll()
      } catch (error) {
        warning = `提醒排程失败：${errorMessage(error)}`
      }
      try {
        await useAppStore.getState().reload()
      } catch (error) {
        warning = warning
          ? `${warning}；数据刷新失败：${errorMessage(error)}`
          : `数据刷新失败：${errorMessage(error)}`
      }

      setFinishing(false)
      router.replace('/')
      toast('设置完成，可以开始记录了', 'success')
      if (warning) toast(warning, 'error')
    } catch (error) {
      setFinishing(false)
      setFinishError(errorMessage(error))
      toast(errorMessage(error), 'error')
    }
  }

  const stepTitles = [
    '选择病种（可多选）',
    zh.onboarding.chooseMedication,
    '确认用药方案',
    zh.onboarding.reminderTitle,
  ]
  const stepHints = [
    '同时有多种免疫介导疾病时可以多选，例如克罗恩病 + 强直性脊柱炎；病种只用于缩小药物列表。',
    '药名与剂量仅用于快速录入，请以医生处方为准。',
    zh.onboarding.loadingDoseHint,
    zh.onboarding.reminderHint,
  ]

  const renderDiseaseStep = () => (
    <FlatList<DiseaseRow>
      data={diseaseRows}
      keyExtractor={(row) => row.key}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: 8,
      }}
      ListHeaderComponent={
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xs }}>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder="搜索病名或别名，如 银屑病 / CD"
            accessibilityLabel="搜索病种"
            returnKeyType="search"
          />
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.xs,
              lineHeight: theme.lineHeight.xs,
            }}
          >
            找不到？可选择最接近的病种，或直接自定义药物。
          </Text>
          {diseaseIds.length > 0 ? (
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.xs }}>
              已选 {diseaseIds.length} 个病种
            </Text>
          ) : null}
        </View>
      }
      ListFooterComponent={
        <View
          style={{
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
            marginTop: theme.spacing.md,
          }}
        >
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.xs,
              lineHeight: theme.lineHeight.md,
            }}
          >
            {DISEASE_DISCLAIMER}
          </Text>
        </View>
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
                marginTop: theme.spacing.md,
              }}
            >
              {item.title}
            </Text>
          )
        }
        const selected = diseaseIds.includes(item.disease.id)
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={item.disease.name}
            accessibilityState={{ checked: selected }}
            onPress={() => selectDisease(item.disease)}
            style={({ pressed }) => [
              styles.rowCard,
              {
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: theme.fontSize.md,
                  fontWeight: '600',
                }}
              >
                {item.disease.name}
              </Text>
              <Text
                numberOfLines={2}
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: theme.fontSize.xs,
                  lineHeight: theme.lineHeight.xs,
                }}
              >
                {item.disease.summary}
              </Text>
              {item.disease.aliases.length > 0 ? (
                <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                  别名：{item.disease.aliases.join('、')}
                </Text>
              ) : null}
            </View>
            {selected ? (
              <Icon name="check" size={20} color={theme.colors.primary} strokeWidth={2.5} />
            ) : (
              <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
            )}
          </Pressable>
        )
      }}
      ListEmptyComponent={
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            textAlign: 'center',
            paddingVertical: theme.spacing.xl,
          }}
        >
          没有匹配的病种，换个关键词试试。
        </Text>
      }
    />
  )

  const renderMedicationStep = () => (
    <FlatList
      data={entries}
      keyExtractor={(item) => item.drug.key}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: 8,
      }}
      ListHeaderComponent={
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="我的药不在列表里，自定义录入"
            accessibilityState={{ expanded: customOpen }}
            onPress={() => {
              setCustomOpen((open) => !open)
              setDrugKey(CUSTOM_KEY)
            }}
            style={({ pressed }) => [
              styles.customHeader,
              {
                borderColor: drugKey === CUSTOM_KEY ? theme.colors.primary : theme.colors.border,
                backgroundColor:
                  drugKey === CUSTOM_KEY ? theme.colors.primaryMuted : theme.colors.surface,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: theme.fontSize.md,
                  fontWeight: '600',
                }}
              >
                我的药不在列表里
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                手动填写药名、剂型与默认剂量
              </Text>
            </View>
            <View style={styles.customToggle}>
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.md }}>
                {customOpen ? '收起' : '展开'}
              </Text>
              <Icon
                name={customOpen ? 'chevron-left' : 'plus'}
                size={18}
                color={theme.colors.textTertiary}
              />
            </View>
          </Pressable>

          {customOpen ? (
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                <TextField
                  label={zh.onboarding.medicationName}
                  value={customName}
                  onChangeText={setCustomName}
                  placeholder="例如：某单抗"
                  accessibilityLabel="自定义药物名称"
                />
                <TextField
                  label={`${zh.onboarding.genericName}（${zh.common.optional}）`}
                  value={customGeneric}
                  onChangeText={setCustomGeneric}
                  placeholder="通用名"
                  accessibilityLabel="自定义药物通用名"
                />
                <View style={{ gap: 6 }}>
                  <Text
                    style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
                  >
                    给药途径
                  </Text>
                  <SegmentedControl<MedicationRoute>
                    options={[
                      { value: 'sc', label: '皮下注射' },
                      { value: 'iv', label: '医院输注' },
                      { value: 'oral', label: '口服' },
                    ]}
                    value={customRoute}
                    onChange={setCustomRoute}
                    accessibilityLabel="给药途径"
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={zh.onboarding.defaultDose}
                      value={customDose}
                      onChangeText={setCustomDose}
                      keyboardType="decimal-pad"
                      placeholder="40"
                      accessibilityLabel="自定义药物默认剂量"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label={zh.onboarding.unit}
                      value={customUnit}
                      onChangeText={setCustomUnit}
                      placeholder="mg"
                      accessibilityLabel="自定义药物剂量单位"
                    />
                  </View>
                </View>
                {customError ? (
                  <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.xs }}>
                    {customError}
                  </Text>
                ) : null}
              </View>
            </Card>
          ) : null}

          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.xs,
            }}
          >
            选择后可在下一步调整间隔；实际用法请以医生处方为准。
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const selected = drugKey === item.drug.key
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.drug.name}${item.entry.firstLine ? '，常用' : ''}`}
            accessibilityState={{ selected }}
            onPress={() => {
              setDrugKey(item.drug.key)
              setCustomOpen(false)
            }}
            style={({ pressed }) => [
              styles.rowCard,
              {
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.fontSize.md,
                    fontWeight: '600',
                  }}
                >
                  {item.drug.name}
                </Text>
                {item.entry.firstLine ? (
                  <View
                    style={{
                      backgroundColor: theme.colors.successMuted,
                      borderRadius: theme.radius.pill,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.colors.success,
                        fontSize: theme.fontSize.xs,
                        fontWeight: '600',
                      }}
                    >
                      常用
                    </Text>
                  </View>
                ) : null}
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceMuted,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                    {item.drug.route === 'iv' ? '医院输注' : '皮下'}
                  </Text>
                </View>
              </View>
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                商品名：{item.drug.brandNames.join('、') || '—'}
              </Text>
              {item.entry.doseNote ? (
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.fontSize.xs,
                    lineHeight: theme.lineHeight.xs,
                  }}
                >
                  {item.entry.doseNote}
                </Text>
              ) : null}
            </View>
            {selected ? (
              <Icon name="check" size={20} color={theme.colors.primary} strokeWidth={2.5} />
            ) : (
              <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
            )}
          </Pressable>
        )
      }}
      ListEmptyComponent={
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            textAlign: 'center',
            paddingVertical: theme.spacing.xl,
          }}
        >
          该病种暂未收录药物，请用上方的自定义录入。
        </Text>
      }
      ListFooterComponent={
        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            lineHeight: theme.lineHeight.xs,
            paddingTop: theme.spacing.md,
          }}
        >
          同一通用名下的国产药（生物类似药）药效相同，选任意一个品牌都能用。若你的品牌没列出来，按通用名选即可，或用上方的自定义录入。
        </Text>
      }
    />
  )

  const renderRegimenStep = () => (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      <View
        style={{
          backgroundColor: theme.colors.primaryMuted,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          gap: 2,
        }}
      >
        <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
          {selectedDrugName}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
          {routeLabel(selectedRoute)}
        </Text>
      </View>

      <TextField
        label={zh.settings.regimenName}
        value={treatmentName}
        onChangeText={setTreatmentName}
        placeholder="例如：阿达木单抗 每 2 周"
        accessibilityLabel="用药方案名称"
      />

      {hasLoadingPhase ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
              只做提醒，不设负荷期
            </Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              开启后会移除负荷剂量阶段，只保留维持阶段。
            </Text>
          </View>
          <Switch
            accessibilityLabel="只做提醒，不设负荷期"
            value={noLoading}
            onValueChange={toggleNoLoading}
            trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
            thumbColor={theme.colors.surface}
          />
        </View>
      ) : null}

      {phases.map((phase, index) => (
        <Card key={phase.key}>
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '700' }}>
                阶段 {index + 1}
              </Text>
              <View
                style={{
                  backgroundColor:
                    phase.kind === 'loading'
                      ? theme.colors.warningMuted
                      : theme.colors.successMuted,
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text
                  style={{
                    color:
                      phase.kind === 'loading'
                        ? theme.colors.warning
                        : theme.colors.success,
                    fontSize: theme.fontSize.xs,
                  }}
                >
                  {phaseLabel(phase.kind)}
                </Text>
              </View>
            </View>
            <Stepper
              label={zh.settings.intervalDays}
              value={phase.intervalDays}
              onChange={(value) => updatePhase(phase.key, { intervalDays: value })}
              min={1}
              max={365}
              suffix={zh.common.unitDay}
              decreaseLabel="间隔减少一天"
              increaseLabel="间隔增加一天"
            />
            <Stepper
              label={zh.settings.repeatCount}
              value={phase.repeatCount}
              onChange={(value) => updatePhase(phase.key, { repeatCount: value })}
              min={0}
              max={52}
              suffix="次"
              decreaseLabel="重复次数减少"
              increaseLabel="重复次数增加"
            />
            <TextField
              label={`${zh.settings.dose}（${zh.common.optional}）`}
              value={phase.doseText}
              onChangeText={(value) => updatePhase(phase.key, { doseText: value })}
              keyboardType="decimal-pad"
              placeholder="留空表示不记录剂量"
              suffix={phase.unit}
              accessibilityLabel={`阶段 ${index + 1} 剂量`}
            />
          </View>
        </Card>
      ))}

      <Card tone="primary">
        <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '700' }}>
          方案总览
        </Text>
        <View style={{ marginTop: theme.spacing.sm, gap: 4 }}>
          {preview.map((dose) => (
            <Text
              key={`preview-${dose.index}`}
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
            >
              {dose.index === 0
                ? `第 1 针：首针（${phaseLabel(dose.kind)}）`
                : `第 ${dose.index + 1} 针：首针后 ${dose.dayOffset} 天（${phaseLabel(dose.kind)}）`}
              {dose.doseText ? ` · ${dose.doseText} ${dose.unit}` : ''}
            </Text>
          ))}
          {preview.length >= 5 ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              …后续按阶段顺序继续推进
            </Text>
          ) : null}
        </View>
        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            lineHeight: theme.lineHeight.xs,
            marginTop: theme.spacing.sm,
          }}
        >
          以上仅为根据你填写的参数推算的时间，请以医生处方为准。
        </Text>
      </Card>

      <Text
        style={{
          color: theme.colors.textTertiary,
          fontSize: theme.fontSize.xs,
          lineHeight: theme.lineHeight.xs,
        }}
      >
        {DISEASE_DISCLAIMER}
      </Text>
    </ScrollView>
  )

  const renderReminderStep = () => (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
    >
      <Card>
        <TimeOfDayField label={zh.settings.reminderTime} value={timeOfDay} onChange={setTimeOfDay} />
      </Card>

      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '500' }}>
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
              selected={offsets.includes(item.value)}
              onPress={() => toggleOffset(item.value)}
              accessibilityLabel={item.label}
            />
          ))}
        </View>
      </View>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
            免打扰时段
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            这段时间内不会投递通知，会在结束后顺延。
          </Text>
          <View style={{ gap: theme.spacing.md }}>
            <TimeOfDayField label="开始" value={dndStart} onChange={setDndStart} />
            <TimeOfDayField label="结束" value={dndEnd} onChange={setDndEnd} />
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
            通知权限
          </Text>
          {checkingPermission ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              正在检查通知权限…
            </Text>
          ) : permission?.granted ? (
            <>
              <Text style={{ color: theme.colors.success, fontSize: theme.fontSize.sm }}>
                通知权限已开启。
              </Text>
              {!permission.exactAlarm ? (
                <Text style={{ color: theme.colors.warning, fontSize: theme.fontSize.xs }}>
                  Android 可能无法精确到分钟，可在系统设置中允许精确闹钟。
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={{ color: theme.colors.warning, fontSize: theme.fontSize.sm }}>
                未获得通知权限，到点提醒可能不会出现。
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                可在系统设置 → 应用 → BioClock → 通知中手动开启。
              </Text>
            </>
          )}
          {permissionError ? (
            <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.xs }}>
              {permissionError}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button
              label={permission?.granted ? '重新检查' : '允许通知'}
              onPress={requestPermission}
              variant="secondary"
              loading={checkingPermission}
              style={{ flex: 1 }}
            />
            <Button
              label="打开系统设置"
              onPress={() => {
                Linking.openSettings().catch(() => {
                  toast('无法打开系统设置，请手动前往。', 'error')
                })
              }}
              variant="outline"
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Card>

      {finishError ? (
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: theme.colors.dangerMuted,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm }}>
            {finishError}
          </Text>
        </View>
      ) : null}

      <Text
        style={{
          color: theme.colors.textTertiary,
          fontSize: theme.fontSize.xs,
          lineHeight: theme.lineHeight.xs,
          textAlign: 'center',
        }}
      >
        {zh.disclaimer.short}
      </Text>
    </ScrollView>
  )

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zh.common.previous}
                accessibilityState={{ disabled: finishing }}
                disabled={finishing}
                onPress={() => {
                  setFinishError(null)
                  setStep((value) => Math.max(0, value - 1))
                }}
                style={({ pressed }) => [
                  styles.backButton,
                  {
                    borderRadius: theme.radius.pill,
                    backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                  },
                ]}
              >
                <Icon name="chevron-left" size={22} color={theme.colors.text} />
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: theme.colors.text,
                  fontSize: theme.fontSize.xl,
                  fontWeight: '700',
                }}
              >
                {stepTitles[step]}
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                第 {step + 1} 步 / 共 4 步
              </Text>
            </View>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '600' }}>
              BioClock
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[0, 1, 2, 3].map((index) => (
              <View
                key={index}
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor:
                    index <= step ? theme.colors.primary : theme.colors.surfaceMuted,
                }}
              />
            ))}
          </View>
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.xs,
              lineHeight: theme.lineHeight.xs,
            }}
          >
            {stepHints[step]}
          </Text>
        </View>

        <View style={{ flex: 1, marginTop: theme.spacing.sm }}>
          {step === 0
            ? renderDiseaseStep()
            : step === 1
              ? renderMedicationStep()
              : step === 2
                ? renderRegimenStep()
                : renderReminderStep()}
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: Math.max(insets.bottom, theme.spacing.md),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          }}
        >
          {step > 0 ? (
            <Button
              label={zh.common.previous}
              onPress={() => {
                setFinishError(null)
                setStep((value) => Math.max(0, value - 1))
              }}
              variant="secondary"
              disabled={finishing}
              style={{ flex: 1 }}
            />
          ) : null}
          {step < 3 ? (
            <Button
              label={zh.common.next}
              onPress={goNext}
              disabled={step === 0 ? diseaseIds.length === 0 : step === 1 ? !drugKey : false}
              style={{ flex: 2 }}
            />
          ) : (
            <Button
              label={zh.onboarding.finish}
              onPress={() => {
                void finish()
              }}
              loading={finishing}
              size="lg"
              style={{ flex: 2 }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
      <ToastHost />
    </Screen>
  )
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    padding: 14,
    minHeight: 64,
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    padding: 14,
    minHeight: 56,
  },
  customToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
})
