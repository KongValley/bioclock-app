import * as SQLite from 'expo-sqlite'
import {
  CREATE_TABLES_SQL,
  DATABASE_NAME,
  DELETE_ALL_BUSINESS_DATA_SQL,
  MIGRATION_2_SQL,
  SCHEMA_VERSION,
} from './schema'
import { seedBuiltinMedications } from './seed'

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
  return db
}

async function readUserVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  return row?.user_version ?? 0
}

async function migrate(db: SQLite.SQLiteDatabase, fromVersion: number): Promise<void> {
  let version = fromVersion

  // 全新建库：CREATE_TABLES_SQL 已包含所有最新列，
  // 直接建表并标记为最新版本，不能进入增量迁移分支（否则会重复加列）。
  if (version === 0) {
    await db.execAsync(CREATE_TABLES_SQL)
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    return
  }

  // 旧库升级：v1 -> v2，药物表补 route / disease_ids / catalog_key。
  if (version < 2) {
    await db.execAsync(MIGRATION_2_SQL)
    version = 2
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/**
 * 建表 + 幂等迁移 + 播种内置药。可重复调用。
 */
export async function initDatabase(): Promise<void> {
  await getDatabase()
}

/**
 * 清空全部业务数据，保留内置药（并确保 5 种内置药都存在）。
 */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase()
  await db.withTransactionAsync(async () => {
    await db.execAsync(DELETE_ALL_BUSINESS_DATA_SQL)
    await seedBuiltinMedications(db)
  })
}
