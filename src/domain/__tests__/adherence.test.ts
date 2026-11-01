import { describe, expect, it } from 'vitest'
import { computeAdherence } from '../adherence'
import type { InjectionLineAdherence, OralLineAdherence } from '../adherence'
import { DAY, T0, injectionLog, makeInjectionLine, makeLog, makeOralLine } from './fixtures'

function injectionStatsOf(
  stats: ReturnType<typeof computeAdherence>,
  lineId: string,
): InjectionLineAdherence {
  const line = stats.byLine.find((item) => item.lineId === lineId)
  if (!line || line.kind !== 'injection') throw new Error(`缺少注射线统计：${lineId}`)
  return line
}

function oralStatsOf(
  stats: ReturnType<typeof computeAdherence>,
  lineId: string,
): OralLineAdherence {
  const line = stats.byLine.find((item) => item.lineId === lineId)
  if (!line || line.kind !== 'oral') throw new Error(`缺少口服线统计：${lineId}`)
  return line
}

function maintenancePlanned() {
  return makeInjectionLine({ id: 'line-host', isHost: true, anchor: 'planned', windowDays: 2 })
}

describe('computeAdherence（注射线）', () => {
  it('无记录时各项为 0', () => {
    const stats = computeAdherence([maintenancePlanned()], [], T0)

    expect(stats.total).toBe(0)
    expect(stats.onTime).toBe(0)
    expect(stats.early).toBe(0)
    expect(stats.late).toBe(0)
    expect(stats.missed).toBe(0)
    expect(stats.avgDeviationDays).toBe(0)
    expect(stats.currentStreak).toBe(0)
    expect(stats.rate).toBe(0)
    expect(stats.byLine).toHaveLength(1)
  })

  it('无任何线时返回全 0 且 byLine 为空', () => {
    expect(computeAdherence([], [], T0)).toEqual({
      total: 0,
      onTime: 0,
      early: 0,
      late: 0,
      missed: 0,
      upcoming: 0,
      avgDeviationDays: 0,
      currentStreak: 0,
      rate: 0,
      byLine: [],
    })
  })

  it('统计按时 / 提前 / 延迟、平均偏差与连续按时次数', () => {
    // planned 锚点 → 计划日 0 / 14 / 28 / 42
    const logs = [injectionLog(0), injectionLog(15), injectionLog(33), injectionLog(43)]

    const stats = computeAdherence([maintenancePlanned()], logs, T0 + 50 * DAY)
    const line = injectionStatsOf(stats, 'line-host')

    expect(line.kind).toBe('injection')
    expect(line.total).toBe(4)
    expect(line.onTime).toBe(3)
    expect(line.early).toBe(0)
    expect(line.late).toBe(1)
    // (0 + 1 + 5 + 1) / 4 = 1.75 → 1.8
    expect(line.avgDeviationDays).toBe(1.8)
    expect(line.currentStreak).toBe(1)
  })

  it('连续按时从最近一次往前累计', () => {
    const logs = [injectionLog(0), injectionLog(14), injectionLog(28)]
    const stats = computeAdherence([maintenancePlanned()], logs, T0 + 30 * DAY)

    expect(injectionStatsOf(stats, 'line-host').currentStreak).toBe(3)
    expect(stats.currentStreak).toBe(3)
  })

  it('最近一次提前会中断连续按时，并计入 early 与负偏差', () => {
    const logs = [injectionLog(0), injectionLog(10)]
    const stats = computeAdherence([maintenancePlanned()], logs, T0 + 10 * DAY)
    const line = injectionStatsOf(stats, 'line-host')

    expect(line.total).toBe(2)
    expect(line.onTime).toBe(1)
    expect(line.early).toBe(1)
    expect(line.late).toBe(0)
    expect(line.avgDeviationDays).toBe(-2)
    expect(line.currentStreak).toBe(0)
  })

  it('逾期超过一周的针才计入 missed，窗口内的逾期仍可补登记', () => {
    const logs = [injectionLog(0)]
    const recent = computeAdherence([maintenancePlanned()], logs, T0 + 20 * DAY)
    const recentLine = injectionStatsOf(recent, 'line-host')

    // 第 14 天那针只逾期 6 天：不算漏
    expect(recentLine.missed).toBe(0)

    const late = computeAdherence([maintenancePlanned()], logs, T0 + 40 * DAY)
    const lateLine = injectionStatsOf(late, 'line-host')

    expect(lateLine.total).toBe(1)
    expect(lateLine.avgDeviationDays).toBe(0)
    expect(lateLine.missed).toBe(2) // 第 14、28 天
    expect(lateLine.upcoming).toBe(2) // 第 42、56 天
    expect(late.rate).toBe(0.33) // 1 / (1 + 2)
  })

  it('多条注射线分别统计', () => {
    const host = makeInjectionLine({
      id: 'line-host',
      isHost: true,
      anchor: 'planned',
      phases: [
        {
          id: 'host-p0',
          lineId: 'line-host',
          orderIdx: 0,
          kind: 'maintenance',
          intervalDays: 14,
          repeatCount: 0,
          dose: 40,
          unit: 'mg',
          effectiveFrom: null,
        },
      ],
    })
    const staggered = makeInjectionLine({
      id: 'line-staggered',
      isHost: false,
      anchor: 'planned',
      phases: [
        {
          id: 'staggered-p0',
          lineId: 'line-staggered',
          orderIdx: 0,
          kind: 'maintenance',
          intervalDays: 7,
          repeatCount: 0,
          dose: 25,
          unit: 'mg',
          effectiveFrom: null,
        },
      ],
    })

    const stats = computeAdherence(
      [host, staggered],
      [
        injectionLog(0, 'line-host'),
        injectionLog(0, 'line-staggered'),
        injectionLog(9, 'line-staggered'),
      ],
      T0 + 9 * DAY,
    )

    expect(stats.byLine).toHaveLength(2)
    expect(injectionStatsOf(stats, 'line-host').total).toBe(1)
    expect(injectionStatsOf(stats, 'line-host').avgDeviationDays).toBe(0)
    // 错开线第 2 针计划第 7 天、实际第 9 天 → 偏差 2，窗口 ±2 内按时
    expect(injectionStatsOf(stats, 'line-staggered').total).toBe(2)
    expect(injectionStatsOf(stats, 'line-staggered').onTime).toBe(2)
    expect(injectionStatsOf(stats, 'line-staggered').avgDeviationDays).toBe(1)
    expect(stats.total).toBe(3)
    // 汇总偏差按原始值累加：(0 + 0 + 2) / 3 = 0.67 → 保留一位小数 0.7
    expect(stats.avgDeviationDays).toBe(0.7)
    expect(stats.onTime).toBe(3)
  })
})

describe('computeAdherence（口服线，含漏服）', () => {
  it('按打卡点算完成 / 漏服 / 完成率', () => {
    const oral = makeOralLine({ id: 'line-oral', frequency: 'daily', startDate: T0 })
    const logs = [
      makeLog({ lineId: 'line-oral', scheduledAt: T0, takenAt: T0 }),
      makeLog({ lineId: 'line-oral', scheduledAt: T0 + DAY, takenAt: null, status: 'skipped' }),
      makeLog({ lineId: 'line-oral', scheduledAt: T0 + 2 * DAY, takenAt: T0 + 2 * DAY }),
    ]

    const stats = computeAdherence([oral], logs, T0 + 5 * DAY)
    const line = oralStatsOf(stats, 'line-oral')

    expect(line.kind).toBe('oral')
    expect(line.total).toBe(2)
    // 第 1 天爽约立刻算漏服；第 3 天只逾期 2 天，仍在补登记窗口内
    expect(line.missed).toBe(1)
    expect(line.rate).toBe(0.67) // 2 / (2 + 1)
  })

  it('全部按时打卡时完成率为 1', () => {
    const oral = makeOralLine({ id: 'line-oral', frequency: 'daily', startDate: T0 })
    const logs = [
      makeLog({ lineId: 'line-oral', scheduledAt: T0, takenAt: T0 }),
      makeLog({ lineId: 'line-oral', scheduledAt: T0 + DAY, takenAt: T0 + DAY }),
    ]

    const stats = computeAdherence([oral], logs, T0 + DAY)
    const line = oralStatsOf(stats, 'line-oral')

    expect(line.total).toBe(2)
    expect(line.missed).toBe(0)
    expect(line.rate).toBe(1)
  })

  it('weekly 频次只统计指定周几的打卡点', () => {
    const oral = makeOralLine({
      id: 'line-oral',
      frequency: 'weekly',
      timesPerPeriod: 2,
      daysOfWeek: [1, 4],
      startDate: T0,
    })
    const logs = [
      makeLog({ lineId: 'line-oral', scheduledAt: T0, takenAt: T0 }),
      makeLog({ lineId: 'line-oral', scheduledAt: T0 + 3 * DAY, takenAt: null, status: 'skipped' }),
    ]

    const stats = computeAdherence([oral], logs, T0 + 6 * DAY)
    const line = oralStatsOf(stats, 'line-oral')

    // weekly 只按「每周 N 次」均匀分布（周一、周五），第 3 天不在打卡点里
    expect(line.total).toBe(1)
    expect(line.missed).toBe(0)
    expect(line.rate).toBe(1)
  })

  it('汇总口径同时包含注射线与口服线', () => {
    const host = maintenancePlanned()
    const oral = makeOralLine({ id: 'line-oral', frequency: 'daily', startDate: T0 })

    const stats = computeAdherence(
      [host, oral],
      [
        injectionLog(0, 'line-host'),
        makeLog({ lineId: 'line-oral', scheduledAt: T0, takenAt: T0 }),
      ],
      T0,
    )

    expect(stats.total).toBe(2)
    expect(stats.byLine.map((line) => line.kind)).toEqual(['injection', 'oral'])
    expect(stats.missed).toBe(0)
    expect(stats.rate).toBe(1)
  })
})
