import { useCallback, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage as readError } from '@/store/app'
import { buildSchedule, selectNextPlan, type SchedulePlan } from '@/domain/schedule'
import { recommendSite, SITE_LABELS } from '@/domain/rotation'
import { NOTIFY_PREP_HINT } from '@/notify/scheduler'
import type { DoseLogInput } from '@/db/repo'
import type { DoseStatus, Injection, InjectionSite, Medication, TreatmentLine } from '@/types'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { Screen, ScreenHeader, ScrollArea, SectionTitle, InlineError } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { Fab } from '@/ui/components/Fab'
import { BodyMap } from '@/ui/components/BodyMap'
import { toast } from '@/ui/components/Toast'
import { useNow } from '@/ui/components/hooks'
import { calendarDayDiff, formatDate, formatDateTime, formatDateTimeFull } from '@/ui/components/date'

/** treatment 为空时复用的稳定空数组，避免 useMemo 依赖每次变化。 */
const NO_LINES: TreatmentLine[] = []

type HeadlineTone = 'default' | 'primary' | 'danger'

interface Headline {
  text: string
  tone: HeadlineTone
}

/** 注射线的下一步文案：还有 N 天 / 今天该注射了 / 已逾期 N 天。 */
function injectionHeadline(plan: SchedulePlan, now: number): Headline {
  const diff = calendarDayDiff(plan.plannedAt, now)
  if (diff < 0) return { text: `${zh.today.overduePrefix} ${-diff} 天`, tone: 'danger' }
  if (diff === 0) return { text: zh.today.countdownToday, tone: 'primary' }
  if (diff === 1) return { text: '明天该注射', tone: 'default' }
  return { text: `还有 ${diff} 天`, tone: 'default' }
}

/** 口服线的下一步文案：今天该服用 / 明天 / 下一剂时间。 */
function oralHeadline(plan: SchedulePlan, now: number): Headline {
  const diff = calendarDayDiff(plan.plannedAt, now)
  if (diff < 0) return { text: `${zh.today.overduePrefix} ${-diff} 天`, tone: 'danger' }
  if (diff === 0) return { text: '今天该服用', tone: 'primary' }
  if (diff === 1) return { text: '明天服用', tone: 'default' }
  return { text: `下一剂 ${formatDateTime(plan.plannedAt)}`, tone: 'default' }
}

function headlineColor(theme: ReturnType<typeof useTheme>, tone: HeadlineTone): string {
  if (tone === 'danger') return theme.colors.danger
  if (tone === 'primary') return theme.colors.primary
  return theme.colors.text
}

export default function TodayScreen() {
  const theme = useTheme()
  const router = useRouter()
  const now = useNow()
  const ready = useAppStore((state) => state.ready)
  const error = useAppStore((state) => state.error)
  const treatment = useAppStore((state) => state.treatment)
  const medications = useAppStore((state) => state.medications)
  const doseLogs = useAppStore((state) => state.doseLogs)
  const diseases = useAppStore((state) => state.diseases)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)
  const addDoseLog = useAppStore((state) => state.addDoseLog)

  const [busyLineId, setBusyLineId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    reload().catch((err: unknown) => {
      toast(readError(err), 'error')
    })
  }, [reload])

  const medicationById = useMemo(() => {
    const map = new Map<string, Medication>()
    for (const med of medications) map.set(med.id, med)
    return map
  }, [medications])

  const allLines = treatment?.lines ?? NO_LINES
  const lines = useMemo(() => allLines.filter((line) => line.endedAt === null), [allLines])
  const endedLines = useMemo(() => allLines.filter((line) => line.endedAt !== null), [allLines])

  // 所有线的计划点（含历史），按 plannedAt 升序。
  const plans = useMemo<SchedulePlan[]>(() => {
    if (!treatment) return []
    try {
      return buildSchedule({ lines: treatment.lines, logs: doseLogs, now })
    } catch {
      // 参数异常时不要让首页崩溃，按「暂无排程」展示。
      return []
    }
  }, [treatment, doseLogs, now])

  // 每条线第一条未完成的计划（plans 已按时间升序，取首个即可）。
  const nextPlanByLine = useMemo(() => {
    const map = new Map<string, SchedulePlan>()
    for (const line of lines) {
      const linePlans = plans.filter((plan) => plan.lineId === line.id)
      const next = selectNextPlan(linePlans, now)
      if (next) map.set(line.id, next)
    }
    return map
  }, [plans, lines, now])

  // 「今天要做」：每条线下一步里，今天到期或已逾期的计划。
  const todoPlans = useMemo(() => {
    const result: SchedulePlan[] = []
    for (const line of lines) {
      const plan = nextPlanByLine.get(line.id)
      if (!plan) continue
      if (plan.status !== 'due' && plan.status !== 'overdue') continue
      if (calendarDayDiff(plan.plannedAt, now) > 0) continue
      result.push(plan)
    }
    return result
  }, [lines, nextPlanByLine, now])

  const hostLine = useMemo(
    () => lines.find((line) => line.kind === 'injection' && line.isHost) ?? null,
    [lines],
  )
  const injectionLines = useMemo(
    () => lines.filter((line) => line.kind === 'injection'),
    [lines],
  )

  const hostMedication = hostLine ? medicationById.get(hostLine.medicationId) : undefined
  const showPrepHint = hostMedication?.route === 'sc'

  const recommended = useMemo(() => {
    if (!hostLine) return null
    if (medicationById.get(hostLine.medicationId)?.route !== 'sc') return null
    const history = doseLogs
      .filter((log) => log.lineId === hostLine.id && log.site !== null)
      .map((log) => ({
        site: log.site as InjectionSite,
        injectedAt: log.takenAt ?? log.scheduledAt ?? log.createdAt,
      }))
    return recommendSite(history as Injection[])
  }, [hostLine, medicationById, doseLogs])

  const openInjection = (lineId?: string) => {
    if (lineId) {
      router.push({ pathname: '/modal/injection', params: { lineId } })
    } else {
      router.push('/modal/injection')
    }
  }

  const openOral = (lineId: string, scheduledAt?: number) => {
    router.push({
      pathname: '/modal/oral',
      params: scheduledAt !== undefined ? { lineId, scheduledAt: String(scheduledAt) } : { lineId },
    })
  }

  const openSymptom = () => router.push('/modal/symptom')

  const markOral = async (plan: SchedulePlan, status: DoseStatus) => {
    setBusyLineId(plan.lineId)
    try {
      const input: DoseLogInput = {
        lineId: plan.lineId,
        scheduledAt: plan.plannedAt,
        takenAt: Date.now(),
        status,
      }
      const result = await addDoseLog(input)
      toast(status === 'done' ? '已记录服用' : '已跳过这次', 'success')
      if (result.notifyWarning) toast(result.notifyWarning, 'error')
    } catch (err) {
      toast(readError(err), 'error')
    } finally {
      setBusyLineId(null)
    }
  }

  if (!ready) return null

  const renderTodoCard = (plan: SchedulePlan) => {
    const line = lines.find((item) => item.id === plan.lineId)
    const medication = line ? medicationById.get(line.medicationId) : undefined
    const medicationName = medication?.name ?? line?.label ?? '用药'
    const isInjection = plan.kind === 'injection'
    const headline = isInjection ? injectionHeadline(plan, now) : oralHeadline(plan, now)
    const busy = busyLineId === plan.lineId
    const tone: 'default' | 'primary' | 'danger' =
      headline.tone === 'danger' ? 'danger' : headline.tone === 'primary' ? 'primary' : 'default'

    return (
      <Card key={plan.lineId} tone={tone}>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
          {medicationName}
        </Text>
        <Text
          style={{
            color: headlineColor(theme, headline.tone),
            fontSize: theme.fontSize.lg,
            fontWeight: '700',
            marginTop: 2,
          }}
        >
          {headline.text}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, marginTop: 2 }}>
          {isInjection ? '注射' : '口服'} · {formatDateTimeFull(plan.plannedAt)}
        </Text>

        {isInjection ? (
          <Button
            label="登记注射"
            onPress={() => openInjection(plan.lineId)}
            style={{ marginTop: theme.spacing.md }}
          />
        ) : (
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
            <Button
              label="完成"
              onPress={() => {
                void markOral(plan, 'done')
              }}
              loading={busy}
              style={{ flex: 1 }}
            />
            <Button
              label="跳过"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                void markOral(plan, 'skipped')
              }}
              style={{ flex: 1 }}
            />
          </View>
        )}
      </Card>
    )
  }

  const renderLineCard = (line: TreatmentLine) => {
    const medication = medicationById.get(line.medicationId)
    const plan = nextPlanByLine.get(line.id) ?? null
    const isInjection = line.kind === 'injection'
    const headline = plan ? (isInjection ? injectionHeadline(plan, now) : oralHeadline(plan, now)) : null
    const dose = plan?.dose ?? medication?.defaultDose ?? null
    const unit = plan?.unit || medication?.unit || 'mg'
    const routeText = medication?.route === 'iv' ? ' · 医院输注' : ''

    return (
      <Card key={line.id}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
              {medication?.name ?? line.label}
            </Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              {isInjection ? (line.isHost ? '注射 · 主药' : '注射') : '口服'}
              {routeText}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {headline ? (
              <Text
                style={{
                  color: headlineColor(theme, headline.tone),
                  fontSize: theme.fontSize.md,
                  fontWeight: '700',
                }}
              >
                {headline.text}
              </Text>
            ) : (
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }}>
                {zh.today.noSchedule}
              </Text>
            )}
            {plan ? (
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                {formatDateTimeFull(plan.plannedAt)}
              </Text>
            ) : null}
          </View>
        </View>
        {isInjection && dose !== null ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.fontSize.sm,
              marginTop: theme.spacing.sm,
            }}
          >
            剂量 {dose} {unit}
          </Text>
        ) : null}
        {!isInjection ? (
          <Button
            label="口服打卡"
            variant="secondary"
            onPress={() => openOral(line.id, plan && plan.status === 'due' ? plan.plannedAt : undefined)}
            style={{ marginTop: theme.spacing.md }}
          />
        ) : null}
      </Card>
    )
  }

  return (
    <Screen>
      <ScreenHeader
        title={treatment?.name ?? zh.today.title}
        subtitle={
          treatment
            ? diseases.length > 0
              ? diseases.map((item) => item.name).join('、')
              : '未选择病种'
            : '先把治疗方案设置好'
        }
      />

      {error && doseLogs.length === 0 ? (
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <InlineError message={error} onRetry={refresh} />
        </View>
      ) : null}

      <ScrollArea
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: 120,
          gap: theme.spacing.lg,
        }}
      >
        {!treatment ? (
          <Card>
            <StateView
              icon="plus"
              title="还没有治疗方案"
              message="选择病种和药物，设置注射间隔后，这里会显示下一步计划。"
              actionLabel="去设置方案"
              onAction={() => router.push('/onboarding')}
              compact
            />
          </Card>
        ) : lines.length === 0 && endedLines.length === 0 ? (
          <Card>
            <StateView icon="syringe" title={zh.today.noSchedule} compact />
          </Card>
        ) : (
          <>
            <View style={{ gap: theme.spacing.md }}>
              <SectionTitle title="今天要做" />
              {todoPlans.length === 0 ? (
                <Card>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                    {lines.length === 0
                      ? '当前没有在用的用药线。'
                      : '今天没有需要登记的项目，按计划进行即可。'}
                  </Text>
                </Card>
              ) : (
                todoPlans.map((plan) => renderTodoCard(plan))
              )}
            </View>

            {lines.length > 0 ? (
              <View style={{ gap: theme.spacing.md }}>
                <SectionTitle title="用药计划" hint="每一条用药线的下一步" />
                {lines.map((line) => renderLineCard(line))}
              </View>
            ) : null}

            {endedLines.length > 0 ? (
              <View style={{ gap: theme.spacing.md }}>
                <SectionTitle title="已停用" hint="历史记录保留，可在设置 → 疗效记录里恢复" />
                {endedLines.map((line) => {
                  const medication = medicationById.get(line.medicationId)
                  return (
                    <Card key={line.id}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            style={{
                              color: theme.colors.textSecondary,
                              fontSize: theme.fontSize.md,
                              fontWeight: '600',
                            }}
                          >
                            {medication?.name ?? line.label}
                          </Text>
                          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                            {line.kind === 'injection' ? '注射' : '口服'} · 已停用
                          </Text>
                        </View>
                        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }}>
                          {line.endedAt !== null ? formatDate(line.endedAt, now) : ''}
                        </Text>
                      </View>
                    </Card>
                  )
                })}
              </View>
            ) : null}
          </>
        )}

        {recommended && hostLine ? (
          <Card>
            <SectionTitle
              title={zh.today.recommendedSite}
              hint={zh.today.rotateHint}
              right={
                <Text
                  style={{
                    color: theme.colors.primary,
                    fontSize: theme.fontSize.sm,
                    fontWeight: '600',
                  }}
                >
                  {SITE_LABELS[recommended]}
                </Text>
              }
            />
            <View style={{ marginTop: theme.spacing.sm }}>
              <BodyMap selected={recommended} recommended={recommended} height={200} />
            </View>
          </Card>
        ) : null}

        {showPrepHint ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
              backgroundColor: theme.colors.warningMuted,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
            }}
          >
            <Icon name="alert" size={18} color={theme.colors.warning} />
            <Text
              style={{
                flex: 1,
                color: theme.colors.warning,
                fontSize: theme.fontSize.sm,
                lineHeight: theme.lineHeight.md,
              }}
            >
              {NOTIFY_PREP_HINT}
            </Text>
          </View>
        ) : null}

        <Button
          label={zh.today.quickLogSymptom}
          onPress={openSymptom}
          variant="secondary"
          icon="pencil"
        />

        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: theme.fontSize.xs,
            lineHeight: theme.lineHeight.xs,
            textAlign: 'center',
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          {zh.disclaimer.short}
        </Text>
      </ScrollArea>

      {treatment && injectionLines.length > 0 ? (
        <Fab
          label={zh.today.registerInjection}
          onPress={() => openInjection()}
          accessibilityLabel="登记一次注射"
        />
      ) : null}
    </Screen>
  )
}
