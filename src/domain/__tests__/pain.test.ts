import { describe, expect, it } from 'vitest'
import { PAIN_MAX, PAIN_MIN, painBand } from '../pain'

describe('疼痛评分分档（NRS 0–10）', () => {
  it('0 分为无痛', () => {
    expect(painBand(0)).toBe('none')
  })

  it('1–3 分为轻度', () => {
    expect(painBand(1)).toBe('mild')
    expect(painBand(3)).toBe('mild')
  })

  it('4–6 分为中度', () => {
    expect(painBand(4)).toBe('moderate')
    expect(painBand(6)).toBe('moderate')
  })

  it('7–10 分为重度', () => {
    expect(painBand(7)).toBe('severe')
    expect(painBand(10)).toBe('severe')
  })

  it('量表范围是 0 到 10', () => {
    expect(PAIN_MIN).toBe(0)
    expect(PAIN_MAX).toBe(10)
  })
})
