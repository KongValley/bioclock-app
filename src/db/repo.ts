import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'
import type {
  AppSettings,
  Injection,
  InjectionSite,
  Medication,
  PhaseKind,
  Regimen,
  RegimenAnchor,
  RegimenPhase,
  ReminderRule,
  SymptomLog,
} from '@/types'
import { getDatabase } from './index'

/**
 * 数据仓库层。
 * - SQL 列名 snake_case，对外一律 camelCase。
 * - 时间存 UTC 毫秒 number，布尔存 0/1。
 * - 非法输入抛中文错误，不静默吞异常。
 */

// ---------------------------------------------------------------------------
// 行类型（snake_case）
// ---------------------------------------------------------------------------

interface MedicationRow {
  id: string
  name: string
  generic_name: string | null
  default_dose: number | null
  unit: string
  color: string
  is_builtin: number
  created_at: number
}

interface RegimenRow {
  id: string
  medication_id: string
  name: string
  anchor: RegimenAnchor
  window_days: number
  is_active: number
  created_at: number
}

interface RegimenPhaseRow {
  id: string
  regimen_id: string
  order_idx: number
  kind: PhaseKind
  interval_days: number
  repeat_count: number
  dose: number | null
  unit: string
}

interface InjectionRow {
  id: string
  regimen_id: string
  medication_id: string
  injected_at: number
  dose: number | null
  unit: string
  site: InjectionSite
  lot_number: string | null
  note: string | null
  created_at: number
  updated_at: number
}

interface SymptomLogRow {
  id: string
  logged_at: number
  severity: number
  tags: string
  note: string | null
  temperature: number | null
  injection_id: string | null
}

interface ReminderRuleRow {
  id: string
  regimen_id: string
  offsets: string
  time_of_day: string
  snooze_minutes: number
  enabled: number
}

// ---------------------------------------------------------------------------
// 映射
// ---------------------------------------------------------------------------

function mapMedication(row: MedicationRow): Medication {
  return {
    id: row.id,
    name: row.name,
    genericName: row.generic_name,
    defaultDose: row.default_dose,
    unit: row.unit,
    color: row.color,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
  }
}

function mapPhase(row: RegimenPhaseRow): RegimenPhase {
  return {
    id: row.id,
    regimenId: row.regimen_id,
    orderIdx: row.order_idx,
    kind: row.kind,
    intervalDays: row.interval_days,
    repeatCount: row.repeat_count,
    dose: row.dose,
    unit: row.unit,
  }
}

function mapRegimen(row: RegimenRow, phases: RegimenPhase[]): Regimen {
  return {
    id: row.id,
    medicationId: row.medication_id,
    name: row.name,
    anchor: row.anchor,
    windowDays: row.window_days,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    phases,
  }
}

function mapInjection(row: InjectionRow): Injection {
  return {
    id: row.id,
    regimenId: row.regimen_id,
    medicationId: row.medication_id,
    injectedAt: row.injected_at,
    dose: row.dose,
    unit: row.unit,
    site: row.site,
    lotNumber: row.lot_number,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
    return []
  } catch {
    return []
  }
}

function mapSymptom(row: SymptomLogRow): SymptomLog {
  return {
    id: row.id,
    loggedAt: row.logged_at,
    severity: row.severity as SymptomLog['severity'],
    tags: parseTags(row.tags),
    note: row.note,
    temperature: row.temperature,
    injectionId: row.injection_id,
  }
}

function parseOffsets(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    }
    return []
  } catch {
    return []
  }
}

function mapReminderRule(row: ReminderRuleRow): ReminderRule {
  return {
    id: row.id,
    regimenId: row.regimen_id,
    offsets: parseOffsets(row.offsets),
    timeOfDay: row.time_of_day,
    snoozeMinutes: row.snooze_minutes,
    enabled: row.enabled === 1,
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const ANCHORS: RegimenAnchor[] = ['actual', 'planned']
const PHASE_KINDS: PhaseKind[] = ['loading', 'maintenance']
const INJECTION_SITES: InjectionSite[] = [
  'abdomen_ul',
  'abdomen_ur',
  'abdomen_ll',
  'abdomen_lr',
  'thigh_l',
  'thigh_r',
  'arm_l',
  'arm_r',
]

function fail(message: string): never {
  throw new Error(message)
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label}不能为空`)
  }
  return value.trim()
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label}必须是有效数字`)
  }
  return value
}

function requireInteger(value: unknown, label: string, min?: number): number {
  const num = requireFiniteNumber(value, label)
  if (!Number.isInteger(num)) fail(`${label}必须是整数`)
  if (min !== undefined && num < min) fail(`${label}不能小于 ${min}`)
  return num
}

function requireTimestamp(value: unknown, label: string): number {
  const num = requireFiniteNumber(value, label)
  if (num <= 0) fail(`${label}必须是有效时间戳`)
  return num
}

function requireNullableDose(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  const num = requireFiniteNumber(value, label)
  if (num < 0) fail(`${label}不能为负数`)
  return num
}

function requireSite(value: unknown): InjectionSite {
  if (typeof value !== 'string' || !INJECTION_SITES.includes(value as InjectionSite)) {
    fail('注射部位不合法')
  }
  return value as InjectionSite
}

function requireAnchor(value: unknown): RegimenAnchor {
  if (typeof value !== 'string' || !ANCHORS.includes(value as RegimenAnchor)) {
    fail('排程锚点不合法')
  }
  return value as RegimenAnchor
}

function requirePhaseKind(value: unknown): PhaseKind {
  if (typeof value !== 'string' || !PHASE_KINDS.includes(value as PhaseKind)) {
    fail('阶段类型不合法')
  }
  return value as PhaseKind
}

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// ---------------------------------------------------------------------------
// 内部查询
// ---------------------------------------------------------------------------

async function getMedicationRow(db: SQLiteDatabase, id: string): Promise<MedicationRow | null> {
  return db.getFirstAsync<MedicationRow>('SELECT * FROM medication WHERE id = ?', id)
}

async function getRegimenRow(db: SQLiteDatabase, id: string): Promise<RegimenRow | null> {
  return db.getFirstAsync<RegimenRow>('SELECT * FROM regimen WHERE id = ?', id)
}

async function getPhasesFor(db: SQLiteDatabase, regimenId: string): Promise<RegimenPhase[]> {
  const rows = await db.getAllAsync<RegimenPhaseRow>(
    'SELECT * FROM regimen_phase WHERE regimen_id = ? ORDER BY order_idx ASC',
    regimenId,
  )
  return rows.map(mapPhase)
}

async function getInjectionRow(db: SQLiteDatabase, id: string): Promise<InjectionRow | null> {
  return db.getFirstAsync<InjectionRow>('SELECT * FROM injection WHERE id = ?', id)
}

async function getSymptomRow(db: SQLiteDatabase, id: string): Promise<SymptomLogRow | null> {
  return db.getFirstAsync<SymptomLogRow>('SELECT * FROM symptom_log WHERE id = ?', id)
}

async function getReminderRowFor(
  db: SQLiteDatabase,
  regimenId: string,
): Promise<ReminderRuleRow | null> {
  return db.getFirstAsync<ReminderRuleRow>(
    'SELECT * FROM reminder_rule WHERE regimen_id = ?',
    regimenId,
  )
}

async function requireMedicationExists(db: SQLiteDatabase, id: string): Promise<MedicationRow> {
  const row = await getMedicationRow(db, id)
  if (!row) fail('所选药物不存在')
  return row
}

async function requireRegimenExists(db: SQLiteDatabase, id: string): Promise<RegimenRow> {
  const row = await getRegimenRow(db, id)
  if (!row) fail('用药方案不存在')
  return row
}

// ---------------------------------------------------------------------------
// medications
// ---------------------------------------------------------------------------

export const medications = {
  async list(): Promise<Medication[]> {
    const db = await getDatabase()
    const rows = await db.getAllAsync<MedicationRow>(
      'SELECT * FROM medication ORDER BY is_builtin DESC, created_at ASC, name ASC',
    )
    return rows.map(mapMedication)
  },

  async get(id: string): Promise<Medication | null> {
    requireNonEmptyString(id, '药物 ID')
    const db = await getDatabase()
    const row = await getMedicationRow(db, id)
    return row ? mapMedication(row) : null
  },

  async create(input: Omit<Medication, 'id' | 'createdAt'>): Promise<Medication> {
    const name = requireNonEmptyString(input?.name, '药物名称')
    const unit = requireNonEmptyString(input?.unit, '单位')
    const color = requireNonEmptyString(input?.color, '颜色')
    const defaultDose = requireNullableDose(input.defaultDose, '默认剂量')
    const genericName =
      input.genericName === null || input.genericName === undefined
        ? null
        : requireNonEmptyString(input.genericName, '通用名')

    if (typeof input.isBuiltin !== 'boolean') fail('isBuiltin 必须是布尔值')

    const db = await getDatabase()
    const row: MedicationRow = {
      id: Crypto.randomUUID(),
      name,
      generic_name: genericName,
      default_dose: defaultDose,
      unit,
      color,
      is_builtin: input.isBuiltin ? 1 : 0,
      created_at: Date.now(),
    }

    await db.runAsync(
      `INSERT INTO medication
        (id, name, generic_name, default_dose, unit, color, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.generic_name,
      row.default_dose,
      row.unit,
      row.color,
      row.is_builtin,
      row.created_at,
    )
    return mapMedication(row)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '药物 ID')
    const db = await getDatabase()
    const row = await getMedicationRow(db, id)
    if (!row) fail('药物不存在')
    if (row.is_builtin === 1) fail('内置药物不可删除')

    const used = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM regimen WHERE medication_id = ? LIMIT 1',
      id,
    )
    if (used) fail('该药物已被用药方案使用，请先删除相关方案')

    await db.runAsync('DELETE FROM medication WHERE id = ?', id)
  },
}

// ---------------------------------------------------------------------------
// regimens
// ---------------------------------------------------------------------------

async function loadRegimens(db: SQLiteDatabase, rows: RegimenRow[]): Promise<Regimen[]> {
  if (rows.length === 0) return []

  const placeholders = rows.map(() => '?').join(', ')
  const phaseRows = await db.getAllAsync<RegimenPhaseRow>(
    `SELECT * FROM regimen_phase
      WHERE regimen_id IN (${placeholders})
      ORDER BY order_idx ASC`,
    rows.map((row) => row.id),
  )

  const byRegimen = new Map<string, RegimenPhase[]>()
  for (const phase of phaseRows) {
    const list = byRegimen.get(phase.regimen_id)
    if (list) {
      list.push(mapPhase(phase))
    } else {
      byRegimen.set(phase.regimen_id, [mapPhase(phase)])
    }
  }

  return rows.map((row) => mapRegimen(row, byRegimen.get(row.id) ?? []))
}

export const regimens = {
  async list(): Promise<Regimen[]> {
    const db = await getDatabase()
    const rows = await db.getAllAsync<RegimenRow>(
      'SELECT * FROM regimen ORDER BY created_at ASC',
    )
    return loadRegimens(db, rows)
  },

  async listActive(): Promise<Regimen | null> {
    const db = await getDatabase()
    const row = await db.getFirstAsync<RegimenRow>(
      'SELECT * FROM regimen WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1',
    )
    if (!row) return null
    const phases = await getPhasesFor(db, row.id)
    return mapRegimen(row, phases)
  },

  async get(id: string): Promise<Regimen | null> {
    requireNonEmptyString(id, '用药方案 ID')
    const db = await getDatabase()
    const row = await getRegimenRow(db, id)
    if (!row) return null
    const phases = await getPhasesFor(db, row.id)
    return mapRegimen(row, phases)
  },

  async create(input: {
    medicationId: string
    name: string
    anchor: RegimenAnchor
    windowDays: number
    phases: Array<Omit<RegimenPhase, 'id' | 'regimenId'>>
  }): Promise<Regimen> {
    const medicationId = requireNonEmptyString(input?.medicationId, '药物 ID')
    const name = requireNonEmptyString(input?.name, '方案名称')
    const anchor = requireAnchor(input.anchor)
    const windowDays = requireInteger(input.windowDays, '按时窗口', 0)

    if (!Array.isArray(input.phases) || input.phases.length === 0) {
      fail('用药方案至少需要一个阶段')
    }

    const db = await getDatabase()
    await requireMedicationExists(db, medicationId)

    const regimenId = Crypto.randomUUID()
    const createdAt = Date.now()
    const phaseRows: RegimenPhaseRow[] = input.phases.map((phase) => {
      const orderIdx = requireInteger(phase.orderIdx, '阶段顺序', 0)
      const kind = requirePhaseKind(phase.kind)
      const intervalDays = requireInteger(phase.intervalDays, '间隔天数', 1)
      const repeatCount = requireInteger(phase.repeatCount, '重复次数', 0)
      const dose = requireNullableDose(phase.dose, '阶段剂量')
      const unit = requireNonEmptyString(phase.unit, '阶段单位')
      return {
        id: Crypto.randomUUID(),
        regimen_id: regimenId,
        order_idx: orderIdx,
        kind,
        interval_days: intervalDays,
        repeat_count: repeatCount,
        dose,
        unit,
      }
    })

    const seen = new Set<number>()
    for (const phase of phaseRows) {
      if (seen.has(phase.order_idx)) fail('阶段顺序不能重复')
      seen.add(phase.order_idx)
    }
    phaseRows.sort((a, b) => a.order_idx - b.order_idx)

    const row: RegimenRow = {
      id: regimenId,
      medication_id: medicationId,
      name,
      anchor,
      window_days: windowDays,
      is_active: 0,
      created_at: createdAt,
    }

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO regimen
          (id, medication_id, name, anchor, window_days, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.medication_id,
        row.name,
        row.anchor,
        row.window_days,
        row.is_active,
        row.created_at,
      )
      for (const phase of phaseRows) {
        await db.runAsync(
          `INSERT INTO regimen_phase
            (id, regimen_id, order_idx, kind, interval_days, repeat_count, dose, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          phase.id,
          phase.regimen_id,
          phase.order_idx,
          phase.kind,
          phase.interval_days,
          phase.repeat_count,
          phase.dose,
          phase.unit,
        )
      }
    })

    return mapRegimen(row, phaseRows.map(mapPhase))
  },

  async setActive(id: string, active: boolean): Promise<void> {
    requireNonEmptyString(id, '用药方案 ID')
    if (typeof active !== 'boolean') fail('激活状态必须是布尔值')
    const db = await getDatabase()
    await requireRegimenExists(db, id)

    await db.withTransactionAsync(async () => {
      if (active) {
        await db.runAsync('UPDATE regimen SET is_active = 0 WHERE id <> ?', id)
      }
      await db.runAsync('UPDATE regimen SET is_active = ? WHERE id = ?', active ? 1 : 0, id)
    })
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '用药方案 ID')
    const db = await getDatabase()
    const exists = await getRegimenRow(db, id)
    if (!exists) fail('用药方案不存在')
    await db.runAsync('DELETE FROM regimen WHERE id = ?', id)
  },
}

// ---------------------------------------------------------------------------
// injections
// ---------------------------------------------------------------------------

export const injections = {
  async list(regimenId?: string): Promise<Injection[]> {
    const db = await getDatabase()
    if (regimenId !== undefined) {
      requireNonEmptyString(regimenId, '用药方案 ID')
      const rows = await db.getAllAsync<InjectionRow>(
        'SELECT * FROM injection WHERE regimen_id = ? ORDER BY injected_at ASC, created_at ASC',
        regimenId,
      )
      return rows.map(mapInjection)
    }
    const rows = await db.getAllAsync<InjectionRow>(
      'SELECT * FROM injection ORDER BY injected_at ASC, created_at ASC',
    )
    return rows.map(mapInjection)
  },

  async create(
    input: Omit<Injection, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Injection> {
    const regimenId = requireNonEmptyString(input?.regimenId, '用药方案 ID')
    const medicationId = requireNonEmptyString(input?.medicationId, '药物 ID')
    const injectedAt = requireTimestamp(input.injectedAt, '注射时间')
    const dose = requireNullableDose(input.dose, '剂量')
    const unit = requireNonEmptyString(input.unit, '单位')
    const site = requireSite(input.site)
    const lotNumber = normalizeOptionalText(input.lotNumber)
    const note = normalizeOptionalText(input.note)

    const db = await getDatabase()
    await requireRegimenExists(db, regimenId)
    await requireMedicationExists(db, medicationId)

    const now = Date.now()
    const row: InjectionRow = {
      id: Crypto.randomUUID(),
      regimen_id: regimenId,
      medication_id: medicationId,
      injected_at: injectedAt,
      dose,
      unit,
      site,
      lot_number: lotNumber,
      note,
      created_at: now,
      updated_at: now,
    }

    await db.runAsync(
      `INSERT INTO injection
        (id, regimen_id, medication_id, injected_at, dose, unit, site,
         lot_number, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.regimen_id,
      row.medication_id,
      row.injected_at,
      row.dose,
      row.unit,
      row.site,
      row.lot_number,
      row.note,
      row.created_at,
      row.updated_at,
    )
    return mapInjection(row)
  },

  async update(
    id: string,
    patch: Partial<Omit<Injection, 'id' | 'createdAt'>>,
  ): Promise<Injection> {
    requireNonEmptyString(id, '注射记录 ID')
    const db = await getDatabase()
    const existing = await getInjectionRow(db, id)
    if (!existing) fail('注射记录不存在')

    const sets: string[] = []
    const values: Array<string | number | null> = []

    if (patch.regimenId !== undefined) {
      const regimenId = requireNonEmptyString(patch.regimenId, '用药方案 ID')
      await requireRegimenExists(db, regimenId)
      sets.push('regimen_id = ?')
      values.push(regimenId)
    }
    if (patch.medicationId !== undefined) {
      const medicationId = requireNonEmptyString(patch.medicationId, '药物 ID')
      await requireMedicationExists(db, medicationId)
      sets.push('medication_id = ?')
      values.push(medicationId)
    }
    if (patch.injectedAt !== undefined) {
      sets.push('injected_at = ?')
      values.push(requireTimestamp(patch.injectedAt, '注射时间'))
    }
    if (patch.dose !== undefined) {
      sets.push('dose = ?')
      values.push(requireNullableDose(patch.dose, '剂量'))
    }
    if (patch.unit !== undefined) {
      sets.push('unit = ?')
      values.push(requireNonEmptyString(patch.unit, '单位'))
    }
    if (patch.site !== undefined) {
      sets.push('site = ?')
      values.push(requireSite(patch.site))
    }
    if (patch.lotNumber !== undefined) {
      sets.push('lot_number = ?')
      values.push(normalizeOptionalText(patch.lotNumber))
    }
    if (patch.note !== undefined) {
      sets.push('note = ?')
      values.push(normalizeOptionalText(patch.note))
    }

    sets.push('updated_at = ?')
    values.push(Date.now())

    values.push(id)
    await db.runAsync(`UPDATE injection SET ${sets.join(', ')} WHERE id = ?`, values)

    const updated = await getInjectionRow(db, id)
    if (!updated) fail('注射记录不存在')
    return mapInjection(updated)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '注射记录 ID')
    const db = await getDatabase()
    const result = await db.runAsync('DELETE FROM injection WHERE id = ?', id)
    if (result.changes === 0) fail('注射记录不存在')
  },
}

// ---------------------------------------------------------------------------
// symptoms
// ---------------------------------------------------------------------------

export const symptoms = {
  async list(): Promise<SymptomLog[]> {
    const db = await getDatabase()
    const rows = await db.getAllAsync<SymptomLogRow>(
      'SELECT * FROM symptom_log ORDER BY logged_at ASC',
    )
    return rows.map(mapSymptom)
  },

  async create(input: Omit<SymptomLog, 'id'>): Promise<SymptomLog> {
    const loggedAt = requireTimestamp(input?.loggedAt, '记录时间')
    const severity = requireInteger(input.severity, '严重程度', 1)
    if (severity > 5) fail('严重程度必须在 1 到 5 之间')

    if (!Array.isArray(input.tags)) fail('症状标签必须是数组')
    const tags = input.tags.map((tag) => requireNonEmptyString(tag, '症状标签'))

    const note = normalizeOptionalText(input.note)
    const temperature = normalizeTemperature(input.temperature)
    const injectionId = normalizeOptionalId(input.injectionId)

    const db = await getDatabase()
    if (injectionId !== null) {
      const injection = await getInjectionRow(db, injectionId)
      if (!injection) fail('关联的注射记录不存在')
    }

    const row: SymptomLogRow = {
      id: Crypto.randomUUID(),
      logged_at: loggedAt,
      severity,
      tags: JSON.stringify(tags),
      note,
      temperature,
      injection_id: injectionId,
    }

    await db.runAsync(
      `INSERT INTO symptom_log
        (id, logged_at, severity, tags, note, temperature, injection_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.logged_at,
      row.severity,
      row.tags,
      row.note,
      row.temperature,
      row.injection_id,
    )
    return mapSymptom(row)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '症状记录 ID')
    const db = await getDatabase()
    const result = await db.runAsync('DELETE FROM symptom_log WHERE id = ?', id)
    if (result.changes === 0) fail('症状记录不存在')
  },
}

// ---------------------------------------------------------------------------
// reminder rules
// ---------------------------------------------------------------------------

export const reminderRules = {
  async getFor(regimenId: string): Promise<ReminderRule | null> {
    requireNonEmptyString(regimenId, '用药方案 ID')
    const db = await getDatabase()
    const row = await getReminderRowFor(db, regimenId)
    return row ? mapReminderRule(row) : null
  },

  async upsert(
    input: Omit<ReminderRule, 'id'> & { id?: string },
  ): Promise<ReminderRule> {
    const regimenId = requireNonEmptyString(input?.regimenId, '用药方案 ID')
    if (!Array.isArray(input.offsets) || input.offsets.length === 0) {
      fail('提醒偏移不能为空')
    }
    const offsets = input.offsets.map((offset) => requireInteger(offset, '提醒偏移'))
    if (typeof input.timeOfDay !== 'string' || !TIME_OF_DAY_RE.test(input.timeOfDay)) {
      fail('提醒时间格式必须为 HH:mm')
    }
    const snoozeMinutes = requireInteger(input.snoozeMinutes, '稍后提醒分钟数', 0)
    if (typeof input.enabled !== 'boolean') fail('提醒开关必须是布尔值')

    const db = await getDatabase()
    await requireRegimenExists(db, regimenId)

    const existing =
      (await getReminderRowFor(db, regimenId)) ??
      (input.id
        ? await db.getFirstAsync<ReminderRuleRow>(
            'SELECT * FROM reminder_rule WHERE id = ?',
            input.id,
          )
        : null)

    if (existing) {
      await db.runAsync(
        `UPDATE reminder_rule
            SET regimen_id = ?, offsets = ?, time_of_day = ?, snooze_minutes = ?, enabled = ?
          WHERE id = ?`,
        regimenId,
        JSON.stringify(offsets),
        input.timeOfDay,
        snoozeMinutes,
        input.enabled ? 1 : 0,
        existing.id,
      )
      return mapReminderRule({
        ...existing,
        regimen_id: regimenId,
        offsets: JSON.stringify(offsets),
        time_of_day: input.timeOfDay,
        snooze_minutes: snoozeMinutes,
        enabled: input.enabled ? 1 : 0,
      })
    }

    const row: ReminderRuleRow = {
      id: input.id ?? Crypto.randomUUID(),
      regimen_id: regimenId,
      offsets: JSON.stringify(offsets),
      time_of_day: input.timeOfDay,
      snooze_minutes: snoozeMinutes,
      enabled: input.enabled ? 1 : 0,
    }

    await db.runAsync(
      `INSERT INTO reminder_rule
        (id, regimen_id, offsets, time_of_day, snooze_minutes, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row.id,
      row.regimen_id,
      row.offsets,
      row.time_of_day,
      row.snooze_minutes,
      row.enabled,
    )
    return mapReminderRule(row)
  },
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export const settings = {
  async all(): Promise<AppSettings> {
    const db = await getDatabase()
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_setting',
    )
    const result: AppSettings = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  },

  async get(key: string): Promise<string | null> {
    requireNonEmptyString(key, '设置项 key')
    const db = await getDatabase()
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_setting WHERE key = ?',
      key,
    )
    return row?.value ?? null
  },

  async set(key: string, value: string): Promise<void> {
    const safeKey = requireNonEmptyString(key, '设置项 key')
    if (typeof value !== 'string') fail('设置项 value 必须是字符串')
    const db = await getDatabase()
    await db.runAsync(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      safeKey,
      value,
    )
  },
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') fail('文本字段必须是字符串')
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return requireNonEmptyString(value, '关联记录 ID')
}

function normalizeTemperature(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const temp = requireFiniteNumber(value, '体温')
  if (temp < 30 || temp > 45) fail('体温必须在 30℃ 到 45℃ 之间')
  return temp
}
