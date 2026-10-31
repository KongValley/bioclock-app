import { useCallback, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage as readError } from '@/store/app'
import { nextDose, totalPlannedDoses } from '@/domain/schedule'
import { recommendSite, SITE_LABELS } from '@/domain/rotation'
import { NOTIFY_PREP_HINT } from '@/notify/scheduler'
import { DRUGS_BY_KEY } from '@/data/catalog'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Screen, ScreenHeader, ScrollArea, SectionTitle, InlineError } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { Fab } from '@/ui/components/Fab'
import { BodyMap } from '@/ui/components/BodyMap'
import { toast } from '@/ui/components/Toast'
import { useNow } from '@/ui/components/hooks'
import { calendarDayDiff, formatDate, formatDateTimeFull, formatTime } from '@/ui/components/date'

export default function TodayScreen() {
  const theme = useTheme()
  const router = useRouter()
  const now = useNow()
  const ready = useAppStore((state) => state.ready)
  const error = useAppStore((state) => state.error)
  const regimen = useAppStore((state) => state.regimen)
  const medication = useAppStore((state) => state.medication)
  const medications = useAppStore((state) => state.medications)
  const disease = useAppStore((state) => state.disease)
  const injections = useAppStore((state) => state.injections)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)

  const refresh = useCallback(() => {
    reload().catch((err: unknown) => {
      toast(readError(err), 'error')
    })
  }, [reload])

  const schedule = useMemo(() => {
    if (!regimen) return null
    return { regimen, injections, now }
  }, [regimen, injections, now])

  const plan = useMemo(() => (schedule ? nextDose(schedule) : null), [schedule])
  const total = regimen ? totalPlannedDoses(regimen.phases) : 0
  const recommended = useMemo(
    () => (medication?.route === 'sc' ? recommendSite(injections) : null),
    [medication, injections],
  )

  const lastInjection = injections.length > 0 ? injections[injections.length - 1] : null
  const lastInjectionRoute = lastInjection
    ? medications.find((item) => item.id === lastInjection.medicationId)?.route
    : undefined
  const brandName = medication?.catalogKey
    ? DRUGS_BY_KEY[medication.catalogKey]?.brandNames[0]
    : undefined
  const medicationTitle = medication
    ? brandName
      ? `${brandName} · ${medication.name}`
      : medication.name
    : undefined

  if (!ready) return null

  const openInjection = () => router.push('/modal/injection')
  const openSymptom = () => router.push('/modal/symptom')

  const renderPlanCard = () => {
    if (!regimen) {
      return (
        <Card>
          <StateView
            glyph="＋"
            title={zh.empty.todayNoRegimen}
            message="选择病种和药物，设置注射间隔后，这里会显示下一次注射时间。"
            actionLabel="去设置方案"
            onAction={() => router.push('/onboarding')}
            compact
          />
        </Card>
      )
    }

    if (!plan) {
      return (
        <Card>
          <StateView glyph="◔" title={zh.today.noSchedule} compact />
        </Card>
      )
    }

    const dayDiff = calendarDayDiff(plan.plannedAt, now)
    const overdueDays = Math.max(1, calendarDayDiff(now, plan.plannedAt))
    const isOverdue = plan.status === 'overdue'
    const isDue = plan.status === 'due'

    const headline = isOverdue
      ? `${zh.today.overduePrefix} ${overdueDays} 天`
      : isDue
        ? dayDiff === 1
          ? '明天该注射'
          : dayDiff === -1
            ? '已到注射时间'
            : zh.today.countdownToday
        : dayDiff > 0
          ? `还有 ${dayDiff} 天`
          : '即将到期'

    const tone = isOverdue ? 'danger' : isDue ? 'primary' : 'default'
    const headlineColor = isOverdue
      ? theme.colors.danger
      : isDue
        ? theme.colors.primary
        : theme.colors.text

    const dose = plan.dose ?? medication?.defaultDose
    const unit = plan.unit || medication?.unit || 'mg'
    const routeLabel = medication?.route === 'iv' ? '医院输注' : '皮下注射'
    const totalLabel = Number.isFinite(total)
      ? `第 ${Math.min(plan.index + 1, total)} / ${total} 针`
      : `第 ${plan.index + 1} 针`

    return (
      <Card tone={tone}>
        <Text
          style={{
            color: isOverdue ? theme.colors.danger : theme.colors.textSecondary,
            fontSize: theme.fontSize.xs,
            fontWeight: '600',
            letterSpacing: 1,
          }}
        >
          {isOverdue ? '已超过计划时间' : '下次注射'}
        </Text>
        <Text
          accessibilityRole="header"
          style={{
            color: headlineColor,
            fontSize: theme.fontSize.display,
            lineHeight: theme.lineHeight.display,
            fontWeight: '700',
            marginTop: 4,
          }}
        >
          {headline}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.fontSize.md,
            marginTop: 2,
          }}
        >
          {formatDateTimeFull(plan.plannedAt)}
        </Text>

        <View style={[styles.pillRow, { marginTop: theme.spacing.md }]}>
          <View
            style={[
              styles.pill,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.pill,
              },
            ]}
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
              {totalLabel}
            </Text>
          </View>
          <View
            style={[
              styles.pill,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.pill,
              },
            ]}
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
              {dose !== null ? `${dose} ${unit}` : zh.common.notSet}
            </Text>
          </View>
          <View
            style={[
              styles.pill,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.pill,
              },
            ]}
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
              {routeLabel}
            </Text>
          </View>
        </View>

        <Button
          label={isOverdue || isDue ? '立即登记' : zh.today.registerInjection}
          onPress={openInjection}
          size="lg"
          variant={isOverdue ? 'danger' : 'primary'}
          style={{ marginTop: theme.spacing.lg }}
        />
        {isOverdue ? (
          <Text
            style={{
              color: theme.colors.danger,
              fontSize: theme.fontSize.xs,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            如已注射请补登记，登记后会自动重算下次时间。
          </Text>
        ) : null}
      </Card>
    )
  }

  return (
    <Screen>
      <ScreenHeader
        title={disease?.name ?? zh.today.title}
        subtitle={medicationTitle ?? (regimen ? undefined : '先把用药方案设置好')}
      />

      {error && injections.length === 0 ? (
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
        {renderPlanCard()}

        {lastInjection ? (
          <Card>
            <SectionTitle title={zh.today.lastInjection} />
            <View style={{ marginTop: theme.spacing.sm, gap: 4 }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
                {formatDate(lastInjection.injectedAt)} {formatTime(lastInjection.injectedAt)}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                {lastInjection.dose !== null ? `${lastInjection.dose} ${lastInjection.unit}` : '剂量未记录'}
                {lastInjectionRoute === 'sc' ? ` · ${SITE_LABELS[lastInjection.site]}` : ''}
              </Text>
              {lastInjection.note ? (
                <Text
                  numberOfLines={2}
                  style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}
                >
                  {lastInjection.note}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : regimen ? (
          <Card>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
              {zh.empty.todayNoInjection}
            </Text>
          </Card>
        ) : null}

        {recommended && medication?.route === 'sc' ? (
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

        {medication?.route === 'sc' ? (
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
            <Text style={{ fontSize: theme.fontSize.md }}>❄</Text>
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
          icon="✎"
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

      {regimen ? (
        <Fab
          label={zh.today.registerInjection}
          onPress={openInjection}
          accessibilityLabel="登记一次注射"
        />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
