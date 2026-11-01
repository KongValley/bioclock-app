import { describe, expect, it } from 'vitest'
import {
  ORAL_HORIZON_DAYS,
  buildInjectionPlans,
  buildLineSchedule,
  buildOralPlans,
  buildSchedule,
  classifyStatus,
  classifyWindow,
  nextDose,
  nextDoseForLine,
  oralWeekdays,
  resolveHostLine,
  totalPlannedDoses,
} from '../schedule'
import {
  DAY,
  T0,
  injectionLog,
  makeInjectionLine,
  makeLog,
  makeOralLine,
  makePhase,
  offsets,
} from './fixtures'

/** 克罗恩病阿达木单抗：160mg@0周、80mg@2周、40mg@4周起每 2 周 */
function crohnLine() {
  return makeInjectionLine({
    id: 'line-host',
    phases: [
      makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 160 }),
      makePhase({ orderIdx: 1, kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 80 }),
      makePhase({ orderIdx: 2, kind: 'maintenance', intervalDays: 14, repeatCount: 0, dose: 40 }),
    ],
  })
}

describe('classifyWindow', () => {
  it('窗口内（含边界）为 on_time', () => {
    expect(classifyWindow(0, 2 * DAY, 2)).toBe('on_time')
    expect(classifyWindow(0, -2 * DAY, 2)).toBe('on_time')
    expect(classifyWindow(0, 0, 0)).toBe('on_time')
  })

  it('早于窗口为 early，晚于窗口为 late', () => {
    expect(classifyWindow(0, -3 * DAY, 2)).toBe('early')
    expect(classifyWindow(0, 3 * DAY, 2)).toBe('late')
    expect(classifyWindow(0, -1 * DAY, 0)).toBe('early')
    expect(classifyWindow(0, 1 * DAY, 0)).toBe('late')
  })

  it('负窗口抛中文错误', () => {
    expect(() => classifyWindow(0, 0, -1)).toThrow('允许偏差窗口不能小于 0 天')
  })
})

describe('classifyStatus', () => {
  it('按 1 天边界判定 due / overdue / upcoming', () => {
    expect(classifyStatus(T0, T0 + DAY)).toBe('due')
    expect(classifyStatus(T0, T0 - DAY)).toBe('due')
    expect(classifyStatus(T0, T0 + DAY + 1)).toBe('overdue')
    expect(classifyStatus(T0, T0 - DAY - 1)).toBe('upcoming')
  })
})

describe('注射线：负荷 + 维持推进', () => {
  it('无记录时首针计划时间 = now，计划时间按阶段间隔推进', () => {
    const plans = buildInjectionPlans({ line: crohnLine(), logs: [], now: T0 })

    expect(plans[0].plannedAt).toBe(T0)
    expect(plans[0].status).toBe('due')
    expect(plans[0].kind).toBe('injection')
    expect(plans[0].lineId).toBe('line-host')
    expect(plans[0].medicationId).toBe('med-1')
    expect(plans[0].actualAt).toBeUndefined()
    expect(plans[0].deviationDays).toBeUndefined()
    expect(plans[0].windowStatus).toBeUndefined()
  })

  it('负荷 → 维持的剂量、阶段与时间正确推进', () => {
    const plans = buildInjectionPlans({
      line: crohnLine(),
      logs: [
        makeLog({ scheduledAt: T0, takenAt: T0, dose: 160 }),
        makeLog({ scheduledAt: T0 + 14 * DAY, takenAt: T0 + 14 * DAY, dose: 80 }),
      ],
      now: T0 + 35 * DAY,
    })

    expect(plans.map((plan) => plan.dose)).toEqual([160, 80, 40, 40, 40])
    expect(plans.map((plan) => plan.phaseKind)).toEqual([
      'loading',
      'loading',
      'maintenance',
      'maintenance',
      'maintenance',
    ])
    expect(offsets(plans)).toEqual([0, 14, 28, 42, 56])
    expect(plans.map((plan) => plan.status)).toEqual([
      'done',
      'done',
      'overdue',
      'upcoming',
      'upcoming',
    ])
  })

  it('无记录时从当天起算，只输出当次 + 未来 2 针', () => {
    const plans = buildInjectionPlans({
      line: crohnLine(),
      logs: [],
      now: T0 + 35 * DAY,
    })

    expect(offsets(plans)).toEqual([35, 49, 63])
    expect(plans.map((plan) => plan.dose)).toEqual([160, 80, 40])
    expect(plans.map((plan) => plan.status)).toEqual(['due', 'upcoming', 'upcoming'])
  })

  it("anchor: 'actual' 迟到会让后续顺延", () => {
    const line = makeInjectionLine({ anchor: 'actual' })
    const plans = buildInjectionPlans({
      line,
      logs: [injectionLog(0), injectionLog(16)],
      now: T0 + 16 * DAY,
    })

    expect(offsets(plans)).toEqual([0, 14, 30, 44])
    expect(plans[1].actualAt).toBe(T0 + 16 * DAY)
    expect(plans[1].deviationDays).toBe(2)
    expect(plans[1].windowStatus).toBe('on_time')
    expect(plans.map((plan) => plan.status)).toEqual([
      'done',
      'done',
      'upcoming',
      'upcoming',
    ])
  })

  it("anchor: 'planned' 下迟到不影响后续计划日", () => {
    const line = makeInjectionLine({ anchor: 'planned' })
    const plans = buildInjectionPlans({
      line,
      logs: [injectionLog(0), injectionLog(16)],
      now: T0 + 16 * DAY,
    })

    expect(offsets(plans)).toEqual([0, 14, 28, 42])
    expect(plans[1].windowStatus).toBe('on_time')
  })

  it('超过窗口的迟到判定为 late，并记录一位小数的偏差', () => {
    const line = makeInjectionLine({ anchor: 'planned', windowDays: 2 })
    const plans = buildInjectionPlans({
      line,
      logs: [injectionLog(0), injectionLog(16.34)],
      now: T0 + 17 * DAY,
    })

    expect(plans[1].deviationDays).toBe(2.3)
    expect(plans[1].windowStatus).toBe('late')
  })

  it('缺少记录时退回上一针计划时间', () => {
    const plans = buildInjectionPlans({
      line: makeInjectionLine({ anchor: 'actual' }),
      logs: [injectionLog(0)],
      now: T0 + 40 * DAY,
    })

    expect(offsets(plans)).toEqual([0, 14, 28, 42, 56])
    expect(plans[1].status).toBe('overdue')
    expect(plans[0].doseLogId).toBeDefined()
  })

  it('记录里的剂量与单位覆盖到计划项上', () => {
    const plans = buildInjectionPlans({
      line: makeInjectionLine(),
      logs: [makeLog({ scheduledAt: T0, takenAt: T0, dose: 80, unit: 'mg' })],
      now: T0,
    })

    expect(plans[0].dose).toBe(80)
    expect(plans[0].unit).toBe('mg')
  })

  it('记录按 scheduledAt 认领对应计划，即使实际时间乱序', () => {
    const first = T0
    const second = T0 + 14 * DAY
    const plans = buildInjectionPlans({
      line: makeInjectionLine({ anchor: 'planned' }),
      logs: [
        makeLog({ scheduledAt: second, takenAt: second + 2 * DAY }),
        makeLog({ scheduledAt: first, takenAt: first }),
      ],
      now: second,
    })

    expect(plans[0].actualAt).toBe(first)
    expect(plans[1].actualAt).toBe(second + 2 * DAY)
    expect(plans[1].deviationDays).toBe(2)
  })

  it('有限方案阶段耗尽后不再生成计划', () => {
    const line = makeInjectionLine({
      phases: [makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 7, repeatCount: 1, dose: 160 })],
    })
    const plans = buildInjectionPlans({ line, logs: [injectionLog(0)], now: T0 + 10 * DAY })

    expect(plans).toHaveLength(1)
    expect(plans[0].status).toBe('done')
  })

  it('无限维持阶段只输出未来 2 针', () => {
    const now = T0 + 100 * DAY
    const plans = buildInjectionPlans({ line: makeInjectionLine(), logs: [], now })

    // now 时首针计划 = now，之后 14 / 28 天共 3 针
    expect(offsets(plans)).toEqual([100, 114, 128])
    expect(plans.filter((plan) => plan.plannedAt > now)).toHaveLength(2)
  })

  it('爽约（skipped）且计划日已过 → missed；未来爽约 → upcoming', () => {
    const line = makeInjectionLine({ anchor: 'planned' })
    const plans = buildInjectionPlans({
      line,
      logs: [makeLog({ scheduledAt: T0, takenAt: null, status: 'skipped' })],
      now: T0 + 2 * DAY,
    })

    expect(plans[0].status).toBe('missed')
    expect(plans[0].actualAt).toBeUndefined()
    expect(plans[1].status).toBe('upcoming')
  })

  it('非法间隔与窗口抛中文错误', () => {
    expect(() =>
      buildInjectionPlans({
        line: makeInjectionLine({ phases: [makePhase({ orderIdx: 0, intervalDays: 0 })] }),
        logs: [],
        now: T0,
      }),
    ).toThrow('给药间隔必须大于 0 天')

    expect(() =>
      buildInjectionPlans({
        line: makeInjectionLine({ windowDays: -1 }),
        logs: [],
        now: T0,
      }),
    ).toThrow('允许偏差窗口不能小于 0 天')
  })

  it('空 phases 返回 []', () => {
    expect(
      buildInjectionPlans({ line: makeInjectionLine({ phases: [] }), logs: [], now: T0 }),
    ).toEqual([])
  })
})

describe('同步线', () => {
  it('针日跟随宿主线，不自己累加', () => {
    const host = makeInjectionLine({
      id: 'line-host',
      isHost: true,
      phases: [makePhase({ lineId: 'line-host', orderIdx: 0, intervalDays: 14 })],
    })
    const synced = makeInjectionLine({
      id: 'line-synced',
      medicationId: 'med-2',
      isHost: false,
      syncWithHost: true,
      // 自己的间隔故意不同，验证不会按自己累加
      phases: [makePhase({ lineId: 'line-synced', orderIdx: 0, intervalDays: 30, dose: 20 })],
    })

    const plans = buildSchedule({
      lines: [host, synced],
      logs: [injectionLog(0, 'line-host'), injectionLog(17, 'line-host')],
      now: T0 + 17 * DAY,
    })

    const hostPlans = plans.filter((plan) => plan.lineId === 'line-host')
    const syncedPlans = plans.filter((plan) => plan.lineId === 'line-synced')

    const hostDaySet = hostPlans.map((plan) => plan.plannedAt)
    expect(syncedPlans.length).toBeGreaterThan(0)
    expect(syncedPlans.every((plan) => hostDaySet.includes(plan.plannedAt))).toBe(true)
    // 宿主按实际锚点：0 / 14（记录在 17）→ 31 / 45
    expect(offsets(hostPlans).slice(0, 4)).toEqual([0, 14, 31, 45])
    expect(offsets(syncedPlans).slice(0, 4)).toEqual([0, 14, 31, 45])
    expect(syncedPlans[0].dose).toBe(20)
    expect(syncedPlans[0].kind).toBe('injection')
  })

  it('跟随宿主的计划日而不看自己的 anchor', () => {
    const host = makeInjectionLine({
      id: 'line-host',
      anchor: 'planned',
      phases: [makePhase({ lineId: 'line-host', orderIdx: 0, intervalDays: 7 })],
    })
    const synced = makeInjectionLine({
      id: 'line-synced',
      isHost: false,
      syncWithHost: true,
      anchor: 'planned',
    })

    const plans = buildSchedule({
      lines: [host, synced],
      logs: [injectionLog(0, 'line-host')],
      now: T0 + 7 * DAY,
    })

    expect(offsets(plans.filter((plan) => plan.lineId === 'line-host')).slice(0, 3)).toEqual([
      0, 7, 14,
    ])
    expect(offsets(plans.filter((plan) => plan.lineId === 'line-synced')).slice(0, 3)).toEqual([
      0, 7, 14,
    ])
  })

  it('resolveHostLine 优先返回 isHost 的注射线', () => {
    const host = makeInjectionLine({ id: 'line-host', isHost: true })
    const other = makeInjectionLine({ id: 'line-other', isHost: false, anchor: 'planned' })
    const synced = makeInjectionLine({ id: 'line-synced', isHost: false, syncWithHost: true })

    expect(resolveHostLine(synced, [synced, other, host])?.id).toBe('line-host')
    expect(resolveHostLine(synced, [synced, other])?.id).toBe('line-other')
    expect(resolveHostLine(synced, [synced])).toBeNull()
  })

  it('没有宿主可跟随时退回独立推进', () => {
    const synced = makeInjectionLine({ id: 'line-synced', isHost: false, syncWithHost: true })
    const plans = buildLineSchedule({ line: synced, logs: [], now: T0 })

    expect(plans[0].plannedAt).toBe(T0)
    expect(offsets(plans)).toEqual([0, 14, 28])
  })
})

describe('错开线（独立周期）', () => {
  it('不等间隔的错开线按自己的间隔推进，不受宿主影响', () => {
    const host = makeInjectionLine({
      id: 'line-host',
      isHost: true,
      anchor: 'planned',
      phases: [makePhase({ lineId: 'line-host', orderIdx: 0, intervalDays: 14 })],
    })
    const staggered = makeInjectionLine({
      id: 'line-staggered',
      medicationId: 'med-3',
      isHost: false,
      syncWithHost: false,
      anchor: 'planned',
      phases: [
        makePhase({ lineId: 'line-staggered', orderIdx: 0, intervalDays: 7, dose: 50 }),
      ],
    })

    const plans = buildSchedule({
      lines: [host, staggered],
      logs: [injectionLog(0, 'line-host')],
      now: T0,
    })

    expect(offsets(plans.filter((plan) => plan.lineId === 'line-host'))).toEqual([0, 14, 28])
    expect(offsets(plans.filter((plan) => plan.lineId === 'line-staggered'))).toEqual([
      0, 7, 14,
    ])
    // 汇总后按时间升序
    expect(offsets(plans)).toEqual([0, 0, 7, 14, 14, 28])
  })

  it('一条线的记录不会串到另一条线', () => {
    const host = makeInjectionLine({ id: 'line-host', isHost: true, anchor: 'planned' })
    const staggered = makeInjectionLine({
      id: 'line-staggered',
      isHost: false,
      anchor: 'planned',
      phases: [makePhase({ lineId: 'line-staggered', orderIdx: 0, intervalDays: 7, dose: 25 })],
    })

    const plans = buildSchedule({
      lines: [host, staggered],
      logs: [injectionLog(0, 'line-host'), injectionLog(2, 'line-staggered')],
      now: T0 + 2 * DAY,
    })

    const hostPlans = plans.filter((plan) => plan.lineId === 'line-host')
    const staggeredPlans = plans.filter((plan) => plan.lineId === 'line-staggered')

    // 宿主：0 / 14 / 28；错开线起点对齐它自己的首条记录（第 2 天），之后每 7 天。
    expect(offsets(hostPlans)).toEqual([0, 14, 28])
    expect(offsets(staggeredPlans)).toEqual([2, 9, 16])
    expect(staggeredPlans.every((plan) => plan.dose === 25 || plan.status === 'done')).toBe(true)
    expect(
      staggeredPlans.find((plan) => plan.status === 'done')?.dose,
    ).toBe(40) // 记录里的剂量覆盖计划剂量
    expect(hostPlans.filter((plan) => plan.status === 'done')).toHaveLength(1)
    expect(staggeredPlans.filter((plan) => plan.status === 'done')).toHaveLength(1)
    expect(
      staggeredPlans.find((plan) => plan.status === 'done')?.deviationDays,
    ).toBe(0)
  })
})

describe('口服线：打卡点生成', () => {
  it('daily 每天一个打卡点，历史全量 + 未来覆盖默认天数', () => {
    const plans = buildOralPlans({
      line: makeOralLine({ frequency: 'daily' }),
      logs: [],
      now: T0 + 2 * DAY,
    })

    const days = offsets(plans)
    expect(days[0]).toBe(0)
    expect(days[days.length - 1]).toBe(2 + ORAL_HORIZON_DAYS)
    expect(days).toHaveLength(2 + ORAL_HORIZON_DAYS + 1)
    expect(plans[0].kind).toBe('oral')
    expect(plans[0].phaseId).toBeNull()
    expect(plans[0].status).toBe('overdue')
    expect(plans[2].status).toBe('due')
  })

  it('weekly：给定 daysOfWeek 时只在指定周几打卡', () => {
    // T0 = 周一(1)；选周一、周四(4)
    const plans = buildOralPlans({
      line: makeOralLine({ frequency: 'weekly', timesPerPeriod: 2, daysOfWeek: [1, 4] }),
      logs: [],
      now: T0 + 7 * DAY,
    })

    const days = offsets(plans)
    expect(days.slice(0, 4)).toEqual([0, 4, 7, 11])
    expect(days.every((day) => [1, 5].includes(new Date(T0 + day * DAY).getUTCDay()))).toBe(true)
  })

  it('weekly：没给 daysOfWeek 时按次数均匀分布（周一为起点）', () => {
    expect(oralWeekdays(makeOralLine({ frequency: 'weekly', timesPerPeriod: 2 }).oral!)).toEqual([
      1, 5,
    ])
    expect(oralWeekdays(makeOralLine({ frequency: 'weekly', timesPerPeriod: 3 }).oral!)).toEqual([
      1, 3, 6,
    ])
    expect(oralWeekdays(makeOralLine({ frequency: 'weekly', timesPerPeriod: 1 }).oral!)).toEqual([1])
  })

  it('custom：严格按 daysOfWeek 周几打卡（0 表示周日）', () => {
    const plans = buildOralPlans({
      line: makeOralLine({ frequency: 'custom', daysOfWeek: [0, 3] }),
      logs: [],
      now: T0 + 5 * DAY,
    })

    const days = offsets(plans)
    // 周一 0 → 周三 2 → 周日 6 → 下周三 9 ...
    expect(days.slice(0, 4)).toEqual([2, 6, 9, 13])
  })

  it('durationDays 到期后不再生成打卡点', () => {
    const plans = buildOralPlans({
      line: makeOralLine({ frequency: 'daily', durationDays: 3 }),
      logs: [],
      now: T0,
    })

    const days = plans.map((plan) => (plan.plannedAt - T0) / DAY)
    expect(days).toEqual([0, 1, 2])
  })

  it('打卡记录对应到计划点，漏服记为 missed', () => {
    const plans = buildOralPlans({
      line: makeOralLine({ frequency: 'daily', startDate: T0 }),
      logs: [
        makeLog({ lineId: 'line-oral', scheduledAt: T0, takenAt: T0, dose: 2, unit: '片' }),
        makeLog({ lineId: 'line-oral', scheduledAt: T0 + DAY, takenAt: null, status: 'skipped' }),
        makeLog({ lineId: 'line-oral', scheduledAt: T0 + 2 * DAY, takenAt: T0 + 2 * DAY }),
      ],
      now: T0 + 5 * DAY,
    })

    expect(plans[0].status).toBe('done')
    expect(plans[0].dose).toBe(2)
    expect(plans[0].unit).toBe('片')
    expect(plans[1].status).toBe('missed')
    expect(plans[2].status).toBe('done')
    // 第 3 天到点未打卡 → overdue（后续汇总时计入漏服）
    expect(plans[3].status).toBe('overdue')
    expect(plans[4].status).toBe('due')
    expect(plans[7].status).toBe('upcoming')
  })

  it('疗程结束后不再输出计划点', () => {
    const plans = buildOralPlans({
      line: makeOralLine({ frequency: 'daily', durationDays: 2 }),
      logs: [],
      now: T0 + 30 * DAY,
    })

    expect(plans).toHaveLength(2)
  })

  it('custom 不选周几抛中文错误', () => {
    expect(() =>
      buildOralPlans({
        line: makeOralLine({ frequency: 'custom', daysOfWeek: [] }),
        logs: [],
        now: T0,
      }),
    ).toThrow('自定义服药频率至少要选择一周中的一天')
  })
})

describe('nextDose / nextDoseForLine', () => {
  it('跳过已完成的针', () => {
    const plan = nextDose({
      lines: [makeInjectionLine()],
      logs: [injectionLog(0), injectionLog(14)],
      now: T0 + 15 * DAY,
    })

    expect(plan?.index).toBe(2)
    expect(plan?.plannedAt).toBe(T0 + 28 * DAY)
    expect(plan?.status).toBe('upcoming')
  })

  it('跨线取最早的一条未完成计划（含口服）', () => {
    const plan = nextDose({
      lines: [
        makeInjectionLine({ id: 'line-host' }),
        makeOralLine({ id: 'line-oral', frequency: 'daily', startDate: T0 + DAY }),
      ],
      logs: [injectionLog(0)],
      now: T0,
    })

    expect(plan?.lineId).toBe('line-oral')
    expect(plan?.plannedAt).toBe(T0 + DAY)
  })

  it('有限方案全部完成后返回 null', () => {
    const line = makeInjectionLine({
      phases: [makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 7, repeatCount: 1 })],
    })

    expect(nextDoseForLine({ line, logs: [injectionLog(0)], now: T0 + 10 * DAY })).toBeNull()
  })
})

describe('totalPlannedDoses', () => {
  it('有限方案累加 repeatCount，无限维持阶段返回 Infinity', () => {
    expect(
      totalPlannedDoses([
        makePhase({ orderIdx: 0, repeatCount: 2 }),
        makePhase({ orderIdx: 1, repeatCount: 3 }),
      ]),
    ).toBe(5)
    expect(totalPlannedDoses([])).toBe(0)
    expect(
      totalPlannedDoses([
        makePhase({ orderIdx: 0, repeatCount: 2 }),
        makePhase({ orderIdx: 1, repeatCount: 0 }),
      ]),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it('非法间隔抛中文错误', () => {
    expect(() =>
      totalPlannedDoses([makePhase({ orderIdx: 0, intervalDays: 0, repeatCount: 1 })]),
    ).toThrow('给药间隔必须大于 0 天')
  })
})
