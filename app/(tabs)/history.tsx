import { useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme, type Theme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import type { DoseLog, DoseStatus, MedicationRoute, SymptomLog, TreatmentLine } from '@/types'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { ActionSheet } from '@/ui/components/ActionSheet'
import { Screen, ScreenHeader } from '@/ui/components/Layout'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StateView, LoadingView } from '@/ui/components/StateView'
import { Fab } from '@/ui/components/Fab'
import { Icon } from '@/ui/components/Icon'
import { toast } from '@/ui/components/Toast'
import {
  formatDate,
  formatMonth,
  formatRelativeDay,
  formatTime,
  formatWeekday,
  monthKey,
} from '@/ui/components/date'
import { SITE_LABELS } from '@/domain/rotation'

type TabKey = 'injection' | 'oral' | 'symptom'

type HistoryRow =
  | { kind: 'header'; id: string; title: string }
  | { kind: 'dose'; id: string; doseLog: DoseLog; lineKind: 'injection' | 'oral' }
  | { kind: 'symptom'; id: string; symptom: SymptomLog }

interface DeleteTarget {
  kind: TabKey
  id: string
  title: string
  message: string
}

const SEVERITY_LABELS: string[] = [
  zh.form.severity1,
  zh.form.severity2,
  zh.form.severity3,
  zh.form.severity4,
  zh.form.severity5,
]

const DOSE_STATUS_LABELS: Record<DoseStatus, string> = {
  done: '完成',
  skipped: '跳过',
  missed: '漏服',
}

function severityColor(theme: Theme, severity: number): string {
  if (severity <= 1) return theme.colors.success
  if (severity === 2) return theme.colors.primary
  if (severity === 3) return theme.colors.warning
  return theme.colors.danger
}

/** 用药记录的实际时间：优先打卡时间，其次计划时间。 */
function logTime(log: DoseLog): number {
  return log.takenAt ?? log.scheduledAt ?? log.createdAt
}

export default function HistoryScreen() {
  const theme = useTheme()
  const router = useRouter()
  const ready = useAppStore((state) => state.ready)
  const treatment = useAppStore((state) => state.treatment)
  const doseLogs = useAppStore((state) => state.doseLogs)
  const symptoms = useAppStore((state) => state.symptoms)
  const medications = useAppStore((state) => state.medications)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)
  const removeDoseLog = useAppStore((state) => state.removeDoseLog)
  const removeSymptom = useAppStore((state) => state.removeSymptom)

  const [tab, setTab] = useState<TabKey>('injection')
  const [doseMenu, setDoseMenu] = useState<{ log: DoseLog; lineKind: 'injection' | 'oral' } | null>(
    null,
  )
  const [symptomMenu, setSymptomMenu] = useState<SymptomLog | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  const medicationNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const medication of medications) map.set(medication.id, medication.name)
    return map
  }, [medications])

  const medicationRoutes = useMemo(() => {
    const map = new Map<string, MedicationRoute>()
    for (const medication of medications) map.set(medication.id, medication.route)
    return map
  }, [medications])

  const lineById = useMemo(() => {
    const map = new Map<string, TreatmentLine>()
    for (const line of treatment?.lines ?? []) map.set(line.id, line)
    return map
  }, [treatment])

  const doseLogById = useMemo(() => {
    const map = new Map<string, DoseLog>()
    for (const log of doseLogs) map.set(log.id, log)
    return map
  }, [doseLogs])

  const nameOfLine = useCallback(
    (lineId: string): string => {
      const line = lineById.get(lineId)
      if (!line) return zh.common.unknown
      return medicationNames.get(line.medicationId) ?? line.label ?? zh.common.unknown
    },
    [lineById, medicationNames],
  )

  const routeOfLine = useCallback(
    (lineId: string): MedicationRoute | undefined => {
      const line = lineById.get(lineId)
      return line ? medicationRoutes.get(line.medicationId) : undefined
    },
    [lineById, medicationRoutes],
  )

  const doseRows = useCallback(
    (lineKind: 'injection' | 'oral'): HistoryRow[] => {
      const sorted = doseLogs
        .filter((log) => lineById.get(log.lineId)?.kind === lineKind)
        .sort((a, b) => logTime(b) - logTime(a))
      const rows: HistoryRow[] = []
      let lastMonth = ''
      for (const log of sorted) {
        const at = logTime(log)
        const month = monthKey(at)
        if (month !== lastMonth) {
          lastMonth = month
          rows.push({ kind: 'header', id: `month-${month}`, title: formatMonth(at) })
        }
        rows.push({ kind: 'dose', id: log.id, doseLog: log, lineKind })
      }
      return rows
    },
    [doseLogs, lineById],
  )

  const injectionRows = useMemo(() => doseRows('injection'), [doseRows])
  const oralRows = useMemo(() => doseRows('oral'), [doseRows])

  const symptomRows = useMemo<HistoryRow[]>(() => {
    return [...symptoms]
      .sort((a, b) => b.loggedAt - a.loggedAt)
      .map((symptom) => ({ kind: 'symptom', id: symptom.id, symptom }))
  }, [symptoms])

  const refresh = useCallback(() => {
    reload().catch((error: unknown) => {
      toast(errorMessage(error), 'error')
    })
  }, [reload])

  const openNew = (target: TabKey) => {
    if (target === 'injection') router.push('/modal/injection')
    else if (target === 'oral') router.push('/modal/oral')
    else router.push('/modal/symptom')
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result =
        deleteTarget.kind === 'symptom'
          ? await removeSymptom(deleteTarget.id)
          : await removeDoseLog(deleteTarget.id)
      setDeleteTarget(null)
      toast('已删除', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const renderDose = (log: DoseLog, lineKind: 'injection' | 'oral') => {
    const at = logTime(log)
    const name = nameOfLine(log.lineId)
    const doseText = log.dose !== null ? `${log.dose} ${log.unit}`.trim() : '剂量未记录'
    const summary = lineKind === 'injection' ? `${name} · ${doseText}` : name

    return (
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ width: 58 }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.fontSize.lg,
              fontWeight: '700',
            }}
          >
            {new Date(at).getDate()} 日
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            {formatWeekday(at)} {formatTime(at)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${summary}，长按编辑或删除`}
          accessibilityHint="长按打开操作菜单"
          onLongPress={() => setDoseMenu({ log, lineKind })}
          delayLongPress={350}
          style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
        >
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.fontSize.md,
              fontWeight: '600',
            }}
          >
            {summary}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 2 }}>
            {lineKind === 'injection'
              ? [
                  log.site
                    ? SITE_LABELS[log.site]
                    : routeOfLine(log.lineId) === 'iv'
                      ? '医院输注'
                      : null,
                  log.lotNumber ? `批号 ${log.lotNumber}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '注射'
              : `${DOSE_STATUS_LABELS[log.status]} · ${doseText}`}
          </Text>
          {log.note ? (
            <Text
              numberOfLines={2}
              style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, marginTop: 2 }}
            >
              {log.note}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="用药记录操作"
          onPress={() => setDoseMenu({ log, lineKind })}
          style={({ pressed }) => [
            styles.menuButton,
            { opacity: pressed ? 0.5 : 1, borderRadius: theme.radius.sm },
          ]}
        >
          <Icon name="more" size={20} color={theme.colors.textTertiary} strokeWidth={2.5} />
        </Pressable>
      </View>
    )
  }

  const renderSymptom = (symptom: SymptomLog) => {
    const color = severityColor(theme, symptom.severity)
    const related = symptom.injectionId ? doseLogById.get(symptom.injectionId) : undefined
    return (
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: color,
              borderWidth: symptom.severity === 5 ? 2 : 0,
              borderColor: theme.colors.text,
            }}
          />
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
            {SEVERITY_LABELS[symptom.severity - 1]}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, marginLeft: 'auto' }}>
            {formatRelativeDay(symptom.loggedAt)} {formatTime(symptom.loggedAt)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="症状记录操作"
            onPress={() => setSymptomMenu(symptom)}
            style={({ pressed }) => [
              styles.menuButton,
              { opacity: pressed ? 0.5 : 1, borderRadius: theme.radius.sm },
            ]}
          >
            <Icon name="more" size={20} color={theme.colors.textTertiary} strokeWidth={2.5} />
          </Pressable>
        </View>
        {symptom.tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {symptom.tags.map((tag) => (
              <View
                key={tag}
                style={{
                  backgroundColor: theme.colors.surfaceMuted,
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {symptom.painScore !== null ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              {zh.history.painLabel} {symptom.painScore}/10
            </Text>
          ) : null}
          {symptom.temperature !== null ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              体温 {symptom.temperature}℃
            </Text>
          ) : null}
          {related ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              关联注射 {formatDate(logTime(related))} · {nameOfLine(related.lineId)}
            </Text>
          ) : null}
        </View>
        {symptom.note ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.fontSize.sm,
              lineHeight: theme.lineHeight.md,
            }}
          >
            {symptom.note}
          </Text>
        ) : null}
      </View>
    )
  }

  const renderRow = (row: HistoryRow) => {
    if (row.kind === 'header') {
      return (
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            fontWeight: '600',
            marginTop: theme.spacing.md,
            marginBottom: 2,
          }}
        >
          {row.title}
        </Text>
      )
    }
    if (row.kind === 'dose') return renderDose(row.doseLog, row.lineKind)
    return renderSymptom(row.symptom)
  }

  if (!ready) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    )
  }

  const data =
    tab === 'injection' ? injectionRows : tab === 'oral' ? oralRows : symptomRows

  const subtitle =
    tab === 'injection'
      ? `共 ${injectionRows.filter((row) => row.kind === 'dose').length} 条注射记录`
      : tab === 'oral'
        ? `共 ${oralRows.filter((row) => row.kind === 'dose').length} 条口服打卡`
        : `共 ${symptoms.length} 条症状记录`

  const emptyConfig =
    tab === 'injection'
      ? {
          icon: 'syringe' as const,
          title: zh.empty.historyNoInjection,
          message: '登记后，这里会按月展示你的注射时间线。',
          actionLabel: zh.history.addInjection,
        }
      : tab === 'oral'
        ? {
            icon: 'smile' as const,
            title: '暂无口服打卡',
            message: '在「今天」或这里记录口服用药的完成情况。',
            actionLabel: '新增口服打卡',
          }
        : {
            icon: 'smile' as const,
            title: zh.empty.historyNoSymptom,
            message: '记录注射后出现的症状，方便复诊时回顾。',
            actionLabel: zh.history.addSymptom,
          }

  return (
    <Screen>
      <ScreenHeader title={zh.history.title} subtitle={subtitle} />
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <SegmentedControl<TabKey>
          options={[
            { value: 'injection', label: zh.history.injectionTab },
            { value: 'oral', label: '口服' },
            { value: 'symptom', label: zh.history.symptomTab },
          ]}
          value={tab}
          onChange={setTab}
          accessibilityLabel="记录类型"
        />
      </View>

      <FlatList<HistoryRow>
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderRow(item)}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.xs,
          paddingBottom: 120,
          gap: 8,
        }}
        refreshing={refreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          <StateView
            icon={emptyConfig.icon}
            title={emptyConfig.title}
            message={emptyConfig.message}
            actionLabel={emptyConfig.actionLabel}
            onAction={() => openNew(tab)}
          />
        }
      />

      <Fab
        label={
          tab === 'injection'
            ? zh.history.addInjection
            : tab === 'oral'
              ? '新增口服打卡'
              : zh.history.addSymptom
        }
        onPress={() => openNew(tab)}
        accessibilityLabel={
          tab === 'injection'
            ? '新增注射记录'
            : tab === 'oral'
              ? '新增口服打卡'
              : '新增症状记录'
        }
      />

      <ActionSheet
        visible={doseMenu !== null}
        title={
          doseMenu
            ? `${formatDate(logTime(doseMenu.log))} · ${nameOfLine(doseMenu.log.lineId)}`
            : undefined
        }
        actions={
          doseMenu && doseMenu.lineKind === 'injection'
            ? [
                {
                  label: zh.common.edit,
                  onPress: () => {
                    const target = doseMenu.log
                    setDoseMenu(null)
                    router.push({ pathname: '/modal/injection', params: { id: target.id } })
                  },
                },
                {
                  label: zh.common.delete,
                  destructive: true,
                  onPress: () => {
                    const target = doseMenu.log
                    setDoseMenu(null)
                    setDeleteTarget({
                      kind: 'injection',
                      id: target.id,
                      title: zh.history.deleteInjectionTitle,
                      message: zh.history.deleteInjectionMessage,
                    })
                  },
                },
              ]
            : [
                {
                  label: zh.common.edit,
                  onPress: () => {
                    if (!doseMenu) return
                    const target = doseMenu.log
                    setDoseMenu(null)
                    router.push({ pathname: '/modal/oral', params: { id: target.id } })
                  },
                },
                {
                  label: zh.common.delete,
                  destructive: true,
                  onPress: () => {
                    if (!doseMenu) return
                    const target = doseMenu.log
                    setDoseMenu(null)
                    setDeleteTarget({
                      kind: 'oral',
                      id: target.id,
                      title: '删除这条口服打卡？',
                      message: '删除后该次打卡会从时间线里移除，此操作不可恢复。',
                    })
                  },
                },
              ]
        }
        onClose={() => setDoseMenu(null)}
      />

      <ActionSheet
        visible={symptomMenu !== null}
        title={
          symptomMenu
            ? `${formatDate(symptomMenu.loggedAt)} ${formatTime(symptomMenu.loggedAt)} · 严重度 ${symptomMenu.severity}`
            : undefined
        }
        actions={[
          {
            label: zh.common.edit,
            onPress: () => {
              const target = symptomMenu
              setSymptomMenu(null)
              if (target) {
                router.push({ pathname: '/modal/symptom', params: { id: target.id } })
              }
            },
          },
          {
            label: zh.common.delete,
            destructive: true,
            onPress: () => {
              const target = symptomMenu
              setSymptomMenu(null)
              if (target) {
                setDeleteTarget({
                  kind: 'symptom',
                  id: target.id,
                  title: zh.history.deleteSymptomTitle,
                  message: zh.history.deleteSymptomMessage,
                })
              }
            },
          },
        ]}
        onClose={() => setSymptomMenu(null)}
      />

      <ConfirmDialog
        visible={deleteTarget !== null}
        title={deleteTarget?.title ?? ''}
        message={deleteTarget?.message}
        confirmLabel={zh.common.delete}
        destructive
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  menuButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
