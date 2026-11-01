import * as SQLite from 'expo-sqlite'
import {
  CREATE_TABLES_SQL,
  DATABASE_NAME,
  DELETE_ALL_BUSINESS_DATA_SQL,
  DROP_ALL_TABLES_SQL,
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
  if (current < SCHEMA_VERSION) {
    await migrate(db, current)
  }

  await seedBuiltinMedications(db)
  await seedBuiltinSymptomTags(db)
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
 *   内置药与症状标签会在 openAndMigrate 里重新播种。
 */
export function buildMigrationSql(fromVersion: number): string {
  if (fromVersion === 0) {
    return `${CREATE_TABLES_SQL}\nPRAGMA user_version = ${SCHEMA_VERSION};`
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
  await db.withTransactionAsync(async () => {
    await db.execAsync(DELETE_ALL_BUSINESS_DATA_SQL)
    await seedBuiltinMedications(db)
    await seedBuiltinSymptomTags(db)
  })
}
