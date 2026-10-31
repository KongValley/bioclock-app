import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * 建库 / 迁移的集成测试。
 *
 * 这个测试是为了防止「重复加列」这类只在真实启动时才暴露的问题：
 * 用 Node 内置 sqlite 真跑一遍 SQL，不 mock。
 */

const require = createRequire(import.meta.url)

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }
  close(): void
}

function loadSqlite(): { DatabaseSync: new (path: string) => SqliteDatabase } | null {
  try {
    return require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }
  } catch {
    return null
  }
}

const sqlite = loadSqlite()

// schema.ts 只导出纯字符串常量，可以被 node 直接跑，不需要 React Native 运行时。
async function loadSchema(): Promise<{
  CREATE_TABLES_SQL: string
  MIGRATION_2_SQL: string
  MIGRATION_3_SQL: string
  SCHEMA_VERSION: number
}> {
  const mod = (await import('../../db/schema')) as {
    CREATE_TABLES_SQL: string
    MIGRATION_2_SQL: string
    MIGRATION_3_SQL: string
    SCHEMA_VERSION: number
  }
  return mod
}

const tempDirs: string[] = []
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bioclock-db-'))
  tempDirs.push(dir)
  return join(dir, 'bioclock.db')
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!sqlite)('数据库建表与迁移', () => {
  it('全新建库只执行 CREATE_TABLES_SQL，不会重复加列', async () => {
    const schema = await loadSchema()
    const DatabaseSync = sqlite!.DatabaseSync
    const db = new DatabaseSync(freshDbPath())

    // 复刻 index.ts 里 version === 0 的分支
    db.exec(schema.CREATE_TABLES_SQL)
    db.exec(`PRAGMA user_version = ${schema.SCHEMA_VERSION}`)

    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(schema.SCHEMA_VERSION)

    const columns = db.prepare('PRAGMA table_info(medication)').all() as Array<{ name: string }>
    const names = columns.map((c) => c.name)
    expect(names).toContain('route')
    expect(names).toContain('disease_ids')
    expect(names).toContain('catalog_key')

    db.close()
  })

  it('旧库（v1 结构）执行 MIGRATION_2_SQL 后具备新列，且可重复识别版本', async () => {
    const schema = await loadSchema()
    const DatabaseSync = sqlite!.DatabaseSync
    const db = new DatabaseSync(freshDbPath())

    // 构造 v1 的 medication 表（没有 route / disease_ids / catalog_key）
    db.exec(`
      CREATE TABLE medication (
        id           TEXT    PRIMARY KEY NOT NULL,
        name         TEXT    NOT NULL,
        generic_name TEXT,
        default_dose REAL,
        unit         TEXT    NOT NULL,
        color        TEXT    NOT NULL,
        is_builtin   INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
    `)
    db.exec('PRAGMA user_version = 1')

    db.exec(schema.MIGRATION_2_SQL)
    db.exec('PRAGMA user_version = 2')

    const names = (db.prepare('PRAGMA table_info(medication)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(names).toContain('route')
    expect(names).toContain('disease_ids')
    expect(names).toContain('catalog_key')

    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(2)

    // 再次执行迁移必须失败（说明它真正执行了 ALTER，而不是被跳过）
    expect(() => db.exec(schema.MIGRATION_2_SQL)).toThrow(/duplicate column name/i)

    db.close()
  })

  it('v2 库执行 MIGRATION_3_SQL 后具备疼痛评分列与症状标签表', async () => {
    const schema = await loadSchema()
    const DatabaseSync = sqlite!.DatabaseSync
    const db = new DatabaseSync(freshDbPath())

    // 构造 v2 的 symptom_log 表（没有 pain_score，也没有 symptom_tag 表）
    db.exec(`
      CREATE TABLE symptom_log (
        id           TEXT    PRIMARY KEY NOT NULL,
        logged_at    INTEGER NOT NULL,
        severity     INTEGER NOT NULL,
        tags         TEXT    NOT NULL DEFAULT '[]',
        note         TEXT,
        temperature  REAL,
        injection_id TEXT
      );
    `)
    db.exec('PRAGMA user_version = 2')

    db.exec(schema.MIGRATION_3_SQL)
    db.exec('PRAGMA user_version = 3')

    const names = (db.prepare('PRAGMA table_info(symptom_log)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(names).toContain('pain_score')

    const tagTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'symptom_tag'`)
      .get() as { name: string } | undefined
    expect(tagTable?.name).toBe('symptom_tag')

    const tagNames = (
      db.prepare('PRAGMA table_info(symptom_tag)').all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(tagNames).toEqual(
      expect.arrayContaining(['id', 'name', 'is_builtin', 'sort_order', 'created_at']),
    )

    const indexNames = (
      db.prepare('PRAGMA index_list(symptom_tag)').all() as Array<{ name: string }>
    ).map((i) => i.name)
    expect(indexNames).toContain('idx_symptom_tag_order')

    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(3)

    // 再次执行迁移必须失败（说明 ALTER 真正执行了；CREATE TABLE 是 IF NOT EXISTS）
    expect(() => db.exec(schema.MIGRATION_3_SQL)).toThrow(/duplicate column name/i)

    db.close()
  })
})
