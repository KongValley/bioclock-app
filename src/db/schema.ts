/**
 * 手写 SQL DDL。
 * 列名统一 snake_case，仓库层负责与 src/types.ts 的 camelCase 互转。
 * 时间列一律存 UTC 毫秒（INTEGER），布尔列存 0 / 1。
 */

export const DATABASE_NAME = 'bioclock.db'

/**
 * 当前数据库结构版本，写入 PRAGMA user_version。
 *
 * v5 是「治疗方案」模型的重建版本：弃用旧的 regimen / regimen_phase / injection，
 * 改为 treatment / treatment_line / treatment_phase / dose_log。
 * v6 加入疗效事件（efficacy_event）和用药线停用时间（treatment_line.ended_at）。
 * v7 给阶段加入生效时间（treatment_phase.effective_from），支持「从下一针起」调整间隔，
 * 并在之后补录旧记录时仍按旧间隔计算。
 * v6 之后的结构变更必须走增量迁移，不再删用户数据。
 */
export const SCHEMA_VERSION = 7

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS medication (
  id           TEXT    PRIMARY KEY NOT NULL,
  name         TEXT    NOT NULL,
  generic_name TEXT,
  brand_names  TEXT    NOT NULL DEFAULT '[]',
  default_dose REAL,
  unit         TEXT    NOT NULL,
  color        TEXT    NOT NULL,
  route        TEXT    NOT NULL DEFAULT 'sc',
  disease_ids  TEXT    NOT NULL DEFAULT '[]',
  catalog_key  TEXT,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  extra        TEXT    NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL
);

-- 治疗方案：一个组合（可以同时包含多种注射药和口服药）
CREATE TABLE IF NOT EXISTS treatment (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 治疗线：每种药一条。注射药挂 treatment_phase，口服药挂 oral_* 列。
CREATE TABLE IF NOT EXISTS treatment_line (
  id                  TEXT    PRIMARY KEY NOT NULL,
  treatment_id        TEXT    NOT NULL REFERENCES treatment(id) ON DELETE CASCADE,
  medication_id       TEXT    NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
  kind                TEXT    NOT NULL CHECK (kind IN ('injection', 'oral')),
  label               TEXT    NOT NULL,
  is_host             INTEGER NOT NULL DEFAULT 0,
  sync_with_host      INTEGER NOT NULL DEFAULT 0,
  anchor              TEXT    NOT NULL DEFAULT 'actual' CHECK (anchor IN ('actual', 'planned')),
  window_days         INTEGER NOT NULL DEFAULT 2,
  ended_at            INTEGER,
  oral_start          INTEGER,
  oral_duration_days  INTEGER,
  oral_frequency      TEXT    CHECK (oral_frequency IS NULL OR oral_frequency IN ('daily', 'weekly', 'custom')),
  oral_times_per_period INTEGER,
  oral_days_of_week   TEXT,
  oral_remind_time    TEXT
);

-- 注射线的阶段（按 order_idx 依次执行）
CREATE TABLE IF NOT EXISTS treatment_phase (
  id            TEXT    PRIMARY KEY NOT NULL,
  line_id       TEXT    NOT NULL REFERENCES treatment_line(id) ON DELETE CASCADE,
  order_idx     INTEGER NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('loading', 'maintenance')),
  interval_days INTEGER NOT NULL,
  repeat_count  INTEGER NOT NULL DEFAULT 0,
  dose          REAL,
  unit          TEXT    NOT NULL,
  effective_from INTEGER
);

-- 疗效事件：记录某条用药线疗效下降 / 失效 / 不耐受等
CREATE TABLE IF NOT EXISTS efficacy_event (
  id          TEXT    PRIMARY KEY NOT NULL,
  line_id     TEXT    NOT NULL REFERENCES treatment_line(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('reduced', 'failed', 'intolerance', 'antibody', 'other')),
  occurred_at INTEGER NOT NULL,
  doses_count INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- 打卡记录：注射与口服共用，一条计划对应一条记录
CREATE TABLE IF NOT EXISTS dose_log (
  id           TEXT    PRIMARY KEY NOT NULL,
  line_id      TEXT    NOT NULL REFERENCES treatment_line(id) ON DELETE CASCADE,
  scheduled_at INTEGER,
  taken_at     INTEGER,
  status       TEXT    NOT NULL CHECK (status IN ('done', 'skipped', 'missed')),
  dose         REAL,
  unit         TEXT,
  site         TEXT,
  lot_number   TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symptom_log (
  id           TEXT    PRIMARY KEY NOT NULL,
  logged_at    INTEGER NOT NULL,
  severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  pain_score   REAL,
  tags         TEXT    NOT NULL DEFAULT '[]',
  note         TEXT,
  temperature  REAL,
  dose_log_id  TEXT REFERENCES dose_log(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symptom_tag (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL UNIQUE,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_rule (
  id             TEXT    PRIMARY KEY NOT NULL,
  treatment_id   TEXT    NOT NULL UNIQUE REFERENCES treatment(id) ON DELETE CASCADE,
  offsets        TEXT    NOT NULL DEFAULT '[-2,-1,0]',
  time_of_day    TEXT    NOT NULL DEFAULT '09:00',
  snooze_minutes INTEGER NOT NULL DEFAULT 10,
  enabled        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_treatment_line_treatment
  ON treatment_line (treatment_id);

CREATE INDEX IF NOT EXISTS idx_treatment_phase_order
  ON treatment_phase (line_id, order_idx);

CREATE INDEX IF NOT EXISTS idx_dose_log_line_time
  ON dose_log (line_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_efficacy_event_line_time
  ON efficacy_event (line_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_symptom_log_logged_at
  ON symptom_log (logged_at);

CREATE INDEX IF NOT EXISTS idx_symptom_tag_order
  ON symptom_tag (sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_catalog_key
  ON medication (catalog_key) WHERE catalog_key IS NOT NULL;
`

/**
 * v1 → v4 的增量迁移已废弃：v5 直接重建表结构，不再提供 MIGRATION_2/3/4_SQL。
 * 打开低于 v5 的库时由 src/db/index.ts 先 DROP_ALL_TABLES_SQL、再执行 CREATE_TABLES_SQL。
 */

/**
 * v5 → v6 的增量迁移：保留已有治疗组合、打卡、症状与设置。
 * 只加列 / 加表，不删除任何用户数据。
 */
export const CREATE_EFFICACY_EVENT_SQL = `
CREATE TABLE IF NOT EXISTS efficacy_event (
  id          TEXT    PRIMARY KEY NOT NULL,
  line_id     TEXT    NOT NULL REFERENCES treatment_line(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('reduced', 'failed', 'intolerance', 'antibody', 'other')),
  occurred_at INTEGER NOT NULL,
  doses_count INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_efficacy_event_line_time
  ON efficacy_event (line_id, occurred_at);
`

export const MIGRATION_6_SQL = `
ALTER TABLE treatment_line ADD COLUMN ended_at INTEGER;

${CREATE_EFFICACY_EVENT_SQL}
`

/** v6 → v7：阶段增加生效时间，用于「从下一针起」调整间隔。 */
export const MIGRATION_7_SQL = `
ALTER TABLE treatment_phase ADD COLUMN effective_from INTEGER;
`

/**
 * 版本号已是 v7、但实际缺列/缺表时的修复 SQL。
 * 返回空字符串表示结构完整，不需要执行。
 */
export function buildV7RepairSql(options: { hasEffectiveFrom: boolean }): string {
  if (options.hasEffectiveFrom) return ''
  return `ALTER TABLE treatment_phase ADD COLUMN effective_from INTEGER;
PRAGMA user_version = ${SCHEMA_VERSION};`
}

/**
 * 版本号已是 v6、但实际缺列/缺表时的修复 SQL。
 * 返回空字符串表示结构完整，不需要执行。
 */
export function buildV6RepairSql(options: {
  hasEndedAt: boolean
  hasEfficacyTable: boolean
}): string {
  const statements: string[] = []
  if (!options.hasEndedAt) {
    statements.push('ALTER TABLE treatment_line ADD COLUMN ended_at INTEGER;')
  }
  if (!options.hasEfficacyTable) {
    statements.push(CREATE_EFFICACY_EVENT_SQL)
  }
  if (statements.length === 0) return ''
  return `${statements.join('\n')}\nPRAGMA user_version = ${SCHEMA_VERSION};`
}

/**
 * 清空业务数据时按依赖顺序删除，保留内置药。
 *
 * 只涉及 v5 结构里的表：老库在打开时已经走 DROP_ALL_TABLES_SQL 重建过，
 * 不会再残留 regimen / injection 等旧表，所以这里不需要（也不能）DELETE 它们。
 */
export const DELETE_ALL_BUSINESS_DATA_SQL = `DELETE FROM efficacy_event;
DELETE FROM symptom_log;
DELETE FROM symptom_tag;
DELETE FROM dose_log;
DELETE FROM treatment_phase;
DELETE FROM treatment_line;
DELETE FROM reminder_rule;
DELETE FROM treatment;
DELETE FROM app_setting;
DELETE FROM medication WHERE is_builtin = 0;
`

/** 仅在调试、彻底重装或 v5 重建时使用。新旧表都要删，老库才能清干净。 */
export const DROP_ALL_TABLES_SQL = `
DROP TABLE IF EXISTS efficacy_event;
DROP TABLE IF EXISTS symptom_log;
DROP TABLE IF EXISTS symptom_tag;
DROP TABLE IF EXISTS dose_log;
DROP TABLE IF EXISTS treatment_phase;
DROP TABLE IF EXISTS treatment_line;
DROP TABLE IF EXISTS reminder_rule;
DROP TABLE IF EXISTS treatment;
DROP TABLE IF EXISTS medication;
DROP TABLE IF EXISTS app_setting;
DROP TABLE IF EXISTS injection;
DROP TABLE IF EXISTS regimen_phase;
DROP TABLE IF EXISTS regimen;
`
