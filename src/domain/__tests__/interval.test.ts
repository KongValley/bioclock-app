import { describe, expect, it } from 'vitest'
import { buildIntervalChangePhases } from '../interval'
import { makePhase } from './fixtures'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 5)

describe('从下一针起调整注射间隔', () => {
  it('保留旧阶段，在生效时间追加新维持阶段', () => {
    const phases = [
      makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 56, repeatCount: 0 }),
    ]
    const effectiveFrom = T0 + 42 * DAY
    const next = buildIntervalChangePhases(phases, 42, effectiveFrom)

    expect(next).toEqual([
      {
        orderIdx: 0,
        kind: 'maintenance',
        intervalDays: 56,
        repeatCount: 0,
        dose: 40,
        unit: 'mg',
        effectiveFrom: null,
      },
      {
        orderIdx: 1,
        kind: 'maintenance',
        intervalDays: 42,
        repeatCount: 0,
        dose: 40,
        unit: 'mg',
        effectiveFrom,
      },
    ])
  })

  it('保留负荷阶段', () => {
    const phases = [
      makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 14, repeatCount: 2 }),
      makePhase({ orderIdx: 1, kind: 'maintenance', intervalDays: 56, repeatCount: 0 }),
    ]
    const effectiveFrom = T0 + 60 * DAY
    const next = buildIntervalChangePhases(phases, 42, effectiveFrom)

    expect(next.map((phase) => [phase.kind, phase.intervalDays, phase.effectiveFrom])).toEqual([
      ['loading', 14, null],
      ['maintenance', 56, null],
      ['maintenance', 42, effectiveFrom],
    ])
  })

  it('重复在同一个时间点调整会替换旧的新阶段', () => {
    const effectiveFrom = T0 + 42 * DAY
    const first = buildIntervalChangePhases(
      [makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 56, repeatCount: 0 })],
      42,
      effectiveFrom,
    )
    const second = buildIntervalChangePhases(
      first.map((phase) => ({ ...phase, id: 'x', lineId: 'l' })),
      35,
      effectiveFrom,
    )

    expect(second.filter((phase) => phase.effectiveFrom === effectiveFrom)).toHaveLength(1)
    expect(second[second.length - 1].intervalDays).toBe(35)
  })

  it('负荷阶段不允许调整', () => {
    const phases = [makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 14, repeatCount: 2 })]
    expect(() => buildIntervalChangePhases(phases, 42, T0)).toThrow(/负荷阶段/)
  })

  it('非法间隔抛中文错误', () => {
    const phases = [makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 56, repeatCount: 0 })]
    expect(() => buildIntervalChangePhases(phases, 0, T0)).toThrow(/1 到 365/)
  })
})
