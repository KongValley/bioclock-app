import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'

import { CATALOG_DRUGS, diseaseIdsForDrug } from '@/data/catalog'
import { DEFAULT_SYMPTOM_TAGS } from '@/i18n/zh'

/**
 * 把 `src/data/catalog.ts` 的药品目录播种到 medication 表。
 *
 * 幂等策略：
 * 1. 优先用 `catalog_key` 精确匹配；
 * 2. 兼容 v1 数据库里没有 catalog_key 的 5 条内置药，按 `generic_name` 认领并补齐字段。
 *
 * 目录里新增的药品会在下次启动时自动补入，不会影响用户已有的自定义药。
 */
export async function seedBuiltinMedications(db: SQLiteDatabase): Promise<void> {
  const now = Date.now()

  for (const drug of CATALOG_DRUGS) {
    const diseaseIds = diseaseIdsForDrug(drug.key)
    const diseaseIdsJson = JSON.stringify(diseaseIds)

    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM medication
        WHERE is_builtin = 1
          AND (catalog_key = ? OR (catalog_key IS NULL AND generic_name = ?))
        LIMIT 1`,
      drug.key,
      drug.genericName,
    )

    if (existing) {
      // 名称、商品名、目录字段跟随目录更新；默认剂量保留用户改过的值。
      await db.runAsync(
        `UPDATE medication
            SET name = ?, generic_name = ?, brand_names = ?, unit = ?, color = ?,
                route = ?, disease_ids = ?, catalog_key = ?, is_builtin = 1
          WHERE id = ?`,
        drug.name,
        drug.genericName,
        JSON.stringify(drug.brandNames),
        drug.unit,
        drug.color,
        drug.route,
        diseaseIdsJson,
        drug.key,
        existing.id,
      )
      continue
    }

    await db.runAsync(
      `INSERT INTO medication
        (id, name, generic_name, brand_names, default_dose, unit, color, route,
         disease_ids, catalog_key, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      Crypto.randomUUID(),
      drug.name,
      drug.genericName,
      JSON.stringify(drug.brandNames),
      drug.defaultDose,
      drug.unit,
      drug.color,
      drug.route,
      diseaseIdsJson,
      drug.key,
      now,
    )
  }
}

/**
 * 症状标签只需要播种一次。
 * 用 app_setting 里的标记位记录「已经播过」，这样用户把默认标签全部删掉后
 * 下次启动也不会被重新加回来。
 */
export async function seedBuiltinSymptomTags(db: SQLiteDatabase): Promise<void> {
  const seeded = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_setting WHERE key = 'symptom_tags_seeded'",
  )
  if (seeded) return

  const now = Date.now()
  let order = 0
  for (const name of DEFAULT_SYMPTOM_TAGS) {
    // 旧库可能已有同名标签但没有标记位：OR IGNORE 保证不会因 UNIQUE(name) 卡死启动。
    await db.runAsync(
      `INSERT OR IGNORE INTO symptom_tag (id, name, is_builtin, sort_order, created_at)
       VALUES (?, ?, 1, ?, ?)`,
      Crypto.randomUUID(),
      name,
      order,
      now,
    )
    order += 1
  }

  await db.runAsync(
    "INSERT OR REPLACE INTO app_setting (key, value) VALUES ('symptom_tags_seeded', '1')",
  )
}
