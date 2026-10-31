import { describe, expect, it } from 'vitest'
import type { Injection, InjectionSite } from '@/types'
import { ALL_SITES, SITE_LABELS, recommendSite, siteUsage } from '../rotation'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0)

let injectionSeq = 0

function makeInjection(offsetDays: number, site: InjectionSite): Injection {
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

describe('SITE_LABELS / ALL_SITES', () => {
  it('8 个位点均有中文标签且无重复', () => {
    expect(ALL_SITES).toHaveLength(8)
    expect(new Set(ALL_SITES).size).toBe(8)
    expect(SITE_LABELS.abdomen_ul).toBe('腹部左上')
    expect(SITE_LABELS.abdomen_ur).toBe('腹部右上')
    expect(SITE_LABELS.abdomen_ll).toBe('腹部左下')
    expect(SITE_LABELS.abdomen_lr).toBe('腹部右下')
    expect(SITE_LABELS.thigh_l).toBe('左大腿')
    expect(SITE_LABELS.thigh_r).toBe('右大腿')
    expect(SITE_LABELS.arm_l).toBe('左上臂')
    expect(SITE_LABELS.arm_r).toBe('右上臂')
  })
})

describe('siteUsage', () => {
  it('统计每个位点的使用次数', () => {
    const usage = siteUsage([
      makeInjection(0, 'abdomen_ul'),
      makeInjection(7, 'abdomen_ul'),
      makeInjection(14, 'thigh_r'),
    ])

    expect(usage.abdomen_ul).toBe(2)
    expect(usage.thigh_r).toBe(1)
    expect(usage.abdomen_ur).toBe(0)
    expect(Object.keys(usage)).toHaveLength(8)
  })
})

describe('recommendSite', () => {
  it('完全没有记录时返回 abdomen_ul', () => {
    expect(recommendSite([])).toBe('abdomen_ul')
  })

  it('连续两针同侧后推荐对侧', () => {
    const injections = [
      makeInjection(0, 'abdomen_ul'),
      makeInjection(14, 'abdomen_ll'),
    ]

    expect(recommendSite(injections)).toBe('abdomen_ur')
  })

  it('右侧连续注射后推荐左侧', () => {
    const injections = [
      makeInjection(0, 'abdomen_ur'),
      makeInjection(14, 'abdomen_lr'),
    ]

    expect(recommendSite(injections)).toBe('abdomen_ul')
  })

  it('结果永远合法，且不会推荐最近 2 次用过的位点', () => {
    const injections = ALL_SITES.map((site, index) => makeInjection(index * 7, site))
    const site = recommendSite(injections)
    const recent = new Set(injections.slice(-2).map((injection) => injection.site))

    expect(ALL_SITES).toContain(site)
    expect(recent.has(site)).toBe(false)
  })
})
