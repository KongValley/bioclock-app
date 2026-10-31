import { describe, expect, it } from 'vitest'
import type { Injection, InjectionSite, Regimen } from '@/types'
import { computeAdherence } from '../adherence'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

let injectionSeq = 0

function makeInjection(offsetDays: number, site: InjectionSite = 'abdomen_ul'): Injection {
  injectionSeq += 1
  const injectedAt = T0 + offsetDays * DAY
  return {
    id: `inj-${injectionSeq}`,
    regimenId: 'regimen-1',
    medicationId: 'med-1',
    injectedAt,
    dose: 40,
    unit: 'mg',
    site,
    lotNumber: null,
    note: null,
    createdAt: injectedAt,
    updatedAt: injectedAt,
  }
}

function maintenanceRegimen(anchor: Regimen['anchor'] = 'planned'): Regimen {
  return {
    id: 'regimen-1',
    medicationId: 'med-1',
    name: '测试方案',
    anchor,
    windowDays: 2,
    isActive: true,
    createdAt: T0,
    phases: [
      {
        id: 'phase-0',
        regimenId: 'regimen-1',
        orderIdx: 0,
        kind: 'maintenance',
        intervalDays: 14,
        repeatCount: 0,
        dose: 40,
        unit: 'mg',
      },
    ],
  }
}

describe('computeAdherence', () => {
  it('无注射记录时全部为 0', () => {
    expect(
      computeAdherence([], maintenanceRegimen(), T0 + 10 * DAY),
    ).toEqual({
      total: 0,
      onTime: 0,
      early: 0,
      late: 0,
      avgDeviationDays: 0,
      currentStreak: 0,
    })
  })

  it('正确统计按时 / 提前 / 延迟、平均偏差与当前连续按时次数', () => {
    // 计划日：0 / 14 / 28 / 42（planned 锚点，不随迟到顺延）
    const injections = [
      makeInjection(0),
      makeInjection(15), // +1 天，窗口 ±2 → 按时
      makeInjection(33), // 计划 28，+5 天 → 延迟
      makeInjection(43), // 计划 42，+1 天 → 按时
    ]

    const stats = computeAdherence(injections, maintenanceRegimen('planned'), T0 + 50 * DAY)

    expect(stats.total).toBe(4)
    expect(stats.onTime).toBe(3)
    expect(stats.early).toBe(0)
    expect(stats.late).toBe(1)
    // (0 + 1 + 5 + 1) / 4 = 1.75 → 1.8
    expect(stats.avgDeviationDays).toBe(1.8)
    // 最近一次按时，再往前一次延迟 → 连续 1 次
    expect(stats.currentStreak).toBe(1)
  })

  it('连续按时时 currentStreak 从最近一次往前累计', () => {
    const injections = [makeInjection(0), makeInjection(14), makeInjection(28)]
    const stats = computeAdherence(injections, maintenanceRegimen('planned'), T0 + 30 * DAY)

    expect(stats.total).toBe(3)
    expect(stats.onTime).toBe(3)
    expect(stats.currentStreak).toBe(3)
    expect(stats.avgDeviationDays).toBe(0)
  })

  it('最近一次提前会中断连续按时，并计入 early 与负偏差', () => {
    const injections = [makeInjection(0), makeInjection(10)]
    const stats = computeAdherence(injections, maintenanceRegimen('planned'), T0 + 10 * DAY)

    expect(stats.total).toBe(2)
    expect(stats.onTime).toBe(1)
    expect(stats.early).toBe(1)
    expect(stats.late).toBe(0)
    expect(stats.avgDeviationDays).toBe(-2)
    expect(stats.currentStreak).toBe(0)
  })

  it('统计口径之和等于已完成注射数', () => {
    const injections = [
      makeInjection(0),
      makeInjection(17),
      makeInjection(29),
      makeInjection(45),
    ]
    const stats = computeAdherence(injections, maintenanceRegimen('planned'), T0 + 60 * DAY)

    expect(stats.total).toBe(injections.length)
    expect(stats.onTime + stats.early + stats.late).toBe(stats.total)
  })
})
