import type { Injection, Regimen } from '@/types'
import { buildSchedule } from './schedule'

export interface AdherenceStats {
  total: number
  onTime: number
  early: number
  late: number
  avgDeviationDays: number
  currentStreak: number
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * 依从性统计。
 * - 计划时间复用排程引擎（遵循方案的 anchor / 阶段推进）
 * - 窗口判定复用 regime.windowDays
 * - currentStreak 从最近一次注射向前数连续 on_time 的次数
 */
export function computeAdherence(
  injections: Injection[],
  regimen: Regimen,
  now: number,
): AdherenceStats {
  const plans = buildSchedule({ regimen, injections, now })
  const donePlans = plans.filter((plan) => plan.status === 'done')

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
    total: injections.length,
    onTime,
    early,
    late,
    avgDeviationDays:
      donePlans.length > 0 ? round1(deviationSum / donePlans.length) : 0,
    currentStreak,
  }
}
