import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'

export interface BuiltinMedication {
  name: string
  genericName: string
  defaultDose: number
  unit: string
  color: string
}

/** 首版预置药，与 docs/contract.md 的决策一致。 */
export const BUILTIN_MEDICATIONS: BuiltinMedication[] = [
  { name: '修美乐', genericName: '阿达木单抗', defaultDose: 40, unit: 'mg', color: '#2B6CB0' },
  { name: '可善挺', genericName: '司库奇尤单抗', defaultDose: 300, unit: 'mg', color: '#2F855A' },
  { name: '拓咨', genericName: '依奇珠单抗', defaultDose: 80, unit: 'mg', color: '#6B46C1' },
  { name: '喜达诺', genericName: '乌司奴单抗', defaultDose: 90, unit: 'mg', color: '#B7791F' },
  { name: '恩利', genericName: '依那西普', defaultDose: 50, unit: 'mg', color: '#C53030' },
]

/**
 * 播种内置药。按 name + is_builtin 判重，重复调用不会插入重复行。
 */
export async function seedBuiltinMedications(db: SQLiteDatabase): Promise<void> {
  const now = Date.now()

  for (const med of BUILTIN_MEDICATIONS) {
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM medication WHERE is_builtin = 1 AND name = ? LIMIT 1',
      med.name,
    )
    if (existing) continue

    await db.runAsync(
      `INSERT INTO medication
        (id, name, generic_name, default_dose, unit, color, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      Crypto.randomUUID(),
      med.name,
      med.genericName,
      med.defaultDose,
      med.unit,
      med.color,
      now,
    )
  }
}
