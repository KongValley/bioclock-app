import { describe, expect, it } from 'vitest'
import { buildIntervalChangePhases } from '../interval'
import { makePhase } from './fixtures'

describe('从下一针起调整注射间隔', () => {
  it('保留旧间隔的历史，下一针起使用新间隔', () => {
    const phases = [makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 56, repeatCount: 0 })]
    const next = buildIntervalChangePhases(phases, 10, 42)

    expect(next).toEqual([
      {
        orderIdx: 0,
        kind: 'maintenance',
        intervalDays: 56,
        repeatCount: 10,
        dose: 40,
        unit: 'mg',
      },
      {
        orderIdx: 1,
        kind: 'maintenance',
        intervalDays: 42,
        repeatCount: 0,
        dose: 40,
        unit: 'mg',
      },
    ])
  })

  it('保留负荷阶段，只截断当前维持阶段', () => {
    const phases = [
      makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 14, repeatCount: 2 }),
      makePhase({ orderIdx: 1, kind: 'maintenance', intervalDays: 56, repeatCount: 0 }),
    ]
    const next = buildIntervalChangePhases(phases, 5, 42)

    expect(next.map((phase) => [phase.kind, phase.intervalDays, phase.repeatCount])).toEqual([
      ['loading', 14, 2],
      ['maintenance', 56, 3],
      ['maintenance', 42, 0],
    ])
  })

  it('还没有历史时直接替换间隔，不生成空的旧阶段', () => {
    const phases = [makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 56, repeatCount: 0 })]
    const next = buildIntervalChangePhases(phases, 0, 42)

    expect(next).toHaveLength(1)
    expect(next[0].intervalDays).toBe(42)
    expect(next[0].repeatCount).toBe(0)
  })

  it('负荷阶段不允许调整', () => {
    const phases = [makePhase({ orderIdx: 0, kind: 'loading', intervalDays: 14, repeatCount: 2 })]
    expect(() => buildIntervalChangePhases(phases, 1, 42)).toThrow(/负荷阶段/)
  })

  it('非法间隔抛中文错误', () => {
    const phases = [makePhase({ orderIdx: 0, kind: 'maintenance', intervalDays: 56, repeatCount: 0 })]
    expect(() => buildIntervalChangePhases(phases, 3, 0)).toThrow(/1 到 365/)
  })
})
