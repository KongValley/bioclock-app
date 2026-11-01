import type { DoseLog, LineKind, TreatmentLine } from '@/types'
import { buildSchedule } from './schedule'

/**
 * 依从性统计（纯函数），按「治疗线」分别计算。
 *
 * - 注射线：实际 vs 计划偏差 + 窗口判定，口径与旧版一致
 *   （on_time / early / late、平均偏差、最近连续按时次数）。
 * - 口服线：按 dose_log 算「完成 / 漏服 / 完成率」。
 * - 汇总统计把两类线的口径合并，`byLine` 保留每条线的明细。
 */

export interface InjectionLineAdherence {
  kind: 'injection'
  lineId: string
  /** 已执行（done）的针数 */
  total: number
  onTime: number
  early: number
  late: number
  /** 漏打 / 爽约的针数 */
  missed: number
  /** 尚未到期的计划针数 */
  upcoming: number
  avgDeviationDays: number
  currentStreak: number
}

export interface OralLineAdherence {
  kind: 'oral'
  lineId: string
  /** 已完成的打卡数 */
  total: number
  /** 到点仍未打卡（漏服）的次数 */
  missed: number
  upcoming: number
  /** 完成率 = total / (total + missed)，0–1，保留两位小数 */
  rate: number
}

export type LineAdherence = InjectionLineAdherence | OralLineAdherence

export interface AdherenceStats {
  /** 已完成次数（注射 done + 口服 total） */
  total: number
  onTime: number
  early: number
  late: number
  missed: number
  upcoming: number
  avgDeviationDays: number
  currentStreak: number
  /** 注射线 + 口服线整体完成率 0–1，保留两位小数 */
  rate: number
  /** 每条线单独的口径，按入参顺序 */
  byLine: LineAdherence[]
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

function rateOf(done: number, missed: number): number {
  const denominator = done + missed
  return denominator > 0 ? round2(done / denominator) : 0
}

const UNTRACKED: Omit<AdherenceStats, 'byLine'> = {
  total: 0,
  onTime: 0,
  early: 0,
  late: 0,
  missed: 0,
  upcoming: 0,
  avgDeviationDays: 0,
  currentStreak: 0,
  rate: 0,
}

interface PlanLike {
  plannedAt: number
  status: 'done' | 'due' | 'upcoming' | 'overdue' | 'missed'
  deviationDays?: number
  windowStatus?: 'on_time' | 'early' | 'late'
}

/**
 * 逾期多久才算「漏」。
 * 允许偏差窗口内的逾期仍可能补登记，不应该立刻拉低完成率。
 */
const MISSED_AFTER_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

function isMissedPlan(plan: PlanLike, now: number): boolean {
  if (plan.status === 'missed') return true
  if (plan.status !== 'overdue') return false
  return now - plan.plannedAt > MISSED_AFTER_DAYS * DAY_MS
}

/** 从一串计划里抽出注射线的「按时 / 提前 / 迟到」口径 */
function injectionStats(
  lineId: string,
  plans: PlanLike[],
  now: number,
): InjectionLineAdherence {
  const donePlans = plans.filter((plan) => plan.status === 'done')
  const missed = plans.filter((plan) => isMissedPlan(plan, now)).length
  const upcoming = plans.filter(
    (plan) => plan.status === 'upcoming' || plan.status === 'due',
  ).length

  let onTime = 0
  let early = 0
  let late = 0
  let deviationSum = 0

  for (const plan of donePlans) {
    if (plan.windowStatus === 'on_time') onTime += 1
    else if (plan.windowStatus === 'early') early += 1
    else if (plan.windowStatus === 'late') late += 1
    deviationSum += plan.deviationDays ?? 0
  }

  let currentStreak = 0
  for (let index = donePlans.length - 1; index >= 0; index -= 1) {
    if (donePlans[index].windowStatus !== 'on_time') break
    currentStreak += 1
  }

  return {
    kind: 'injection',
    lineId,
    total: donePlans.length,
    onTime,
    early,
    late,
    missed,
    upcoming,
    avgDeviationDays:
      donePlans.length > 0 ? round1(deviationSum / donePlans.length) : 0,
    currentStreak,
  }
}

/** 口服线：完成 / 漏服 / 完成率 */
function oralStats(lineId: string, plans: PlanLike[], now: number): OralLineAdherence {
  const total = plans.filter((plan) => plan.status === 'done').length
  const missed = plans.filter((plan) => isMissedPlan(plan, now)).length
  const upcoming = plans.filter(
    (plan) => plan.status === 'upcoming' || plan.status === 'due',
  ).length

  return { kind: 'oral', lineId, total, missed, upcoming, rate: rateOf(total, missed) }
}

/**
 * 按线统计。
 *
 * @param lines 一个 treatment 的治疗线
 * @param logs  这些线的用药记录
 * @param now   当前时间（UTC 毫秒）
 */
export function computeAdherence(
  lines: TreatmentLine[],
  logs: DoseLog[],
  now: number,
): AdherenceStats {
  const plans = buildSchedule({ lines, logs, now })

  const byLine: LineAdherence[] = lines.map((line) => {
    const linePlans = plans.filter((plan) => plan.lineId === line.id)
    const kind: LineKind = line.kind
    return kind === 'oral'
      ? oralStats(line.id, linePlans, now)
      : injectionStats(line.id, linePlans, now)
  })

  const injectionLineIds = new Set(
    lines.filter((line) => line.kind !== 'oral').map((line) => line.id),
  )

  let total = 0
  let onTime = 0
  let early = 0
  let late = 0
  let missed = 0
  let upcoming = 0
  let deviationSum = 0
  let deviationCount = 0
  // 汇总结论的「连续按时」取最后一条有记录的注射线。
  let currentStreak = 0

  for (const stats of byLine) {
    total += stats.total
    missed += stats.missed
    upcoming += stats.upcoming

    if (stats.kind === 'injection') {
      onTime += stats.onTime
      early += stats.early
      late += stats.late
      if (stats.total > 0) currentStreak = stats.currentStreak
    }
  }

  // 平均偏差按原始偏差累加，避免用「已四舍五入的每线均值」反推导致误差。
  for (const plan of plans) {
    if (plan.status !== 'done') continue
    if (!injectionLineIds.has(plan.lineId)) continue
    deviationSum += plan.deviationDays ?? 0
    deviationCount += 1
  }

  if (byLine.length === 0) return { ...UNTRACKED, byLine }

  return {
    total,
    onTime,
    early,
    late,
    missed,
    upcoming,
    avgDeviationDays:
      deviationCount > 0 ? round1(deviationSum / deviationCount) : 0,
    currentStreak,
    rate: rateOf(total, missed),
    byLine,
  }
}
