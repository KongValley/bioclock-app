import { describe, expect, it } from 'vitest'
import type { Medication } from '@/types'
import { findMedicationByName, medicationAliases, normalizeMedicationName } from '../medication'

function med(patch: Partial<Medication>): Medication {
  return {
    id: patch.id ?? 'm1',
    name: patch.name ?? '阿达木单抗',
    genericName: patch.genericName ?? '阿达木单抗',
    brandNames: patch.brandNames ?? ['修美乐', '格乐立'],
    defaultDose: patch.defaultDose ?? 40,
    unit: patch.unit ?? 'mg',
    color: '#2B6CB0',
    route: patch.route ?? 'sc',
    diseaseIds: patch.diseaseIds ?? [],
    catalogKey: patch.catalogKey ?? 'adalimumab',
    isBuiltin: patch.isBuiltin ?? true,
    extra: patch.extra ?? {},
    createdAt: 0,
  }
}

describe('药物名称匹配', () => {
  it('归一化会去掉空格、括号和分隔符', () => {
    expect(normalizeMedicationName(' 修美乐（Humira） ')).toBe('修美乐humira')
  })

  it('别名包含通用名、商品名和目录里的品名', () => {
    const aliases = medicationAliases(med({}))
    expect(aliases).toContain('阿达木单抗')
    expect(aliases).toContain('修美乐')
  })

  it('可以用商品名匹配到目录药', () => {
    const medications = [med({})]
    expect(findMedicationByName(medications, '修美乐')?.id).toBe('m1')
  })

  it('精确药名优先于别名', () => {
    const custom = med({
      id: 'm2',
      name: '修美乐',
      genericName: null,
      brandNames: [],
      catalogKey: null,
      isBuiltin: false,
    })
    const medications = [med({}), custom]
    expect(findMedicationByName(medications, '修美乐')?.id).toBe('m2')
  })

  it('匹配不到返回 undefined', () => {
    expect(findMedicationByName([med({})], '不存在的药')).toBeUndefined()
  })
})
