import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme, type Theme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import { buildSchedule, type PlanStatus, type SchedulePlan } from '@/domain/schedule'
import {
  buildMonthCells,
  dayStart,
  groupPlansByDay,
  isSameMonth,
  monthOf,
  monthTitle,
  shiftMonth,
  type MonthCursor,
} from '@/domain/calendar'
import type { Medication, TreatmentLine } from '@/types'
import { Card } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { Screen, ScreenHeader, ScrollArea, SectionTitle } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { toast } from '@/ui/components/Toast'
import { useNow } from '@/ui/components/hooks'
import { formatDateTime, formatWeekday } from '@/ui/components/date'

const NO_LINES: TreatmentLine[] = []
const FUTURE_DOSE_COUNT = 200

function statusLabel(status: PlanStatus): string {
  if (status === 'done') return zh.calendar.statusDone
  if (status === 'due') return zh.calendar.statusDue
  if (status === 'overdue') return zh.calendar.statusOverdue
  if (status === 'missed') return zh.calendar.statusMissed
  return zh.calendar.statusUpcoming
}

function statusColor(theme: Theme, status: PlanStatus): string {
  if (status === 'done') return theme.colors.success
  if (status === 'overdue') return theme.colors.danger
  if (status === 'missed') return theme.colors.textTertiary
  return theme.colors.primary
}

function dayPlansColor(plans: SchedulePlan[], theme: Theme): string {
  if (plans.some((plan) => plan.status === 'overdue')) return theme.colors.danger
  if (plans.some((plan) => plan.status === 'done')) return theme.colors.success
  if (plans.some((plan) => plan.status === 'due')) return theme.colors.primary
  return theme.colors.primary
}

export default function CalendarScreen() {
  const theme = useTheme()
  const router = useRouter()
  const now = useNow(60_000)
  const ready = useAppStore((state) => state.ready)
  const treatment = useAppStore((state) => state.treatment)
  const doseLogs = useAppStore((state) => state.doseLogs)
  const medications = useAppStore((state) => state.medications)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)

  const [cursor, setCursor] = useState<MonthCursor>(() => monthOf(now))
  const [selectedDay, setSelectedDay] = useState<number>(() => dayStart(now))

  const refresh = useCallback(() => {
    reload().catch((error: unknown) => {
      toast(errorMessage(error), 'error')
    })
  }, [reload])

  const lines = treatment?.lines ?? NO_LINES
  const injectionLines = useMemo(
    () => lines.filter((line) => line.kind === 'injection'),
    [lines],
  )

  const medicationById = useMemo(() => {
    const map = new Map<string, Medication>()
    for (const medication of medications) map.set(medication.id, medication)
    return map
  }, [medications])

  const plans = useMemo(() => {
    if (!treatment) return []
    try {
      return buildSchedule({
        lines: treatment.lines,
        logs: doseLogs,
        now,
        futureDoseCount: FUTURE_DOSE_COUNT,
      }).filter((plan) => plan.kind === 'injection')
    } catch {
      return []
    }
  }, [treatment, doseLogs, now])

  const plansByDay = useMemo(() => groupPlansByDay(plans), [plans])
  const cells = useMemo(() => buildMonthCells(cursor), [cursor])
  const selectedPlans = useMemo(
    () => plansByDay.get(dayStart(selectedDay)) ?? [],
    [plansByDay, selectedDay],
  )
  const monthPlanCount = useMemo(
    () => plans.filter((plan) => isSameMonth(cursor, plan.plannedAt)).length,
    [plans, cursor],
  )

  const goMonth = (delta: number) => {
    const next = shiftMonth(cursor, delta)
    setCursor(next)
    if (!isSameMonth(next, selectedDay)) {
      setSelectedDay(new Date(next.year, next.month, 1).getTime())
    }
  }

  const goToday = () => {
    const today = dayStart(Date.now())
    setCursor(monthOf(today))
    setSelectedDay(today)
  }

  const selectDay = (day: number) => {
    setSelectedDay(dayStart(day))
    if (!isSameMonth(cursor, day)) setCursor(monthOf(day))
  }

  const lineName = (plan: SchedulePlan): string => {
    const line = lines.find((item) => item.id === plan.lineId)
    const medication = line ? medicationById.get(line.medicationId) : undefined
    return medication?.name ?? line?.label ?? '注射'
  }

  if (!ready) return null

  const renderSelectedPlan = (plan: SchedulePlan) => {
    const line = lines.find((item) => item.id === plan.lineId)
    const medication = line ? medicationById.get(line.medicationId) : undefined
    const dose = plan.dose ?? medication?.defaultDose ?? null
    const unit = plan.unit || medication?.unit || 'mg'
    const phase =
      plan.phaseKind === 'loading'
        ? zh.calendar.phaseLoading
        : plan.phaseKind === 'maintenance'
          ? zh.calendar.phaseMaintenance
          : null

    return (
      <Card key={`${plan.lineId}-${plan.plannedAt}`}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View
            style={{
              width: 4,
              alignSelf: 'stretch',
              borderRadius: theme.radius.pill,
              backgroundColor: statusColor(theme, plan.status),
            }}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.md,
                fontWeight: '600',
              }}
            >
              {lineName(plan)}
            </Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              {[
                `第 ${plan.index + 1} 针`,
                phase,
                line?.label && line.label !== lineName(plan) ? line.label : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {dose !== null ? (
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                剂量 {dose} {unit}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <Text style={{ color: statusColor(theme, plan.status), fontSize: theme.fontSize.sm, fontWeight: '600' }}>
              {statusLabel(plan.status)}
            </Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
              {formatDateTime(plan.plannedAt, now)}
            </Text>
          </View>
        </View>
      </Card>
    )
  }

  return (
    <Screen>
      <ScreenHeader
        title={zh.calendar.title}
        subtitle={treatment ? treatment.name : zh.calendar.noTreatment}
      />
      <ScrollArea
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: 40,
          gap: theme.spacing.md,
        }}
      >
        {!treatment ? (
          <Card>
            <StateView
              icon="calendar"
              title={zh.calendar.noTreatment}
              message="设置治疗方案后，这里会显示未来每一次注射安排。"
              actionLabel="去设置方案"
              onAction={() => router.push('/onboarding')}
              compact
            />
          </Card>
        ) : injectionLines.length === 0 ? (
          <Card>
            <StateView icon="calendar" title={zh.calendar.noInjectionLines} compact />
          </Card>
        ) : (
          <>
            <Card>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zh.calendar.prevMonth}
                  onPress={() => goMonth(-1)}
                  style={({ pressed }) => [
                    styles.navButton,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    },
                  ]}
                >
                  <Icon name="chevron-left" size={22} color={theme.colors.text} />
                </Pressable>
                <Text
                  accessibilityRole="header"
                  style={{
                    flex: 1,
                    color: theme.colors.text,
                    fontSize: theme.fontSize.lg,
                    fontWeight: '700',
                    textAlign: 'center',
                  }}
                >
                  {monthTitle(cursor)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zh.calendar.nextMonth}
                  onPress={() => goMonth(1)}
                  style={({ pressed }) => [
                    styles.navButton,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    },
                  ]}
                >
                  <Icon name="chevron-right" size={22} color={theme.colors.text} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', marginTop: theme.spacing.sm }}>
                {zh.calendar.weekdays.map((label) => (
                  <View key={label} style={styles.weekdayCell}>
                    <Text
                      style={{
                        color: theme.colors.textTertiary,
                        fontSize: theme.fontSize.xs,
                        textAlign: 'center',
                      }}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                {cells.map((day) => {
                  const dayPlans = plansByDay.get(dayStart(day)) ?? []
                  const inMonth = isSameMonth(cursor, day)
                  const isToday = dayStart(day) === dayStart(now)
                  const selected = dayStart(day) === dayStart(selectedDay)
                  const date = new Date(day)
                  return (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={`${date.getMonth() + 1}月${date.getDate()}日，${
                        dayPlans.length
                      } ${zh.calendar.countSuffix}`}
                      accessibilityState={{ selected }}
                      onPress={() => selectDay(day)}
                      style={styles.dayOuter}
                    >
                      <View
                        style={[
                          styles.dayCell,
                          {
                            borderRadius: theme.radius.md,
                            backgroundColor: selected
                              ? theme.colors.primaryMuted
                              : 'transparent',
                            borderColor: isToday ? theme.colors.primary : 'transparent',
                            opacity: inMonth ? 1 : 0.35,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? theme.colors.primary : theme.colors.text,
                            fontSize: theme.fontSize.sm,
                            fontWeight: isToday || selected ? '700' : '500',
                          }}
                        >
                          {date.getDate()}
                        </Text>
                        <View style={styles.dotsRow}>
                          {dayPlans.slice(0, 3).map((plan) => (
                            <View
                              key={`${plan.lineId}-${plan.plannedAt}`}
                              style={[
                                styles.dot,
                                { backgroundColor: dayPlansColor([plan], theme) },
                              ]}
                            />
                          ))}
                          {dayPlans.length > 3 ? (
                            <Text
                              style={{
                                color: theme.colors.textTertiary,
                                fontSize: 8,
                                lineHeight: 8,
                              }}
                            >
                              +{dayPlans.length - 3}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  )
                })}
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: theme.spacing.sm,
                  gap: theme.spacing.md,
                }}
              >
                <Text style={{ flex: 1, color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                  {zh.calendar.legend}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zh.calendar.today}
                  onPress={goToday}
                  style={({ pressed }) => [
                    styles.todayButton,
                    {
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.pill,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm }}>
                    {zh.calendar.today}
                  </Text>
                </Pressable>
              </View>
            </Card>

            <SectionTitle
              title={zh.calendar.selectedDay}
              hint={`${formatWeekday(selectedDay)} · ${
                selectedPlans.length > 0
                  ? `${selectedPlans.length} ${zh.calendar.countSuffix}`
                  : zh.calendar.emptyDay
              }`}
            />

            {selectedPlans.length === 0 ? (
              <Card>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                  {monthPlanCount > 0 ? zh.calendar.emptyDay : zh.calendar.emptyMonth}
                </Text>
              </Card>
            ) : (
              selectedPlans.map(renderSelectedPlan)
            )}

            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: theme.fontSize.xs,
                lineHeight: theme.lineHeight.xs,
                textAlign: 'center',
              }}
            >
              日历只展示计划，不替代医嘱；实际注射时间以登记记录为准。
            </Text>
          </>
        )}
      </ScrollArea>
    </Screen>
  )
}

const styles = StyleSheet.create({
  navButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayCell: {
    width: '14.2857%',
    paddingVertical: 6,
  },
  dayOuter: {
    width: '14.2857%',
    padding: 2,
  },
  dayCell: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 6,
    borderWidth: 1.5,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: 4,
    minHeight: 8,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  todayButton: {
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
})
