import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * 建库 / 升级的集成测试。
 *
 * 用 Node 内置 sqlite 真跑一遍 SQL（不 mock），验证：
 * - 全新库建出 v7 结构；
 * - v1–v4 老库打开后被重建为 v7（旧表消失、新表存在且列正确）；
 * - v5 老库走增量迁移，治疗、打卡、症状与设置都保留；
 * - v6 老库补 effective_from；
 * - 清库 SQL 在旧库和新库上都能执行。
 *
 * index.ts 依赖 expo-sqlite，不能直接 import，所以这里复刻它用到的纯 SQL：
 * `buildMigrationSql` 的逻辑 = CREATE_TABLES_SQL（全新）、MIGRATION_6_SQL + MIGRATION_7_SQL（v5）、
 * MIGRATION_7_SQL（v6）或 DROP_ALL_TABLES_SQL + CREATE_TABLES_SQL（低于 v5）。
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

const DatabaseSync = loadSqlite()

function loadSqlite(): (new (path: string) => SqliteDatabase) | null {
  try {
    const mod = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }
    return mod.DatabaseSync
  } catch {
    return null
  }
}

// schema.ts 只导出纯字符串常量，可以被 node 直接跑，不需要 React Native 运行时。
async function loadSchema(): Promise<{
  CREATE_TABLES_SQL: string
  DELETE_ALL_BUSINESS_DATA_SQL: string
  DROP_ALL_TABLES_SQL: string
  MIGRATION_6_SQL: string
  MIGRATION_7_SQL: string
  SCHEMA_VERSION: number
  buildV6RepairSql: (options: { hasEndedAt: boolean; hasEfficacyTable: boolean }) => string
  buildV7RepairSql: (options: { hasEffectiveFrom: boolean }) => string
}> {
  return (await import('../../db/schema')) as {
    CREATE_TABLES_SQL: string
    DELETE_ALL_BUSINESS_DATA_SQL: string
    DROP_ALL_TABLES_SQL: string
    MIGRATION_6_SQL: string
    MIGRATION_7_SQL: string
    SCHEMA_VERSION: number
    buildV6RepairSql: (options: { hasEndedAt: boolean; hasEfficacyTable: boolean }) => string
    buildV7RepairSql: (options: { hasEffectiveFrom: boolean }) => string
  }
}

const tempDirs: string[] = []
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bioclock-db-'))
  tempDirs.push(dir)
  return join(dir, 'bioclock.db')
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上偶发 EPERM（文件句柄尚未释放），不影响测试结果
    }
  }
})

function tableNames(db: SqliteDatabase): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function columnNames(db: SqliteDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  )
}

function indexNames(db: SqliteDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  )
}

function userVersion(db: SqliteDatabase): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/** v4 的库结构（含旧的 regimen / regimen_phase / injection / reminder_rule）。 */
const V4_SCHEMA_SQL = `
CREATE TABLE medication (
  id           TEXT    PRIMARY KEY NOT NULL,
  name         TEXT    NOT NULL,
  generic_name TEXT,
  default_dose REAL,
  unit         TEXT    NOT NULL,
  color        TEXT    NOT NULL,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  route        TEXT    NOT NULL DEFAULT 'sc' CHECK (route IN ('sc', 'iv')),
  disease_ids  TEXT    NOT NULL DEFAULT '[]',
  catalog_key  TEXT,
  brand_names  TEXT    NOT NULL DEFAULT '[]',
  extra        TEXT    NOT NULL DEFAULT '{}'
);

CREATE TABLE regimen (
  id            TEXT    PRIMARY KEY NOT NULL,
  medication_id TEXT    NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  anchor        TEXT    NOT NULL DEFAULT 'actual',
  window_days   INTEGER NOT NULL DEFAULT 2,
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE regimen_phase (
  id            TEXT    PRIMARY KEY NOT NULL,
  regimen_id    TEXT    NOT NULL REFERENCES regimen(id) ON DELETE CASCADE,
  order_idx     INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  interval_days INTEGER NOT NULL,
  repeat_count  INTEGER NOT NULL DEFAULT 0,
  dose          REAL,
  unit          TEXT    NOT NULL
);

CREATE TABLE injection (
  id            TEXT    PRIMARY KEY NOT NULL,
  regimen_id    TEXT    NOT NULL REFERENCES regimen(id) ON DELETE CASCADE,
  medication_id TEXT    NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
  injected_at   INTEGER NOT NULL,
  dose          REAL,
  unit          TEXT    NOT NULL,
  site          TEXT    NOT NULL,
  lot_number    TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE symptom_log (
  id           TEXT    PRIMARY KEY NOT NULL,
  logged_at    INTEGER NOT NULL,
  severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  pain_score   REAL,
  tags         TEXT    NOT NULL DEFAULT '[]',
  note         TEXT,
  temperature  REAL,
  injection_id TEXT REFERENCES injection(id) ON DELETE SET NULL
);

CREATE TABLE symptom_tag (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL UNIQUE,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE reminder_rule (
  id             TEXT    PRIMARY KEY NOT NULL,
  regimen_id     TEXT    NOT NULL UNIQUE REFERENCES regimen(id) ON DELETE CASCADE,
  offsets        TEXT    NOT NULL DEFAULT '[-2,-1,0]',
  time_of_day    TEXT    NOT NULL DEFAULT '09:00',
  snooze_minutes INTEGER NOT NULL DEFAULT 10,
  enabled        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE app_setting (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE INDEX idx_injection_regimen_time ON injection (regimen_id, injected_at);
`

const OLD_TABLES = ['regimen', 'regimen_phase', 'injection']

describe.skipIf(!DatabaseSync)('数据库建表与升级（v7）', () => {
  it('SCHEMA_VERSION 是 7', async () => {
    const schema = await loadSchema()
    expect(schema.SCHEMA_VERSION).toBe(7)
  })

  it('全新库只执行 CREATE_TABLES_SQL，建出 v7 表结构', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())

    // 复刻 index.ts 里 version === 0 的分支
    db.exec(schema.CREATE_TABLES_SQL)
    db.exec(`PRAGMA user_version = ${schema.SCHEMA_VERSION}`)

    expect(userVersion(db)).toBe(7)

    const tables = tableNames(db)
    for (const table of [
      'medication',
      'treatment',
      'treatment_line',
      'treatment_phase',
      'efficacy_event',
      'dose_log',
      'reminder_rule',
      'symptom_log',
      'symptom_tag',
      'app_setting',
    ]) {
      expect(tables).toContain(table)
    }
    for (const table of OLD_TABLES) {
      expect(tables).not.toContain(table)
    }

    // medication 保留 v4 的全部列
    expect(columnNames(db, 'medication')).toEqual(
      expect.arrayContaining([
        'brand_names',
        'extra',
        'route',
        'disease_ids',
        'catalog_key',
      ]),
    )

    expect(columnNames(db, 'treatment')).toEqual(
      expect.arrayContaining(['id', 'name', 'is_active', 'created_at']),
    )

    expect(columnNames(db, 'treatment_line')).toEqual(
      expect.arrayContaining([
        'id',
        'treatment_id',
        'medication_id',
        'kind',
        'label',
        'is_host',
        'sync_with_host',
        'anchor',
        'window_days',
        'ended_at',
        'oral_start',
        'oral_duration_days',
        'oral_frequency',
        'oral_times_per_period',
        'oral_days_of_week',
        'oral_remind_time',
      ]),
    )

    expect(columnNames(db, 'treatment_phase')).toEqual(
      expect.arrayContaining([
        'id',
        'line_id',
        'order_idx',
        'kind',
        'interval_days',
        'repeat_count',
        'dose',
        'unit',
        'effective_from',
      ]),
    )

    expect(columnNames(db, 'efficacy_event')).toEqual(
      expect.arrayContaining([
        'id',
        'line_id',
        'kind',
        'occurred_at',
        'doses_count',
        'note',
        'created_at',
      ]),
    )

    expect(columnNames(db, 'dose_log')).toEqual(
      expect.arrayContaining([
        'id',
        'line_id',
        'scheduled_at',
        'taken_at',
        'status',
        'dose',
        'unit',
        'site',
        'lot_number',
        'note',
        'created_at',
        'updated_at',
      ]),
    )

    expect(columnNames(db, 'reminder_rule')).toEqual(
      expect.arrayContaining([
        'id',
        'treatment_id',
        'offsets',
        'time_of_day',
        'snooze_minutes',
        'enabled',
      ]),
    )
    expect(columnNames(db, 'reminder_rule')).not.toContain('regimen_id')

    expect(indexNames(db, 'dose_log')).toContain('idx_dose_log_line_time')
    expect(indexNames(db, 'treatment_line')).toContain('idx_treatment_line_treatment')
    expect(indexNames(db, 'treatment_phase')).toContain('idx_treatment_phase_order')

    db.close()
  })

  it('medication.route 允许 oral，且不再受 CHECK 约束限制', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())
    db.exec(schema.CREATE_TABLES_SQL)

    db.prepare(
      `INSERT INTO medication (id, name, unit, color, route, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('m1', '柳氮磺吡啶', 'mg', '#2B6CB0', 'oral', 1)

    const row = db.prepare('SELECT route FROM medication WHERE id = ?').get('m1') as {
      route: string
    }
    expect(row.route).toBe('oral')

    db.close()
  })

  it('dose_log.status / treatment_line.kind / oral_frequency 有取值约束', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())
    db.exec(schema.CREATE_TABLES_SQL)

    db.prepare(
      `INSERT INTO medication (id, name, unit, color, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('m1', '阿达木单抗', 'mg', '#2B6CB0', 1)
    db.prepare(`INSERT INTO treatment (id, name, created_at) VALUES (?, ?, ?)`).run(
      't1',
      '组合方案',
      1,
    )
    db.prepare(
      `INSERT INTO treatment_line (id, treatment_id, medication_id, kind, label)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('l1', 't1', 'm1', 'injection', '阿达木单抗')

    expect(() =>
      db
        .prepare(
          `INSERT INTO treatment_line (id, treatment_id, medication_id, kind, label)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('l2', 't1', 'm1', 'infusion', '非法'),
    ).toThrow()

    expect(() =>
      db
        .prepare(
          `INSERT INTO treatment_line (id, treatment_id, medication_id, kind, label, oral_frequency)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('l3', 't1', 'm1', 'oral', '口服', 'everyday'),
    ).toThrow()

    db.prepare(
      `INSERT INTO dose_log (id, line_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('d1', 'l1', 'done', 1, 1)
    expect(() =>
      db
        .prepare(
          `INSERT INTO dose_log (id, line_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('d2', 'l1', 'late', 1, 1),
    ).toThrow()

    db.close()
  })

  it('v4 老库打开后被重建为 v7：旧表消失、新表存在、user_version = 7', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())

    db.exec(V4_SCHEMA_SQL)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(`PRAGMA user_version = 4`)

    // 放几条老数据，确认重建时会被丢弃
    db.prepare(
      `INSERT INTO medication (id, name, unit, color, is_builtin, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run('m1', '阿达木单抗', 'mg', '#2B6CB0', 1)
    db.prepare(
      `INSERT INTO regimen (id, medication_id, name, anchor, window_days, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run('r1', 'm1', '维持方案', 'actual', 2, 1)
    db.prepare(
      `INSERT INTO regimen_phase (id, regimen_id, order_idx, kind, interval_days, repeat_count, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('p1', 'r1', 0, 'maintenance', 14, 0, 'mg')
    db.prepare(
      `INSERT INTO injection
        (id, regimen_id, medication_id, injected_at, unit, site, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('i1', 'r1', 'm1', 1000, 'mg', 'abdomen_ul', 1, 1)

    // 复刻 index.ts 的 migrate(fromVersion = 4)：先 DROP 全部，再按最新结构建表
    db.exec(schema.DROP_ALL_TABLES_SQL)
    db.exec(schema.CREATE_TABLES_SQL)
    db.exec(`PRAGMA user_version = ${schema.SCHEMA_VERSION}`)

    expect(userVersion(db)).toBe(7)

    const tables = tableNames(db)
    for (const table of OLD_TABLES) {
      expect(tables).not.toContain(table)
    }
    for (const table of [
      'medication',
      'treatment',
      'treatment_line',
      'treatment_phase',
      'efficacy_event',
      'dose_log',
      'reminder_rule',
      'symptom_log',
      'symptom_tag',
      'app_setting',
    ]) {
      expect(tables).toContain(table)
    }

    // 新结构必须完整：symptom_log 关联到 dose_log，reminder_rule 关联到 treatment
    expect(columnNames(db, 'symptom_log')).toContain('dose_log_id')
    expect(columnNames(db, 'symptom_log')).not.toContain('injection_id')
    expect(columnNames(db, 'reminder_rule')).toContain('treatment_id')

    // 老数据不迁移：重建后是空库（播种由 seed.ts 负责）
    const count = db.prepare('SELECT COUNT(*) AS n FROM medication').get() as { n: number }
    expect(count.n).toBe(0)

    // 重建后能正常写入新模型（外键、唯一约束都生效）
    db.prepare(
      `INSERT INTO medication (id, name, unit, color, route, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('m2', '司库奇尤单抗', 'mg', '#2B6CB0', 'sc', 1)
    db.prepare(`INSERT INTO treatment (id, name, is_active, created_at) VALUES (?, ?, 1, ?)`).run(
      't1',
      '组合方案',
      1,
    )
    db.prepare(
      `INSERT INTO treatment_line
        (id, treatment_id, medication_id, kind, label, is_host, sync_with_host, anchor)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
    ).run('l1', 't1', 'm2', 'injection', '司库奇尤单抗', 'actual')
    db.prepare(
      `INSERT INTO treatment_phase
        (id, line_id, order_idx, kind, interval_days, repeat_count, dose, unit)
       VALUES (?, ?, 0, 'loading', 7, 4, 300, 'mg')`,
    ).run('ph1', 'l1')
    db.prepare(
      `INSERT INTO reminder_rule (id, treatment_id, offsets, time_of_day)
       VALUES (?, ?, ?, ?)`,
    ).run('rr1', 't1', '[-2,-1,0]', '09:00')

    expect(() =>
      db
        .prepare(
          `INSERT INTO reminder_rule (id, treatment_id, offsets, time_of_day)
           VALUES (?, ?, ?, ?)`,
        )
        .run('rr2', 't1', '[0]', '09:00'),
    ).toThrow()

    const reminder = db
      .prepare('SELECT treatment_id FROM reminder_rule WHERE id = ?')
      .get('rr1') as { treatment_id: string }
    expect(reminder.treatment_id).toBe('t1')

    // 删除方案时级联清掉线、阶段、提醒
    db.prepare('DELETE FROM treatment WHERE id = ?').run('t1')
    const lines = db.prepare('SELECT COUNT(*) AS n FROM treatment_line').get() as { n: number }
    expect(lines.n).toBe(0)
    const phases = db.prepare('SELECT COUNT(*) AS n FROM treatment_phase').get() as { n: number }
    expect(phases.n).toBe(0)
    const rules = db.prepare('SELECT COUNT(*) AS n FROM reminder_rule').get() as { n: number }
    expect(rules.n).toBe(0)

    db.close()
  })

  it('v5 库走增量迁移：治疗与打卡保留，并新增 ended_at / efficacy_event', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())
    db.exec('PRAGMA foreign_keys = ON')

    // 用最新结构建库，再退回 v5 的样子（去掉 v6/v7 新增的列与表）
    db.exec(schema.CREATE_TABLES_SQL)
    db.exec('DROP TABLE efficacy_event')
    db.exec('ALTER TABLE treatment_line DROP COLUMN ended_at')
    db.exec('ALTER TABLE treatment_phase DROP COLUMN effective_from')
    db.exec('PRAGMA user_version = 5')

    db.prepare(
      `INSERT INTO medication (id, name, unit, color, route, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run('m1', '阿达木单抗', 'mg', '#2B6CB0', 'sc', 1)
    db.prepare(`INSERT INTO treatment (id, name, is_active, created_at) VALUES (?, ?, 1, ?)`).run(
      't1',
      '组合方案',
      1,
    )
    db.prepare(
      `INSERT INTO treatment_line
        (id, treatment_id, medication_id, kind, label, is_host, sync_with_host, anchor)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
    ).run('l1', 't1', 'm1', 'injection', '阿达木单抗', 'actual')
    db.prepare(
      `INSERT INTO treatment_phase
        (id, line_id, order_idx, kind, interval_days, repeat_count, dose, unit)
       VALUES (?, ?, 0, 'maintenance', 14, 0, 40, 'mg')`,
    ).run('ph1', 'l1')
    db.prepare(
      `INSERT INTO dose_log (id, line_id, scheduled_at, taken_at, status, dose, unit, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'done', 40, 'mg', ?, ?)`,
    ).run('d1', 'l1', 1000, 1000, 1000, 1000)
    db.prepare(
      `INSERT INTO symptom_log (id, logged_at, severity, tags, dose_log_id)
       VALUES (?, ?, 2, '[]', ?)`,
    ).run('s1', 2000, 'd1')
    db.prepare(`INSERT INTO app_setting (key, value) VALUES (?, ?)`).run('patient_name', 'Alice')

    expect(columnNames(db, 'treatment_line')).not.toContain('ended_at')

    // 复刻 index.ts 的 migrate(fromVersion = 5)
    db.exec(schema.MIGRATION_6_SQL)
    db.exec(schema.MIGRATION_7_SQL)
    db.exec(`PRAGMA user_version = ${schema.SCHEMA_VERSION}`)

    expect(userVersion(db)).toBe(7)
    expect(columnNames(db, 'treatment_line')).toContain('ended_at')
    expect(columnNames(db, 'treatment_phase')).toContain('effective_from')
    expect(tableNames(db)).toContain('efficacy_event')

    // 原有数据一行不少
    const treatment = db.prepare('SELECT name FROM treatment WHERE id = ?').get('t1') as {
      name: string
    }
    expect(treatment.name).toBe('组合方案')
    const line = db
      .prepare('SELECT label, ended_at FROM treatment_line WHERE id = ?')
      .get('l1') as { label: string; ended_at: number | null }
    expect(line.label).toBe('阿达木单抗')
    expect(line.ended_at).toBeNull()
    const dose = db.prepare('SELECT status FROM dose_log WHERE id = ?').get('d1') as {
      status: string
    }
    expect(dose.status).toBe('done')
    const symptom = db.prepare('SELECT dose_log_id FROM symptom_log WHERE id = ?').get('s1') as {
      dose_log_id: string | null
    }
    expect(symptom.dose_log_id).toBe('d1')
    const setting = db.prepare('SELECT value FROM app_setting WHERE key = ?').get('patient_name') as {
      value: string
    }
    expect(setting.value).toBe('Alice')

    // 新表可用，且 kind 有取值约束
    db.prepare(
      `INSERT INTO efficacy_event (id, line_id, kind, occurred_at, doses_count, created_at)
       VALUES (?, ?, 'reduced', ?, 1, ?)`,
    ).run('e1', 'l1', 3000, 3000)
    expect(() =>
      db
        .prepare(
          `INSERT INTO efficacy_event (id, line_id, kind, occurred_at, created_at)
           VALUES (?, ?, 'unknown', ?, ?)`,
        )
        .run('e2', 'l1', 3000, 3000),
    ).toThrow()

    // 删除用药线时疗效事件级联删除
    db.prepare('DELETE FROM treatment_line WHERE id = ?').run('l1')
    const events = db.prepare('SELECT COUNT(*) AS n FROM efficacy_event').get() as { n: number }
    expect(events.n).toBe(0)

    db.close()
  })

  it('user_version 已是 6 但缺列/缺表时，可以按实际结构补齐', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())
    db.exec(schema.CREATE_TABLES_SQL)
    db.exec('DROP TABLE efficacy_event')
    db.exec('ALTER TABLE treatment_line DROP COLUMN ended_at')
    db.exec('PRAGMA user_version = 6')

    expect(schema.buildV6RepairSql({ hasEndedAt: false, hasEfficacyTable: false })).toContain(
      'ADD COLUMN ended_at',
    )
    expect(schema.buildV6RepairSql({ hasEndedAt: true, hasEfficacyTable: true })).toBe('')

    db.exec(schema.buildV6RepairSql({ hasEndedAt: false, hasEfficacyTable: false }))

    expect(userVersion(db)).toBe(7)
    expect(columnNames(db, 'treatment_line')).toContain('ended_at')
    expect(tableNames(db)).toContain('efficacy_event')
    expect(indexNames(db, 'efficacy_event')).toContain('idx_efficacy_event_line_time')

    db.close()
  })

  it('user_version 已是 v7，但 treatment_phase 缺 effective_from 时可以补齐', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())
    db.exec(schema.CREATE_TABLES_SQL)
    db.exec('ALTER TABLE treatment_phase DROP COLUMN effective_from')
    db.exec('PRAGMA user_version = 7')

    expect(schema.buildV7RepairSql({ hasEffectiveFrom: false })).toContain(
      'ADD COLUMN effective_from',
    )
    expect(schema.buildV7RepairSql({ hasEffectiveFrom: true })).toBe('')

    db.exec(schema.buildV7RepairSql({ hasEffectiveFrom: false }))

    expect(userVersion(db)).toBe(7)
    expect(columnNames(db, 'treatment_phase')).toContain('effective_from')

    db.close()
  })

  it('清库 SQL 在 v7 库上可执行，并清掉全部业务数据', async () => {
    const schema = await loadSchema()
    const db = new DatabaseSync!(freshDbPath())
    db.exec(schema.CREATE_TABLES_SQL)

    db.prepare(
      `INSERT INTO medication (id, name, unit, color, route, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run('m1', '阿达木单抗', 'mg', '#2B6CB0', 'sc', 1)
    db.prepare(`INSERT INTO treatment (id, name, created_at) VALUES (?, ?, ?)`).run(
      't1',
      '方案',
      1,
    )
    db.prepare(
      `INSERT INTO treatment_line (id, treatment_id, medication_id, kind, label)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('l1', 't1', 'm1', 'injection', '阿达木单抗')
    db.prepare(
      `INSERT INTO dose_log (id, line_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('d1', 'l1', 'done', 1, 1)
    db.prepare(
      `INSERT INTO efficacy_event (id, line_id, kind, occurred_at, doses_count, created_at)
       VALUES (?, ?, 'failed', ?, 1, ?)`,
    ).run('e1', 'l1', 2, 2)

    db.exec(schema.DELETE_ALL_BUSINESS_DATA_SQL)

    for (const table of ['treatment', 'treatment_line', 'dose_log', 'efficacy_event', 'reminder_rule']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n).toBe(0)
    }
    // 内置药保留
    const meds = db.prepare('SELECT COUNT(*) AS n FROM medication').get() as { n: number }
    expect(meds.n).toBe(1)

    db.close()
  })
})
