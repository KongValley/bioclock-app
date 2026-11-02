import { describe, expect, it } from 'vitest'
import { buildPhasePreview, type PreviewPhase } from '../preview'

describe('引导页方案预览', () => {
  it('repeatCount 是阶段总针数，与排程口径一致', () => {
    const phases: PreviewPhase[] = [
      { kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 160, unit: 'mg' },
      { kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 80, unit: 'mg' },
      { kind: 'maintenance', intervalDays: 14, repeatCount: 0, dose: 40, unit: 'mg' },
    ]

    const preview = buildPhasePreview(phases, 5)

    expect(preview.map((item) => item.dayOffset)).toEqual([0, 14, 28, 42, 56])
    expect(preview.map((item) => item.dose)).toEqual([160, 80, 40, 40, 40])
    expect(preview.map((item) => item.kind)).toEqual([
      'loading',
      'loading',
      'maintenance',
      'maintenance',
      'maintenance',
    ])
  })

  it('0/2/6 周诱导加 8 周维持', () => {
    const phases: PreviewPhase[] = [
      { kind: 'loading', intervalDays: 14, repeatCount: 1, dose: 5, unit: 'mg/kg' },
      { kind: 'loading', intervalDays: 28, repeatCount: 1, dose: 5, unit: 'mg/kg' },
      { kind: 'maintenance', intervalDays: 56, repeatCount: 0, dose: 5, unit: 'mg/kg' },
    ]

    expect(buildPhasePreview(phases, 4).map((item) => item.dayOffset)).toEqual([
      0, 14, 42, 98,
    ])
  })

  it('空阶段和非法 max 返回空数组', () => {
    expect(buildPhasePreview([], 5)).toEqual([])
    expect(
      buildPhasePreview(
        [{ kind: 'maintenance', intervalDays: 28, repeatCount: 0, dose: null, unit: 'mg' }],
        0,
      ),
    ).toEqual([])
  })
})
