import { describe, expect, it } from 'vitest'

import { CATALOG_DRUGS, DISEASE_DRUGS, DRUGS_BY_KEY, drugsForDisease } from '../catalog'
import { DISEASES } from '../diseases'
import { buildInjectionPlans } from '@/domain/schedule'
import type { TreatmentLine, TreatmentPhase } from '@/types'

const T0 = Date.UTC(2026, 0, 5)
const DAY = 86_400_000

/** 按目录模板实际跑一遍排程，返回前 count 针的计划日偏移与剂量。 */
function plannedDoses(entry: (typeof DISEASE_DRUGS)[number], count = 4) {
  const phases: TreatmentPhase[] = entry.regimen.phases.map((phase, index) => ({
    ...phase,
    id: `phase-${index}`,
    lineId: 'line-template',
    orderIdx: index,
    effectiveFrom: null,
  }))
  const line: TreatmentLine = {
    id: 'line-template',
    treatmentId: 'treatment-template',
    medicationId: 'med-template',
    kind: 'injection',
    label: entry.regimen.name,
    isHost: true,
    syncWithHost: false,
    anchor: 'planned',
    windowDays: entry.regimen.windowDays,
    endedAt: null,
    phases,
    oral: null,
  }
  const plans = buildInjectionPlans({
    line,
    logs: [],
    now: T0,
    futureDoseCount: count + 2,
  }).slice(0, count)
  const base = plans[0]?.plannedAt ?? T0
  return plans.map((plan) => ({
    day: Math.round((plan.plannedAt - base) / DAY),
    dose: plan.dose,
  }))
}

/**
 * 药物目录的完整性约束。
 *
 * 背景：曾漏掉英夫利西单抗的国产商品名（安佰特、类停），用户按品牌找药时找不到。
 * 这里把「品牌名要有、病种要能对上药、方案要合法」变成可执行的断言。
 */
describe('药物目录完整性', () => {
  it('药品 key 唯一', () => {
    const keys = CATALOG_DRUGS.map((drug) => drug.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('每种药都有商品名，且同一种药内不重复', () => {
    for (const drug of CATALOG_DRUGS) {
      expect(drug.brandNames.length, `${drug.name} 缺少商品名`).toBeGreaterThan(0)
      expect(new Set(drug.brandNames).size).toBe(drug.brandNames.length)
      for (const brand of drug.brandNames) {
        expect(brand.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('英夫利西单抗收录国内已上市的原研与生物类似药', () => {
    const drug = DRUGS_BY_KEY.infliximab
    expect(drug).toBeDefined()
    expect(drug?.brandNames).toEqual(expect.arrayContaining(['类克', '类停', '安佰特', '佳佑健']))
  })

  it('阿达木单抗覆盖常见国产商品名', () => {
    expect(DRUGS_BY_KEY.adalimumab?.brandNames).toEqual(
      expect.arrayContaining(['修美乐', '格乐立', '安健宁', '苏立信', '汉达远', '君迈康']),
    )
  })

  it('依那西普与受体-抗体融合蛋白分成两个独立条目', () => {
    expect(DRUGS_BY_KEY.etanercept?.brandNames).toEqual(['恩利'])
    expect(DRUGS_BY_KEY.tnfr_fc?.brandNames).toEqual(
      expect.arrayContaining(['益赛普', '强克', '安佰诺']),
    )
    // 通用名不同，不能混在同一药品下
    expect(DRUGS_BY_KEY.etanercept?.genericName).toBe('依那西普')
    expect(DRUGS_BY_KEY.tnfr_fc?.genericName).toContain('肿瘤坏死因子受体-抗体融合蛋白')
  })

  it('病种映射引用的药与病种都必须存在', () => {
    const diseaseIds = new Set(DISEASES.map((d) => d.id))
    for (const entry of DISEASE_DRUGS) {
      expect(diseaseIds.has(entry.diseaseId), `未知病种 ${entry.diseaseId}`).toBe(true)
      expect(DRUGS_BY_KEY[entry.drugKey], `未知药品 ${entry.drugKey}`).toBeDefined()
    }
  })

  it('每个病种至少有一种可选用药', () => {
    for (const disease of DISEASES) {
      expect(drugsForDisease(disease.id).length, `${disease.name} 没有可选药`).toBeGreaterThan(0)
    }
  })

  it('方案模板合法：阶段非空、间隔为正、重复次数非负、单位一致', () => {
    for (const entry of DISEASE_DRUGS) {
      const drug = DRUGS_BY_KEY[entry.drugKey]
      const { regimen } = entry
      expect(regimen.phases.length, `${entry.diseaseId}/${entry.drugKey} 无阶段`).toBeGreaterThan(0)
      expect(regimen.windowDays).toBeGreaterThanOrEqual(0)

      for (const phase of regimen.phases) {
        expect(phase.intervalDays, '间隔必须为正').toBeGreaterThan(0)
        expect(phase.repeatCount).toBeGreaterThanOrEqual(0)
        expect(phase.unit).toBe(drug.unit)
      }

      // 无限重复阶段只能出现在最后，否则后面的阶段永远到不了
      const infiniteIdx = regimen.phases.findIndex((p) => p.repeatCount === 0)
      if (infiniteIdx >= 0) {
        expect(infiniteIdx, `${entry.diseaseId}/${entry.drugKey} 无限阶段不在末尾`).toBe(
          regimen.phases.length - 1,
        )
      }
    }
  })

  it('按体重给药的品种标记为 mg/kg 且为静脉途径', () => {
    for (const key of ['infliximab', 'tocilizumab']) {
      const drug = DRUGS_BY_KEY[key]
      expect(drug?.unit).toBe('mg/kg')
      expect(drug?.route).toBe('iv')
    }
  })

  it('0/2/6 周诱导的方案模板按第 2、4 周间隔排程', () => {
    const entries = DISEASE_DRUGS.filter((entry) =>
      /第 0、2、6 周/.test(entry.doseNote ?? ''),
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const doses = plannedDoses(entry, 4)
      expect(
        doses.map((item) => item.day),
        `${entry.diseaseId}/${entry.drugKey} 的 0/2/6 周诱导排程不对`,
      ).toEqual([0, 14, 42, 98])
    }
  })

  it('赛妥珠单抗 0/2/4 周三次负荷后才是 200mg 维持', () => {
    const entries = DISEASE_DRUGS.filter((entry) =>
      /第 0、2、4 周各 400mg/.test(entry.doseNote ?? ''),
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const doses = plannedDoses(entry, 4)
      expect(
        doses,
        `${entry.diseaseId}/${entry.drugKey} 的负荷剂量排程不对`,
      ).toEqual([
        { day: 0, dose: 400 },
        { day: 14, dose: 400 },
        { day: 28, dose: 400 },
        { day: 42, dose: 200 },
      ])
    }
  })

  it('0/4 周两次负荷后按维持间隔排程', () => {
    const cases: Array<{
      pattern: RegExp
      label: string
      expected: Array<{ day: number; dose: number }>
    }> = [
      {
        pattern: /第 0、4 周各 100mg/,
        label: '古塞奇尤单抗',
        expected: [
          { day: 0, dose: 100 },
          { day: 28, dose: 100 },
          { day: 84, dose: 100 },
          { day: 140, dose: 100 },
        ],
      },
      {
        pattern: /第 0、4 周各 150mg/,
        label: '瑞莎珠单抗',
        expected: [
          { day: 0, dose: 150 },
          { day: 28, dose: 150 },
          { day: 112, dose: 150 },
          { day: 196, dose: 150 },
        ],
      },
      {
        pattern: /第 0、4 周各一次，之后每 12 周/,
        label: '乌司奴单抗',
        expected: [
          { day: 0, dose: 45 },
          { day: 28, dose: 45 },
          { day: 112, dose: 45 },
          { day: 196, dose: 45 },
        ],
      },
    ]

    for (const item of cases) {
      const entries = DISEASE_DRUGS.filter((entry) =>
        item.pattern.test(entry.doseNote ?? ''),
      )
      expect(entries.length, `${item.label} 没有匹配的模板`).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(
          plannedDoses(entry, 4),
          `${entry.diseaseId}/${entry.drugKey} 的 0/4 周负荷排程不对`,
        ).toEqual(item.expected)
      }
    }
  })

  it('三次负荷后隔更久才进入维持', () => {
    const benralizumab = DISEASE_DRUGS.filter((entry) =>
      /前 3 次每 4 周 30mg/.test(entry.doseNote ?? ''),
    )
    expect(benralizumab.length).toBeGreaterThan(0)
    for (const entry of benralizumab) {
      expect(plannedDoses(entry, 4).map((item) => item.day)).toEqual([0, 28, 56, 112])
    }

    const risankizumab = DISEASE_DRUGS.filter((entry) =>
      /静脉 600mg 第 0、4、8 周/.test(entry.doseNote ?? ''),
    )
    expect(risankizumab.length).toBeGreaterThan(0)
    for (const entry of risankizumab) {
      expect(plannedDoses(entry, 4), '瑞莎珠单抗第 8 周仍应是 600mg 静脉').toEqual([
        { day: 0, dose: 600 },
        { day: 28, dose: 600 },
        { day: 56, dose: 600 },
        { day: 112, dose: 180 },
      ])
    }
  })

  it('每周诱导结束后再按 4 周间隔维持', () => {
    const secukinumab300 = DISEASE_DRUGS.filter((entry) =>
      /第 0–4 周每周 300mg/.test(entry.doseNote ?? ''),
    )
    expect(secukinumab300.length).toBeGreaterThan(0)
    for (const entry of secukinumab300) {
      expect(plannedDoses(entry, 6)).toEqual([
        { day: 0, dose: 300 },
        { day: 7, dose: 300 },
        { day: 14, dose: 300 },
        { day: 21, dose: 300 },
        { day: 28, dose: 300 },
        { day: 56, dose: 300 },
      ])
    }

    const secukinumab150 = DISEASE_DRUGS.filter((entry) =>
      /第 0–4 周每周 150mg/.test(entry.doseNote ?? ''),
    )
    expect(secukinumab150.length).toBeGreaterThan(0)
    for (const entry of secukinumab150) {
      expect(plannedDoses(entry, 6).map((item) => item.day)).toEqual([
        0, 7, 14, 21, 28, 56,
      ])
    }
  })

  it('戈利木单抗第 2 周后按 4 周间隔维持', () => {
    const entries = DISEASE_DRUGS.filter((entry) =>
      /第 0 周 200mg，第 2 周 100mg/.test(entry.doseNote ?? ''),
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(plannedDoses(entry, 3)).toEqual([
        { day: 0, dose: 200 },
        { day: 14, dose: 100 },
        { day: 42, dose: 50 },
      ])
    }
  })
})
