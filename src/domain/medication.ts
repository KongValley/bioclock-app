import { DRUGS_BY_KEY } from '@/data/catalog'
import type { Medication } from '@/types'

/**
 * 药物名称匹配（导入 / 合并用）。
 *
 * 用户可能写商品名（修美乐）、通用名（阿达木单抗）或自定义简写，
 * 所以别名集合 = 药名 + 通用名 + 商品名 + 目录里该药的名称。
 * 比较前统一去掉空格、全角/半角括号和常见分隔符。
 */
export function normalizeMedicationName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s（）()【】[\]·・\-—_/]/g, '')
}

export function medicationAliases(medication: Medication): string[] {
  const raw: string[] = [medication.name]
  if (medication.genericName) raw.push(medication.genericName)
  raw.push(...medication.brandNames)

  if (medication.catalogKey) {
    const drug = DRUGS_BY_KEY[medication.catalogKey]
    if (drug) {
      raw.push(drug.name, drug.genericName, ...drug.brandNames)
    }
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    const key = normalizeMedicationName(item)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

/** 先精确匹配药名，再按别名匹配；内置药优先于同名自定义药。 */
export function findMedicationByName(
  medications: Medication[],
  name: string,
): Medication | undefined {
  const key = normalizeMedicationName(name)
  if (key === '') return undefined

  const exact = medications.find(
    (medication) => normalizeMedicationName(medication.name) === key,
  )
  if (exact) return exact

  const matches = medications.filter((medication) =>
    medicationAliases(medication).includes(key),
  )
  if (matches.length <= 1) return matches[0]
  return [...matches].sort((a, b) => Number(b.isBuiltin) - Number(a.isBuiltin))[0]
}
