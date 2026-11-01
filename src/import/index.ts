import { getDatabase } from '@/db'
import {
  injections as injectionRepo,
  medications as medicationRepo,
  regimens as regimenRepo,
  symptoms as symptomRepo,
  symptomTags as symptomTagRepo,
} from '@/db/repo'
import type { Medication, SymptomLog } from '@/types'
import type { ImportPayload } from './schema'

/**
 * 把解析好的导入数据写进数据库。
 *
 * - 注射记录必须已有用药方案；药名能匹配到已录入药物就用它，匹配不到则落到当前方案的药。
 * - 完全相同的记录（时间 + 药 / 时间 + 严重程度 + 症状）视为重复，跳过。
 * - 症状里出现的新标签会自动补进症状标签表，方便之后继续选。
 */
export interface ImportResult {
  injections: number
  symptoms: number
  skipped: number
  tags: number
}

function symptomKey(row: Pick<SymptomLog, 'loggedAt' | 'severity' | 'tags'>): string {
  return `${row.loggedAt}|${row.severity}|${[...row.tags].sort().join('|')}`
}

export async function importPayload(payload: ImportPayload): Promise<ImportResult> {
  const active = await regimenRepo.listActive()
  if (payload.injections.length > 0 && !active) {
    throw new Error('还没有用药方案：请先完成设置（病种/药物/间隔），再导入注射记录')
  }

  const db = await getDatabase()
  const allMedications = await medicationRepo.list()

  const medicationByName = new Map<string, Medication>()
  for (const medication of allMedications) {
    medicationByName.set(medication.name.trim().toLowerCase(), medication)
    if (medication.genericName) {
      medicationByName.set(medication.genericName.trim().toLowerCase(), medication)
    }
  }
  const fallbackMedication = active
    ? allMedications.find((item) => item.id === active.medicationId) ?? null
    : null
  if (payload.injections.length > 0 && !fallbackMedication) {
    throw new Error('当前方案关联的药物不存在，请先在设置里重新选择药物')
  }

  const existingInjections = active ? await injectionRepo.list(active.id) : []
  const injectionKeys = new Set(
    existingInjections.map((item) => `${item.injectedAt}|${item.medicationId}`),
  )
  const importedInjectionIds: Array<{ injectedAt: number; id: string }> = []

  const existingSymptoms = await symptomRepo.list()
  const symptomKeys = new Set(existingSymptoms.map(symptomKey))

  let importedInjections = 0
  let importedSymptoms = 0
  let skipped = 0

  await db.withTransactionAsync(async () => {
    for (const row of payload.injections) {
      const medication =
        (row.medicationName
          ? medicationByName.get(row.medicationName.trim().toLowerCase())
          : undefined) ?? fallbackMedication
      if (!medication || !active) throw new Error('找不到对应的药物，请先在设置里配置用药方案')

      const key = `${row.injectedAt}|${medication.id}`
      if (injectionKeys.has(key)) {
        skipped += 1
        continue
      }

      const created = await injectionRepo.create({
        regimenId: active.id,
        medicationId: medication.id,
        injectedAt: row.injectedAt,
        dose: row.dose,
        unit: row.unit ?? medication.unit,
        site: row.site,
        lotNumber: row.lotNumber,
        note: row.note,
      })
      injectionKeys.add(key)
      importedInjections += 1
      importedInjectionIds.push({ injectedAt: created.injectedAt, id: created.id })
    }

    for (const row of payload.symptoms) {
      const key = symptomKey(row)
      if (symptomKeys.has(key)) {
        skipped += 1
        continue
      }

      let injectionId: string | null = null
      if (row.injectionAt !== null) {
        injectionId =
          importedInjectionIds.find((item) => item.injectedAt === row.injectionAt)?.id ??
          existingInjections.find((item) => item.injectedAt === row.injectionAt)?.id ??
          null
      }

      await symptomRepo.create({
        loggedAt: row.loggedAt,
        severity: row.severity,
        painScore: row.painScore,
        tags: row.tags,
        temperature: row.temperature,
        note: row.note,
        injectionId,
      })
      symptomKeys.add(key)
      importedSymptoms += 1
    }
  })

  let tags = 0
  for (const row of payload.symptoms) {
    for (const tag of row.tags) {
      const result = await symptomTagRepo.ensure(tag)
      if (result.created) tags += 1
    }
  }

  return { injections: importedInjections, symptoms: importedSymptoms, skipped, tags }
}
