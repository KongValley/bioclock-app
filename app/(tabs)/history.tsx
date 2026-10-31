import { useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme, type Theme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import type { Injection, MedicationRoute, SymptomLog } from '@/types'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { ActionSheet } from '@/ui/components/ActionSheet'
import { Screen, ScreenHeader } from '@/ui/components/Layout'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StateView, LoadingView } from '@/ui/components/StateView'
import { Fab } from '@/ui/components/Fab'
import { toast } from '@/ui/components/Toast'
import { formatDate, formatMonth, formatRelativeDay, formatTime, formatWeekday, monthKey } from '@/ui/components/date'
import { SITE_LABELS } from '@/domain/rotation'

type TabKey = 'injection' | 'symptom'

type HistoryRow =
  | { kind: 'header'; id: string; title: string }
  | { kind: 'injection'; id: string; injection: Injection }
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

function severityColor(theme: Theme, severity: number): string {
  if (severity <= 1) return theme.colors.success
  if (severity === 2) return theme.colors.primary
  if (severity === 3) return theme.colors.warning
  return theme.colors.danger
}

function injectionSummary(injection: Injection, medications: Map<string, string>): string {
  const medication = medications.get(injection.medicationId) ?? zh.common.unknown
  const dose = injection.dose !== null ? `${injection.dose} ${injection.unit}` : '剂量未记录'
  return `${medication} · ${dose}`
}

export default function HistoryScreen() {
  const theme = useTheme()
  const router = useRouter()
  const ready = useAppStore((state) => state.ready)
  const injections = useAppStore((state) => state.injections)
  const regimen = useAppStore((state) => state.regimen)
  const symptoms = useAppStore((state) => state.symptoms)
  const medications = useAppStore((state) => state.medications)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)
  const removeInjection = useAppStore((state) => state.removeInjection)
  const removeSymptom = useAppStore((state) => state.removeSymptom)

  const [tab, setTab] = useState<TabKey>('injection')
  const [menuTarget, setMenuTarget] = useState<Injection | null>(null)
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

  const injectionRows = useMemo<HistoryRow[]>(() => {
    const sorted = [...injections].sort((a, b) => b.injectedAt - a.injectedAt)
    const rows: HistoryRow[] = []
    let lastMonth = ''
    for (const injection of sorted) {
      const month = monthKey(injection.injectedAt)
      if (month !== lastMonth) {
        lastMonth = month
        rows.push({ kind: 'header', id: `month-${month}`, title: formatMonth(injection.injectedAt) })
      }
      rows.push({ kind: 'injection', id: injection.id, injection })
    }
    return rows
  }, [injections])

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

  const openNewInjection = () => {
    if (regimen) {
      router.push('/modal/injection')
    } else {
      router.push('/onboarding')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result =
        deleteTarget.kind === 'injection'
          ? await removeInjection(deleteTarget.id)
          : await removeSymptom(deleteTarget.id)
      setDeleteTarget(null)
      toast('已删除', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const renderInjection = (injection: Injection) => (
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
          {new Date(injection.injectedAt).getDate()} 日
        </Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
          {formatWeekday(injection.injectedAt)} {formatTime(injection.injectedAt)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${injectionSummary(injection, medicationNames)}，长按编辑或删除`}
        accessibilityHint="长按打开编辑与删除操作"
        onLongPress={() => setMenuTarget(injection)}
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
          {injectionSummary(injection, medicationNames)}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.sm,
            marginTop: 2,
          }}
        >
          {medicationRoutes.get(injection.medicationId) === 'iv'
            ? '医院输注'
            : SITE_LABELS[injection.site]}
          {injection.lotNumber ? ` · 批号 ${injection.lotNumber}` : ''}
        </Text>
        {injection.note ? (
          <Text
            numberOfLines={2}
            style={{
              color: theme.colors.textTertiary,
              fontSize: theme.fontSize.xs,
              marginTop: 2,
            }}
          >
            {injection.note}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="注射记录操作"
        onPress={() => setMenuTarget(injection)}
        style={({ pressed }) => [
          styles.menuButton,
          { opacity: pressed ? 0.5 : 1, borderRadius: theme.radius.sm },
        ]}
      >
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }}>⋯</Text>
      </Pressable>
    </View>
  )

  const renderSymptom = (symptom: SymptomLog) => {
    const color = severityColor(theme, symptom.severity)
    const related = symptom.injectionId
      ? injections.find((item) => item.id === symptom.injectionId)
      : undefined
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
            accessibilityLabel="删除这条症状记录"
            onPress={() =>
              setDeleteTarget({
                kind: 'symptom',
                id: symptom.id,
                title: zh.history.deleteSymptomTitle,
                message: zh.history.deleteSymptomMessage,
              })
            }
            style={({ pressed }) => [
              styles.menuButton,
              { opacity: pressed ? 0.5 : 1, borderRadius: theme.radius.sm },
            ]}
          >
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }}>⋯</Text>
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
          {symptom.temperature !== null ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              体温 {symptom.temperature}℃
            </Text>
          ) : null}
          {related ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              关联注射 {formatDate(related.injectedAt)}
            </Text>
          ) : null}
        </View>
        {symptom.note ? (
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: theme.lineHeight.md }}>
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
    if (row.kind === 'injection') return renderInjection(row.injection)
    return renderSymptom(row.symptom)
  }

  if (!ready) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    )
  }

  const data = tab === 'injection' ? injectionRows : symptomRows

  return (
    <Screen>
      <ScreenHeader
        title={zh.history.title}
        subtitle={
          tab === 'injection'
            ? `共 ${injections.length} 条注射记录`
            : `共 ${symptoms.length} 条症状记录`
        }
      />
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <SegmentedControl<TabKey>
          options={[
            { value: 'injection', label: zh.history.injectionTab },
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
            glyph={tab === 'injection' ? '◉' : '☺'}
            title={tab === 'injection' ? zh.empty.historyNoInjection : zh.empty.historyNoSymptom}
            message={
              tab === 'injection'
                ? '登记后，这里会按月展示你的注射时间线。'
                : '记录注射后出现的症状，方便复诊时回顾。'
            }
            actionLabel={
              tab === 'injection'
                ? regimen
                  ? zh.history.addInjection
                  : '去设置方案'
                : zh.history.addSymptom
            }
            onAction={() => {
              if (tab === 'injection') {
                openNewInjection()
              } else {
                router.push('/modal/symptom')
              }
            }}
          />
        }
      />

      <Fab
        label={
          tab === 'injection'
            ? regimen
              ? zh.history.addInjection
              : '去设置方案'
            : zh.history.addSymptom
        }
        onPress={() => {
          if (tab === 'injection') {
            openNewInjection()
          } else {
            router.push('/modal/symptom')
          }
        }}
        accessibilityLabel={tab === 'injection' ? '新增注射记录' : '新增症状记录'}
      />

      <ActionSheet
        visible={menuTarget !== null}
        title={
          menuTarget
            ? `${formatDate(menuTarget.injectedAt)} · ${injectionSummary(menuTarget, medicationNames)}`
            : undefined
        }
        actions={[
          {
            label: zh.common.edit,
            onPress: () => {
              const target = menuTarget
              setMenuTarget(null)
              if (target) {
                router.push({ pathname: '/modal/injection', params: { id: target.id } })
              }
            },
          },
          {
            label: zh.common.delete,
            destructive: true,
            onPress: () => {
              const target = menuTarget
              setMenuTarget(null)
              if (target) {
                setDeleteTarget({
                  kind: 'injection',
                  id: target.id,
                  title: zh.history.deleteInjectionTitle,
                  message: zh.history.deleteInjectionMessage,
                })
              }
            },
          },
        ]}
        onClose={() => setMenuTarget(null)}
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
