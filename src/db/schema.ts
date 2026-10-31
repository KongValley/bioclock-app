/**
 * 手写 SQL DDL。
 * 列名统一 snake_case，仓库层负责与 src/types.ts 的 camelCase 互转。
 * 时间列一律存 UTC 毫秒（INTEGER），布尔列存 0 / 1。
 */

export const DATABASE_NAME = 'bioclock.db'

/** 当前数据库结构版本，写入 PRAGMA user_version。新增结构变更时 +1 并补充迁移。 */
export const SCHEMA_VERSION = 2

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS medication (
  id           TEXT    PRIMARY KEY NOT NULL,
  name         TEXT    NOT NULL,
  generic_name TEXT,
  default_dose REAL,
  unit         TEXT    NOT NULL,
  color        TEXT    NOT NULL,
  route        TEXT    NOT NULL DEFAULT 'sc',
  disease_ids  TEXT    NOT NULL DEFAULT '[]',
  catalog_key  TEXT,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS regimen (
  id            TEXT    PRIMARY KEY NOT NULL,
  medication_id TEXT    NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  anchor        TEXT    NOT NULL DEFAULT 'actual' CHECK (anchor IN ('actual', 'planned')),
  window_days   INTEGER NOT NULL DEFAULT 2,
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS regimen_phase (
  id            TEXT    PRIMARY KEY NOT NULL,
  regimen_id    TEXT    NOT NULL REFERENCES regimen(id) ON DELETE CASCADE,
  order_idx     INTEGER NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('loading', 'maintenance')),
  interval_days INTEGER NOT NULL,
  repeat_count  INTEGER NOT NULL DEFAULT 0,
  dose          REAL,
  unit          TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS injection (
  id            TEXT    PRIMARY KEY NOT NULL,
  regimen_id    TEXT    NOT NULL REFERENCES regimen(id) ON DELETE CASCADE,
  medication_id TEXT    NOT NULL REFERENCES medication(id) ON DELETE CASCADE,
  injected_at   INTEGER NOT NULL,
  dose          REAL,
  unit          TEXT    NOT NULL,
  site          TEXT    NOT NULL CHECK (site IN (
                  'abdomen_ul', 'abdomen_ur', 'abdomen_ll', 'abdomen_lr',
                  'thigh_l', 'thigh_r', 'arm_l', 'arm_r'
                )),
  lot_number    TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symptom_log (
  id           TEXT    PRIMARY KEY NOT NULL,
  logged_at    INTEGER NOT NULL,
  severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  tags         TEXT    NOT NULL DEFAULT '[]',
  note         TEXT,
  temperature  REAL,
  injection_id TEXT REFERENCES injection(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reminder_rule (
  id             TEXT    PRIMARY KEY NOT NULL,
  regimen_id     TEXT    NOT NULL UNIQUE REFERENCES regimen(id) ON DELETE CASCADE,
  offsets        TEXT    NOT NULL DEFAULT '[-2,-1,0]',
  time_of_day    TEXT    NOT NULL DEFAULT '09:00',
  snooze_minutes INTEGER NOT NULL DEFAULT 10,
  enabled        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_injection_regimen_time
  ON injection (regimen_id, injected_at);

CREATE INDEX IF NOT EXISTS idx_symptom_log_logged_at
  ON symptom_log (logged_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_catalog_key
  ON medication (catalog_key) WHERE catalog_key IS NOT NULL;
`

/** v1 → v2：药物增加给药途径、适用病种、目录稳定标识。 */
export const MIGRATION_2_SQL = `
ALTER TABLE medication ADD COLUMN route TEXT NOT NULL DEFAULT 'sc';
ALTER TABLE medication ADD COLUMN disease_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE medication ADD COLUMN catalog_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_catalog_key
  ON medication (catalog_key) WHERE catalog_key IS NOT NULL;
`

/** 清空业务数据时按依赖顺序删除，保留内置药。 */
export const DELETE_ALL_BUSINESS_DATA_SQL = `
DELETE FROM symptom_log;
DELETE FROM injection;
DELETE FROM reminder_rule;
DELETE FROM regimen_phase;
DELETE FROM regimen;
DELETE FROM app_setting;
DELETE FROM medication WHERE is_builtin = 0;
`

/** 仅在调试或彻底重装时使用。 */
export const DROP_ALL_TABLES_SQL = `
DROP TABLE IF EXISTS symptom_log;
DROP TABLE IF EXISTS injection;
DROP TABLE IF EXISTS reminder_rule;
DROP TABLE IF EXISTS regimen_phase;
DROP TABLE IF EXISTS regimen;
DROP TABLE IF EXISTS medication;
DROP TABLE IF EXISTS app_setting;
`
