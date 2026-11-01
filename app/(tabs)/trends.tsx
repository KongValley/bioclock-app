import { useCallback, useMemo } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { useTheme, type Theme } from '@/ui/theme'
import { zh } from '@/i18n/zh'
import { useAppStore, errorMessage } from '@/store/app'
import { computeAdherence, type LineAdherence } from '@/domain/adherence'
import type { Medication, TreatmentLine } from '@/types'
import { Card } from '@/ui/components/Card'
import { Screen, ScreenHeader, ScrollArea, SectionTitle } from '@/ui/components/Layout'
import { StateView } from '@/ui/components/StateView'
import { toast } from '@/ui/components/Toast'
import { useNow } from '@/ui/components/hooks'
import { formatDate, MS_PER_DAY } from '@/ui/components/date'

const NO_LINES: TreatmentLine[] = []

function severityColor(theme: Theme, severity: number): string {
  if (severity <= 1) return theme.colors.success
  if (severity === 2) return theme.colors.primary
  if (severity === 3) return theme.colors.warning
  return theme.colors.danger
}

/** 用药记录的实际时间：优先打卡时间，其次计划时间。 */
function logTime(takenAt: number | null, scheduledAt: number | null, createdAt: number): number {
  return takenAt ?? scheduledAt ?? createdAt
}

export default function TrendsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const now = useNow(60_000)
  const { width: windowWidth } = useWindowDimensions()
  const ready = useAppStore((state) => state.ready)
  const treatment = useAppStore((state) => state.treatment)
  const doseLogs = useAppStore((state) => state.doseLogs)
  const medications = useAppStore((state) => state.medications)
  const symptoms = useAppStore((state) => state.symptoms)
  const refreshing = useAppStore((state) => state.refreshing)
  const reload = useAppStore((state) => state.reload)

  const chartWidth = Math.max(220, Math.min(560, windowWidth - theme.spacing.lg * 4))

  const lines = treatment?.lines ?? NO_LINES

  const medicationById = useMemo(() => {
    const map = new Map<string, Medication>()
    for (const medication of medications) map.set(medication.id, medication)
    return map
  }, [medications])

  const stats = useMemo(() => {
    if (!treatment) return null
    try {
      return computeAdherence(treatment.lines, doseLogs, now)
    } catch {
      return null
    }
  }, [treatment, doseLogs, now])

  // 注射线：用于症状时间线的竖线标记。
  const injectionMarks = useMemo(() => {
    const kindByLine = new Map(lines.map((line) => [line.id, line.kind]))
    return doseLogs
      .filter((log) => kindByLine.get(log.lineId) === 'injection')
      .map((log) => ({
        id: log.id,
        at: logTime(log.takenAt, log.scheduledAt, log.createdAt),
      }))
      .sort((a, b) => a.at - b.at)
  }, [doseLogs, lines])

  const symptomRange = useMemo(() => {
    const times = [
      ...injectionMarks.map((mark) => mark.at),
      ...symptoms.map((symptom) => symptom.loggedAt),
    ]
    if (times.length === 0) return null
    const start = Math.min(...times)
    const end = Math.max(...times)
    return { start, end: Math.max(end, start + MS_PER_DAY) }
  }, [injectionMarks, symptoms])

  const refresh = useCallback(() => {
    reload().catch((error: unknown) => {
      toast(errorMessage(error), 'error')
    })
  }, [reload])

  const maxWindowDays = useMemo(() => {
    let max = 0
    for (const line of lines) {
      if (line.kind === 'injection') max = Math.max(max, line.windowDays)
    }
    return max
  }, [lines])

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

  const renderLineStats = (lineStat: LineAdherence) => {
    const line = lines.find((item) => item.id === lineStat.lineId)
    if (!line) return null
    const medication = medicationById.get(line.medicationId)
    const name = medication?.name ?? line.label
    const kindLabel =
      lineStat.kind === 'injection' ? (line.isHost ? '注射 · 主药' : '注射') : '口服'

    return (
      <Card key={lineStat.lineId}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '600' }}>
            {name}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }}>
            {kindLabel}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.md,
            marginTop: theme.spacing.md,
          }}
        >
          {lineStat.kind === 'injection' ? (
            <>
              {statTile(zh.trends.onTime, `${lineStat.onTime}`, theme.colors.success)}
              {statTile(zh.trends.early, `${lineStat.early}`, theme.colors.primary)}
              {statTile(zh.trends.late, `${lineStat.late}`, theme.colors.warning)}
              {statTile(zh.trends.avgDeviation, `${lineStat.avgDeviationDays.toFixed(1)} 天`)}
              {statTile('漏打', `${lineStat.missed}`, theme.colors.danger)}
            </>
          ) : (
            <>
              {statTile('完成', `${lineStat.total}`, theme.colors.success)}
              {statTile('漏服', `${lineStat.missed}`, theme.colors.danger)}
              {statTile('完成率', `${Math.round(lineStat.rate * 100)}%`)}
            </>
          )}
        </View>
      </Card>
    )
  }

  const renderSymptomChart = () => {
    if (!symptomRange) {
      return (
        <StateView
          icon="smile"
          title="还没有可对齐的数据"
          message="登记注射或症状后，这里会按时间展示症状严重度。"
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
    const yOf = (severity: number): number => plotBottom - ((severity - 1) / 4) * plotHeight

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
          {injectionMarks.map((mark) => {
            const x = xOf(mark.at)
            return (
              <Line
                key={mark.id}
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
          <SvgText x={paddingX} y={chartHeight - 12} fontSize={9} fill={theme.colors.textTertiary}>
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

  const hasData = doseLogs.length > 0 || symptoms.length > 0
  const empty = !treatment || lines.length === 0 || !stats || !hasData

  const emptyAction = treatment
    ? lines.some((line) => line.kind === 'injection')
      ? { label: '去登记注射', route: '/modal/injection' as const }
      : { label: '去登记口服', route: '/modal/oral' as const }
    : { label: '去设置方案', route: '/onboarding' as const }

  return (
    <Screen>
      <ScreenHeader title={zh.trends.title} subtitle="回看节律，不评判对错" />
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
              icon="activity"
              title={zh.empty.trendsNoData}
              message="按时、提前、延迟只用于自我回顾；偏差在方案窗口内都算按时。"
              actionLabel={emptyAction.label}
              onAction={() => router.push(emptyAction.route)}
            />
          </Card>
        ) : (
          <>
            <SectionTitle
              title={zh.trends.adherence}
              hint={`按时窗口 ±${maxWindowDays} 天 · 共 ${stats?.total ?? 0} 次记录`}
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
                {statTile('完成率', `${Math.round((stats?.rate ?? 0) * 100)}%`)}
              </View>
            </Card>

            <SectionTitle title="各用药线" hint="按用药线分别统计" />
            {stats?.byLine.map((lineStat) => renderLineStats(lineStat))}

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
