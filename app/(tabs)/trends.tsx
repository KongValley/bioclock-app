import { useCallback, useMemo } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { useTheme, type Theme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import { buildSchedule } from '@/domain/schedule'
import { computeAdherence } from '@/domain/adherence'
import { Card } from '@/ui/components/Card'
import { Screen, ScreenHeader, ScrollArea, SectionTitle } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { toast } from '@/ui/components/Toast'
import { useNow } from '@/ui/components/hooks'
import { formatDate, MS_PER_DAY } from '@/ui/components/date'

interface IntervalPoint {
  key: string
  index: number
  actualDays: number
  plannedDays: number
  date: number
}

function severityColor(theme: Theme, severity: number): string {
  if (severity <= 1) return theme.colors.success
  if (severity === 2) return theme.colors.primary
  if (severity === 3) return theme.colors.warning
  return theme.colors.danger
}

export default function TrendsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const now = useNow(60_000)
  const { width: windowWidth } = useWindowDimensions()
  const ready = useAppStore((state) => state.ready)
  const regimen = useAppStore((state) => state.regimen)
  const injections = useAppStore((state) => state.injections)
  const symptoms = useAppStore((state) => state.symptoms)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)

  const chartWidth = Math.max(220, Math.min(560, windowWidth - theme.spacing.lg * 4))

  const stats = useMemo(
    () => (regimen ? computeAdherence(injections, regimen, now) : null),
    [regimen, injections, now],
  )

  const intervals = useMemo<IntervalPoint[]>(() => {
    if (!regimen) return []
    const plans = buildSchedule({ regimen, injections, now }).filter(
      (plan) => plan.status === 'done' && typeof plan.actualAt === 'number',
    )
    const phaseById = new Map(regimen.phases.map((phase) => [phase.id, phase]))
    const points: IntervalPoint[] = []
    for (let i = 1; i < plans.length; i += 1) {
      const previous = plans[i - 1]
      const current = plans[i]
      if (previous.actualAt === undefined || current.actualAt === undefined) continue
      const phase = phaseById.get(current.phaseId)
      points.push({
        key: `${current.phaseId}-${current.index}`,
        index: current.index,
        actualDays: (current.actualAt - previous.actualAt) / MS_PER_DAY,
        plannedDays: phase?.intervalDays ?? 0,
        date: current.actualAt,
      })
    }
    return points.slice(-8)
  }, [regimen, injections, now])

  const symptomRange = useMemo(() => {
    if (injections.length === 0 || symptoms.length === 0) return null
    const times = [
      ...injections.map((injection) => injection.injectedAt),
      ...symptoms.map((symptom) => symptom.loggedAt),
    ]
    const start = Math.min(...times)
    const end = Math.max(...times)
    return { start, end: Math.max(end, start + MS_PER_DAY) }
  }, [injections, symptoms])

  const refresh = useCallback(() => {
    reload().catch((error: unknown) => {
      toast(errorMessage(error), 'error')
    })
  }, [reload])

  const empty = !ready || !regimen || injections.length < 2 || !stats

  const statTile = (label: string, value: string, color?: string) => (
    <View style={{ flexGrow: 1, flexBasis: '30%', minWidth: 88, gap: 2 }}>
      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>{label}</Text>
      <Text
        style={{
          color: color ?? theme.colors.text,
          fontSize: theme.fontSize.xl,
          fontWeight: '700',
        }}
      >
        {value}
      </Text>
    </View>
  )

  const renderIntervalChart = () => {
    if (intervals.length === 0) {
      return (
        <StateView
          glyph="◔"
          title="还差一次注射记录"
          message="记录满两次注射后，这里会显示实际间隔与方案间隔的对比。"
          compact
        />
      )
    }

    const chartHeight = 170
    const plotTop = 14
    const plotBottom = chartHeight - 28
    const plotHeight = plotBottom - plotTop
    const maxDays = Math.max(
      1,
      ...intervals.map((point) => Math.max(point.actualDays, point.plannedDays)),
    )
    const groupWidth = chartWidth / intervals.length
    const barWidth = Math.max(8, Math.min(16, groupWidth * 0.3))

    return (
      <View style={{ gap: 10 }}>
        <Svg width={chartWidth} height={chartHeight} accessibilityLabel="注射间隔对比图">
          {[0, 0.5, 1].map((ratio) => {
            const y = plotBottom - plotHeight * ratio
            return (
              <Line
                key={ratio}
                x1={0}
                y1={y}
                x2={chartWidth}
                y2={y}
                stroke={theme.colors.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            )
          })}
          {intervals.map((point, index) => {
            const center = groupWidth * index + groupWidth / 2
            const actualHeight = Math.max(2, (point.actualDays / maxDays) * plotHeight)
            const plannedHeight = Math.max(2, (point.plannedDays / maxDays) * plotHeight)
            return (
              <G key={point.key}>
                <Rect
                  x={center - barWidth - 2}
                  y={plotBottom - plannedHeight}
                  width={barWidth}
                  height={plannedHeight}
                  rx={2}
                  fill={theme.colors.textTertiary}
                  opacity={0.3}
                />
                <Rect
                  x={center + 2}
                  y={plotBottom - actualHeight}
                  width={barWidth}
                  height={actualHeight}
                  rx={2}
                  fill={theme.colors.primary}
                />
                <SvgText
                  x={center}
                  y={chartHeight - 10}
                  fontSize={9}
                  fill={theme.colors.textTertiary}
                  textAnchor="middle"
                >
                  {`${new Date(point.date).getMonth() + 1}/${new Date(point.date).getDate()}`}
                </SvgText>
              </G>
            )
          })}
          <SvgText
            x={0}
            y={plotTop - 4}
            fontSize={9}
            fill={theme.colors.textTertiary}
          >
            {`${Math.round(maxDays)} 天`}
          </SvgText>
        </Svg>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: theme.colors.primary }]} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
              实际间隔
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendSwatch,
                { backgroundColor: theme.colors.textTertiary, opacity: 0.35 },
              ]}
            />
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
              方案间隔
            </Text>
          </View>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, marginLeft: 'auto' }}>
            最近 {intervals.length} 次
          </Text>
        </View>
      </View>
    )
  }

  const renderSymptomChart = () => {
    if (!symptomRange) {
      return (
        <StateView
          glyph="☺"
          title="还没有可对齐的数据"
          message="至少需要一次注射记录和一条症状记录。"
          compact
        />
      )
    }

    const chartHeight = 190
    const plotTop = 18
    const plotBottom = chartHeight - 34
    const plotHeight = plotBottom - plotTop
    const paddingX = 10
    const span = symptomRange.end - symptomRange.start
    const xOf = (timestamp: number): number =>
      paddingX + ((timestamp - symptomRange.start) / span) * (chartWidth - paddingX * 2)
    const yOf = (severity: number): number =>
      plotBottom - ((severity - 1) / 4) * plotHeight

    return (
      <View style={{ gap: 10 }}>
        <Svg width={chartWidth} height={chartHeight} accessibilityLabel="症状与注射时间对齐图">
          {[1, 2, 3, 4, 5].map((severity) => (
            <Line
              key={severity}
              x1={paddingX}
              y1={yOf(severity)}
              x2={chartWidth - paddingX}
              y2={yOf(severity)}
              stroke={theme.colors.border}
              strokeWidth={StyleSheet.hairlineWidth}
            />
          ))}
          {injections.map((injection) => {
            const x = xOf(injection.injectedAt)
            return (
              <Line
                key={injection.id}
                x1={x}
                y1={plotTop}
                x2={x}
                y2={plotBottom}
                stroke={theme.colors.primary}
                strokeWidth={1.5}
                opacity={0.65}
              />
            )
          })}
          {symptoms.map((symptom) => (
            <Circle
              key={symptom.id}
              cx={xOf(symptom.loggedAt)}
              cy={yOf(symptom.severity)}
              r={5}
              fill={severityColor(theme, symptom.severity)}
              stroke={theme.colors.surface}
              strokeWidth={1.5}
            />
          ))}
          <SvgText
            x={paddingX}
            y={chartHeight - 12}
            fontSize={9}
            fill={theme.colors.textTertiary}
          >
            {formatDate(symptomRange.start)}
          </SvgText>
          <SvgText
            x={chartWidth - paddingX}
            y={chartHeight - 12}
            fontSize={9}
            fill={theme.colors.textTertiary}
            textAnchor="end"
          >
            {formatDate(symptomRange.end)}
          </SvgText>
        </Svg>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: theme.colors.primary }]} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}>
              注射
            </Text>
          </View>
          {[1, 2, 3, 4, 5].map((severity) => (
            <View key={severity} style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: severityColor(theme, severity) }]}
              />
              <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
                {severity}
              </Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <Screen>
      <ScreenHeader
        title={zh.trends.title}
        subtitle="回看节律，不评判对错"
      />
      <ScrollArea
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: 32,
          gap: theme.spacing.md,
        }}
      >
        {empty ? (
          <Card>
            <StateView
              glyph="◔"
              title={zh.empty.trendsNoData}
              message="按时、提前、延迟只用于自我回顾；偏差在方案窗口内都算按时。"
              actionLabel={regimen ? '去登记注射' : '去设置方案'}
              onAction={() => router.push(regimen ? '/modal/injection' : '/onboarding')}
            />
          </Card>
        ) : (
          <>
            <SectionTitle
              title={zh.trends.adherence}
              hint={`按时窗口 ±${regimen?.windowDays ?? 0} 天 · 共 ${stats?.total ?? 0} 针`}
            />
            <Card>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
                {statTile(zh.trends.onTime, `${stats?.onTime ?? 0}`, theme.colors.success)}
                {statTile(zh.trends.early, `${stats?.early ?? 0}`, theme.colors.primary)}
                {statTile(zh.trends.late, `${stats?.late ?? 0}`, theme.colors.warning)}
                {statTile(
                  zh.trends.avgDeviation,
                  `${(stats?.avgDeviationDays ?? 0).toFixed(1)} 天`,
                )}
                {statTile(zh.trends.currentStreak, `${stats?.currentStreak ?? 0} 次`)}
              </View>
            </Card>

            <SectionTitle title="注射间隔" hint="实际间隔 vs 方案间隔" />
            <Card>{renderIntervalChart()}</Card>

            <SectionTitle title={zh.trends.symptomTimeline} hint="竖线为注射，圆点为症状严重度" />
            <Card>
              {renderSymptomChart()}
              <Text
                style={{
                  color: theme.colors.textTertiary,
                  fontSize: theme.fontSize.xs,
                  lineHeight: theme.lineHeight.xs,
                  marginTop: theme.spacing.sm,
                  textAlign: 'center',
                }}
              >
                {zh.trends.correlationNote}
              </Text>
            </Card>
          </>
        )}
      </ScrollArea>
    </Screen>
  )
}

const styles = StyleSheet.create({
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLine: {
    width: 2,
    height: 12,
  },
})
