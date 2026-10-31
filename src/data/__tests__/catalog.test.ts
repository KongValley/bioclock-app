import { describe, expect, it } from 'vitest'

import { CATALOG_DRUGS, DISEASE_DRUGS, DRUGS_BY_KEY, drugsForDisease } from '../catalog'
import { DISEASES } from '../diseases'

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
})
