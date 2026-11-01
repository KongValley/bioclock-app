import * as SQLite from 'expo-sqlite'
import {
  buildV6RepairSql,
  buildV7RepairSql,
  CREATE_TABLES_SQL,
  DATABASE_NAME,
  DELETE_ALL_BUSINESS_DATA_SQL,
  DROP_ALL_TABLES_SQL,
  MIGRATION_6_SQL,
  MIGRATION_7_SQL,
  SCHEMA_VERSION,
} from './schema'
import { seedBuiltinMedications, seedBuiltinSymptomTags } from './seed'

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

/**
 * 打开数据库并完成幂等迁移。整个 App 共用一个连接。
 * 迁移失败时不缓存失败的 Promise，允许调用方重试。
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate().catch((error: unknown) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME)
  await db.execAsync('PRAGMA journal_mode = WAL')
  await db.execAsync('PRAGMA foreign_keys = ON')

  const current = await readUserVersion(db)
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `数据库版本（${current}）高于当前应用支持的版本（${SCHEMA_VERSION}），请更新 BioClock 后再试`,
    )
  }
  // 某些老版本库没写 user_version，但表已经存在：按老库处理，避免只建表、留下缺列的旧表。
  let effective = current
  if (current === 0) {
    const legacy = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('regimen', 'regimen_phase', 'injection')
        LIMIT 1`,
    )
    if (legacy) effective = 1
  }
  if (effective < SCHEMA_VERSION) {
    await migrate(db, effective)
  }
  // 防御性修复：开发期曾出现过 user_version 已写成 6、但 v6 列/表尚未建出的库。
  // 这里按实际结构补齐，不会删除任何数据；已经完整时是空操作。
  if (effective >= 5) {
    await repairV6Schema(db)
  }
  if (effective >= 6) {
    await repairV7Schema(db)
  }

  await seedBuiltinMedications(db)
  try {
    await seedBuiltinSymptomTags(db)
  } catch {
    // 标签播种失败不应阻塞打开数据库；用户仍可手工添加标签。
  }
  return db
}

async function readUserVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  return row?.user_version ?? 0
}

/**
 * 建库 / 升级的纯 SQL 部分，抽成纯函数方便在 Node 里测试。
 *
 * - 全新库（user_version = 0）：只建表，不做任何删除。
 * - v1–v4 老库：v5 换了整套方案模型（regimen → treatment），
 *   用户已确认开发阶段老数据不必保留，所以直接 DROP 全部旧表后按 CREATE_TABLES_SQL 重建。
 * - v5 库：先 MIGRATION_6_SQL，再 MIGRATION_7_SQL。
 * - v6 库：只执行 MIGRATION_7_SQL。
 */
export function buildMigrationSql(fromVersion: number): string {
  if (fromVersion === 0) {
    return `${CREATE_TABLES_SQL}\nPRAGMA user_version = ${SCHEMA_VERSION};`
  }
  if (fromVersion === 5) {
    return `${MIGRATION_6_SQL}\n${MIGRATION_7_SQL}\nPRAGMA user_version = ${SCHEMA_VERSION};`
  }
  if (fromVersion === 6) {
    return `${MIGRATION_7_SQL}\nPRAGMA user_version = ${SCHEMA_VERSION};`
  }
  return `${DROP_ALL_TABLES_SQL}\n${CREATE_TABLES_SQL}\nPRAGMA user_version = ${SCHEMA_VERSION};`
}

async function migrate(db: SQLite.SQLiteDatabase, fromVersion: number): Promise<void> {
  if (fromVersion === 0) {
    await db.execAsync(buildMigrationSql(0))
    return
  }

  await db.withTransactionAsync(async () => {
    await db.execAsync(buildMigrationSql(fromVersion))
  })
}

/**
 * 按实际表结构补齐 v6 的 `ended_at` 与 `efficacy_event`。
 *
 * 正常情况下 v5 → v6 已由 MIGRATION_6_SQL 完成；这里只处理版本号与结构不一致的库
 * （例如升级中途被打断，或开发期提前写过 user_version）。幂等，不删除数据。
 */
async function repairV6Schema(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(treatment_line)')
  if (columns.length === 0) return
  const hasEndedAt = columns.some((column) => column.name === 'ended_at')
  const efficacyTable = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'efficacy_event' LIMIT 1`,
  )
  if (hasEndedAt && efficacyTable) return

  const sql = buildV6RepairSql({
    hasEndedAt,
    hasEfficacyTable: efficacyTable !== null,
  })
  if (sql === '') return

  await db.withTransactionAsync(async () => {
    await db.execAsync(sql)
  })
}

/** 按实际结构补齐 v7 的 treatment_phase.effective_from。 */
async function repairV7Schema(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(treatment_phase)')
  if (columns.length === 0) return
  const hasEffectiveFrom = columns.some((column) => column.name === 'effective_from')
  const sql = buildV7RepairSql({ hasEffectiveFrom })
  if (sql === '') return
  await db.withTransactionAsync(async () => {
    await db.execAsync(sql)
  })
}

/**
 * 建表 + 幂等迁移 + 播种内置药。可重复调用。
 */
export async function initDatabase(): Promise<void> {
  await getDatabase()
}

/**
 * 清空全部业务数据（治疗方案、打卡、症状、提醒、设置），保留内置药并重新播种症状标签。
 */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase()
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(DELETE_ALL_BUSINESS_DATA_SQL)
    await seedBuiltinMedications(txn)
    await seedBuiltinSymptomTags(txn)
  })
}
