import { describe, expect, it } from 'vitest'
import type {
  Injection,
  InjectionSite,
  PhaseKind,
  Regimen,
  RegimenPhase,
} from '@/types'
import {
  buildSchedule,
  classifyWindow,
  nextDose,
  totalPlannedDoses,
} from '../schedule'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

let injectionSeq = 0

function makePhase(input: {
  orderIdx: number
  kind?: PhaseKind
  intervalDays?: number
  repeatCount?: number
  dose?: number | null
  unit?: string
}): RegimenPhase {
  const {
    orderIdx,
    kind = 'maintenance',
    intervalDays = 14,
    repeatCount = 0,
    dose = 40,
    unit = 'mg',
  } = input

  return {
    id: `phase-${orderIdx}`,
    regimenId: 'regimen-1',
    orderIdx,
    kind,
    intervalDays,
    repeatCount,
    dose,
    unit,
  }
}

function makeRegimen(
  phases: RegimenPhase[],
  opts: {
    anchor?: Regimen['anchor']
    windowDays?: number
    createdAt?: number
  } = {},
): Regimen {
  return {
    id: 'regimen-1',
    medicationId: 'med-1',
    name: '测试方案',
    anchor: opts.anchor ?? 'actual',
    windowDays: opts.windowDays ?? 2,
    isActive: true,
    createdAt: opts.createdAt ?? T0,
    phases,
  }
}

function makeInjection(
  offsetDays: number,
  site: InjectionSite = 'abdomen_ul',
): Injection {
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

/** 克罗恩病阿达木单抗：160mg@0周、80mg@2周、40mg@4周起每 2 周 */
function crohnRegimen(): Regimen {
  return makeRegimen([
    makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 160 }),
    makePhase({ orderIdx: 1, kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 80 }),
    makePhase({ orderIdx: 2, kind: 'maintenance', intervalDays: 14, repeatCount: 0, dose: 40 }),
  ])
}

function maintenanceEvery14(): Regimen {
  return makeRegimen([
    makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 14, repeatCount: 0, dose: 40 }),
  ])
}

describe('buildSchedule', () => {
  it('无注射记录时第 0 针计划时间等于 regimen.createdAt', () => {
    const plans = buildSchedule({
      regimen: crohnRegimen(),
      injections: [],
      now: T0,
    })

    expect(plans[0].index).toBe(0)
    expect(plans[0].plannedAt).toBe(T0)
    expect(plans[0].status).toBe('due')
    expect(plans[0].actualAt).toBeUndefined()
    expect(plans[0].deviationDays).toBeUndefined()
    expect(plans[0].windowStatus).toBeUndefined()
  })

  it('负荷阶段 → 维持阶段按 repeatCount 正确推进', () => {
    const plans = buildSchedule({
      regimen: crohnRegimen(),
      injections: [],
      now: T0 + 35 * DAY,
    })

    expect(plans).toHaveLength(5)
    expect(plans.map((plan) => plan.dose)).toEqual([160, 80, 40, 40, 40])
    expect(plans.map((plan) => plan.phaseKind)).toEqual([
      'loading',
      'loading',
      'maintenance',
      'maintenance',
      'maintenance',
    ])
    expect(plans.map((plan) => plan.plannedAt)).toEqual(
      [0, 14, 28, 42, 56].map((offset) => T0 + offset * DAY),
    )
    expect(plans.map((plan) => plan.status)).toEqual([
      'overdue',
      'overdue',
      'overdue',
      'upcoming',
      'upcoming',
    ])
  })

  it("anchor: 'actual' 下迟到注射导致后续整体顺延", () => {
    const injections = [makeInjection(0), makeInjection(16)]
    const plans = buildSchedule({
      regimen: maintenanceEvery14(),
      injections,
      now: T0 + 16 * DAY,
    })

    expect(plans).toHaveLength(4)
    expect(plans[1].plannedAt).toBe(T0 + 14 * DAY)
    expect(plans[1].actualAt).toBe(T0 + 16 * DAY)
    expect(plans[1].deviationDays).toBe(2)
    expect(plans[1].windowStatus).toBe('on_time')
    // 下一针从实际时间（第 16 天）+ 14 天起算
    expect(plans[2].plannedAt).toBe(T0 + 30 * DAY)
    expect(plans[3].plannedAt).toBe(T0 + 44 * DAY)
  })

  it("anchor: 'actual' 下缺少实际记录时退回上一针计划时间", () => {
    // 只有第 0 针有记录；第 1 针逾期未登记时，第 2 针应从第 1 针的“计划”时间起算
    const plans = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: [makeInjection(0)],
      now: T0 + 40 * DAY,
    })

    expect(plans[1].plannedAt).toBe(T0 + 14 * DAY)
    expect(plans[1].status).toBe('overdue')
    expect(plans[2].plannedAt).toBe(T0 + 28 * DAY)
    expect(plans[2].status).toBe('overdue')
    expect(plans[3].plannedAt).toBe(T0 + 42 * DAY)
    expect(plans[4].plannedAt).toBe(T0 + 56 * DAY)
  })

  it("anchor: 'planned' 下迟到不影响后续计划日", () => {
    const injections = [makeInjection(0), makeInjection(16)]
    const plans = buildSchedule({
      regimen: makeRegimen(
        [makePhase({ orderIdx: 0, intervalDays: 14, repeatCount: 0 })],
        { anchor: 'planned' },
      ),
      injections,
      now: T0 + 16 * DAY,
    })

    expect(plans[1].plannedAt).toBe(T0 + 14 * DAY)
    expect(plans[2].plannedAt).toBe(T0 + 28 * DAY)
    expect(plans[3].plannedAt).toBe(T0 + 42 * DAY)
  })

  it('超过 now - 1 天仍未登记的计划判定为 overdue', () => {
    const plans = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: [],
      now: T0 + 10 * DAY,
    })

    expect(plans[0].plannedAt).toBe(T0)
    expect(plans[0].status).toBe('overdue')
    expect(plans[1].status).toBe('upcoming')
  })

  it('due / overdue 的 1 天边界严格按规则判定', () => {
    const due = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: [],
      now: T0 + DAY,
    })
    const overdue = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: [],
      now: T0 + DAY + 1,
    })

    expect(due[0].status).toBe('due')
    expect(overdue[0].status).toBe('overdue')
  })

  it('无限维持阶段不会死循环，且只返回未来 2 针', () => {
    const now = T0 + 100 * DAY
    const plans = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: [],
      now,
    })

    // 0..98 天是已发生的计划（8 针），之后 112、126 是未来 2 针
    expect(plans).toHaveLength(10)
    expect(plans.filter((plan) => plan.plannedAt > now)).toHaveLength(2)
    expect(plans[8].plannedAt).toBe(T0 + 112 * DAY)
    expect(plans[9].plannedAt).toBe(T0 + 126 * DAY)
  })

  it('内部会对未排序的 injections 按时间升序处理', () => {
    const outOfOrder = [makeInjection(16), makeInjection(0)]
    const plans = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: outOfOrder,
      now: T0 + 16 * DAY,
    })

    expect(plans[0].plannedAt).toBe(T0)
    expect(plans[0].actualAt).toBe(T0)
    expect(plans[1].plannedAt).toBe(T0 + 14 * DAY)
    expect(plans[1].actualAt).toBe(T0 + 16 * DAY)
  })

  it('deviationDays 保留一位小数', () => {
    const plans = buildSchedule({
      regimen: maintenanceEvery14(),
      injections: [makeInjection(0), makeInjection(16.34)],
      now: T0 + 17 * DAY,
    })

    expect(plans[1].deviationDays).toBe(2.3)
  })

  it('有限方案阶段耗尽后不再生成计划', () => {
    const regimen = makeRegimen([
      makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 7, repeatCount: 1, dose: 160 }),
    ])
    const plans = buildSchedule({
      regimen,
      injections: [makeInjection(0)],
      now: T0 + 10 * DAY,
    })

    expect(plans).toHaveLength(1)
    expect(plans[0].status).toBe('done')
  })

  it('空 phases 返回 []', () => {
    expect(
      buildSchedule({
        regimen: makeRegimen([]),
        injections: [makeInjection(0)],
        now: T0,
      }),
    ).toEqual([])
  })

  it('非法间隔与窗口抛中文错误', () => {
    expect(() =>
      buildSchedule({
        regimen: makeRegimen([makePhase({ orderIdx: 0, intervalDays: 0 })]),
        injections: [],
        now: T0,
      }),
    ).toThrow('给药间隔必须大于 0 天')

    expect(() =>
      buildSchedule({
        regimen: makeRegimen([makePhase({ orderIdx: 0, intervalDays: -1 })]),
        injections: [],
        now: T0,
      }),
    ).toThrow('给药间隔必须大于 0 天')

    expect(() =>
      buildSchedule({
        regimen: makeRegimen([makePhase({ orderIdx: 0 })], { windowDays: -1 }),
        injections: [],
        now: T0,
      }),
    ).toThrow('允许偏差窗口不能小于 0 天')
  })
})

describe('classifyWindow', () => {
  it('窗口内（含边界）为 on_time', () => {
    expect(classifyWindow(0, 2 * DAY, 2)).toBe('on_time')
    expect(classifyWindow(0, -2 * DAY, 2)).toBe('on_time')
    expect(classifyWindow(0, 0, 0)).toBe('on_time')
  })

  it('早于窗口为 early', () => {
    expect(classifyWindow(0, -3 * DAY, 2)).toBe('early')
    expect(classifyWindow(0, -1 * DAY, 0)).toBe('early')
  })

  it('晚于窗口为 late', () => {
    expect(classifyWindow(0, 3 * DAY, 2)).toBe('late')
    expect(classifyWindow(0, 1 * DAY, 0)).toBe('late')
  })

  it('负窗口抛中文错误', () => {
    expect(() => classifyWindow(0, 0, -1)).toThrow('允许偏差窗口不能小于 0 天')
  })
})

describe('nextDose', () => {
  it('跳过已完成的针，返回第一个未完成的计划', () => {
    const plan = nextDose({
      regimen: maintenanceEvery14(),
      injections: [makeInjection(0), makeInjection(14)],
      now: T0 + 15 * DAY,
    })

    expect(plan).not.toBeNull()
    expect(plan?.index).toBe(2)
    expect(plan?.status).toBe('upcoming')
    expect(plan?.plannedAt).toBe(T0 + 28 * DAY)
  })

  it('有限方案全部完成后返回 null', () => {
    const regimen = makeRegimen([
      makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 7, repeatCount: 1 }),
    ])

    expect(
      nextDose({
        regimen,
        injections: [makeInjection(0)],
        now: T0 + 10 * DAY,
      }),
    ).toBeNull()
  })
})

describe('totalPlannedDoses', () => {
  it('有限方案累加 repeatCount', () => {
    expect(
      totalPlannedDoses([
        makePhase({ orderIdx: 0, repeatCount: 2 }),
        makePhase({ orderIdx: 1, repeatCount: 3 }),
      ]),
    ).toBe(5)
    expect(totalPlannedDoses([makePhase({ orderIdx: 0, repeatCount: 1 })])).toBe(1)
  })

  it('空阶段为 0', () => {
    expect(totalPlannedDoses([])).toBe(0)
  })

  it('repeatCount: 0 返回 Infinity', () => {
    expect(totalPlannedDoses([makePhase({ orderIdx: 0, repeatCount: 0 })])).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(
      totalPlannedDoses([
        makePhase({ orderIdx: 0, repeatCount: 2 }),
        makePhase({ orderIdx: 1, repeatCount: 0 }),
        makePhase({ orderIdx: 2, repeatCount: 3 }),
      ]),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it('非法间隔抛中文错误', () => {
    expect(() =>
      totalPlannedDoses([makePhase({ orderIdx: 0, intervalDays: 0, repeatCount: 1 })]),
    ).toThrow('给药间隔必须大于 0 天')
  })
})
