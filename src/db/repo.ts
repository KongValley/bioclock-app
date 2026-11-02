import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'
import type {
  AppSettings,
  DoseLog,
  DoseStatus,
  EfficacyEvent,
  EfficacyKind,
  InjectionSite,
  LineKind,
  Medication,
  MedicationRoute,
  OralFrequency,
  OralPlan,
  PhaseKind,
  RegimenAnchor,
  ReminderRuleV5,
  SymptomLog,
  SymptomTag,
  Treatment,
  TreatmentLine,
  TreatmentPhase,
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
  brand_names: string
  default_dose: number | null
  unit: string
  color: string
  route: MedicationRoute
  disease_ids: string
  catalog_key: string | null
  is_builtin: number
  extra: string
  created_at: number
}

interface TreatmentRow {
  id: string
  name: string
  is_active: number
  created_at: number
}

interface TreatmentLineRow {
  id: string
  treatment_id: string
  medication_id: string
  kind: LineKind
  label: string
  is_host: number
  sync_with_host: number
  anchor: RegimenAnchor
  window_days: number
  ended_at: number | null
  oral_start: number | null
  oral_duration_days: number | null
  oral_frequency: OralFrequency | null
  oral_times_per_period: number | null
  oral_days_of_week: string | null
  oral_remind_time: string | null
}

interface TreatmentPhaseRow {
  id: string
  line_id: string
  order_idx: number
  kind: PhaseKind
  interval_days: number
  repeat_count: number
  dose: number | null
  unit: string
  effective_from: number | null
}

interface DoseLogRow {
  id: string
  line_id: string
  scheduled_at: number | null
  taken_at: number | null
  status: DoseStatus
  dose: number | null
  unit: string | null
  site: InjectionSite | null
  lot_number: string | null
  note: string | null
  created_at: number
  updated_at: number
}

interface EfficacyEventRow {
  id: string
  line_id: string
  kind: EfficacyKind
  occurred_at: number
  doses_count: number
  note: string | null
  created_at: number
}

interface SymptomLogRow {
  id: string
  logged_at: number
  severity: number
  pain_score: number | null
  tags: string
  note: string | null
  temperature: number | null
  dose_log_id: string | null
}

interface SymptomTagRow {
  id: string
  name: string
  is_builtin: number
  sort_order: number
  created_at: number
}

interface ReminderRuleRow {
  id: string
  treatment_id: string
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
    brandNames: parseStringArray(row.brand_names),
    defaultDose: row.default_dose,
    unit: row.unit,
    color: row.color,
    route: row.route,
    diseaseIds: parseStringArray(row.disease_ids),
    catalogKey: row.catalog_key,
    isBuiltin: row.is_builtin === 1,
    extra: parseExtra(row.extra),
    createdAt: row.created_at,
  }
}

function parseExtra(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function mapTreatmentPhase(row: TreatmentPhaseRow): TreatmentPhase {
  return {
    id: row.id,
    lineId: row.line_id,
    orderIdx: row.order_idx,
    kind: row.kind,
    intervalDays: row.interval_days,
    repeatCount: row.repeat_count,
    dose: row.dose,
    unit: row.unit,
    effectiveFrom: row.effective_from ?? null,
  }
}

function mapOralPlan(row: TreatmentLineRow): OralPlan | null {
  if (row.kind !== 'oral') return null
  if (row.oral_start === null || row.oral_frequency === null) return null
  return {
    startDate: row.oral_start,
    durationDays: row.oral_duration_days,
    frequency: row.oral_frequency,
    timesPerPeriod: row.oral_times_per_period ?? 0,
    daysOfWeek: parseDaysOfWeek(row.oral_days_of_week),
    remindTime: row.oral_remind_time ?? '09:00',
  }
}

function parseDaysOfWeek(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 6,
    )
  } catch {
    return []
  }
}

function mapTreatmentLine(row: TreatmentLineRow, phases: TreatmentPhase[]): TreatmentLine {
  return {
    id: row.id,
    treatmentId: row.treatment_id,
    medicationId: row.medication_id,
    kind: row.kind,
    label: row.label,
    isHost: row.is_host === 1,
    syncWithHost: row.sync_with_host === 1,
    anchor: row.anchor,
    windowDays: row.window_days,
    endedAt: row.ended_at,
    phases,
    oral: mapOralPlan(row),
  }
}

function mapTreatment(row: TreatmentRow, lines: TreatmentLine[]): Treatment {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lines,
  }
}

function mapDoseLog(row: DoseLogRow): DoseLog {
  return {
    id: row.id,
    lineId: row.line_id,
    scheduledAt: row.scheduled_at,
    takenAt: row.taken_at,
    status: row.status,
    dose: row.dose,
    unit: row.unit ?? '',
    site: row.site,
    lotNumber: row.lot_number,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEfficacyEvent(row: EfficacyEventRow): EfficacyEvent {
  return {
    id: row.id,
    lineId: row.line_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    dosesCount: row.doses_count,
    note: row.note,
    createdAt: row.created_at,
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
    painScore: row.pain_score,
    tags: parseTags(row.tags),
    note: row.note,
    temperature: row.temperature,
    injectionId: row.dose_log_id,
  }
}

function mapSymptomTag(row: SymptomTagRow): SymptomTag {
  return {
    id: row.id,
    name: row.name,
    isBuiltin: row.is_builtin === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
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

function mapReminderRule(row: ReminderRuleRow): ReminderRuleV5 {
  return {
    id: row.id,
    treatmentId: row.treatment_id,
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
const LINE_KINDS: LineKind[] = ['injection', 'oral']
const ORAL_FREQUENCIES: OralFrequency[] = ['daily', 'weekly', 'custom']
const DOSE_STATUSES: DoseStatus[] = ['done', 'skipped', 'missed']
const MEDICATION_ROUTES: MedicationRoute[] = ['sc', 'iv', 'oral']
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

/** 停用时间只允许今天或过去，避免误填未来日期导致提醒立刻消失。 */
function normalizeEndedAt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const timestamp = requireTimestamp(value, '停用时间')
  if (timestamp > Date.now() + 24 * 60 * 60 * 1000) {
    fail('停用时间不能晚于今天')
  }
  return timestamp
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

function requireLineKind(value: unknown): LineKind {
  if (typeof value !== 'string' || !LINE_KINDS.includes(value as LineKind)) {
    fail('用药方式只能是注射或口服')
  }
  return value as LineKind
}

function requireOralFrequency(value: unknown): OralFrequency {
  if (typeof value !== 'string' || !ORAL_FREQUENCIES.includes(value as OralFrequency)) {
    fail('服药频率只能是每天、每周或自定义')
  }
  return value as OralFrequency
}

function requireDoseStatus(value: unknown): DoseStatus {
  if (typeof value !== 'string' || !DOSE_STATUSES.includes(value as DoseStatus)) {
    fail('打卡状态只能是已完成、已跳过或漏用')
  }
  return value as DoseStatus
}

function normalizeRoute(value: unknown, fallback: MedicationRoute): MedicationRoute {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'string' || !MEDICATION_ROUTES.includes(value as MedicationRoute)) {
    fail('给药途径只能是皮下、静脉或口服')
  }
  return value as MedicationRoute
}

/** 0 = 周日 … 6 = 周六，去重升序。 */
function normalizeDaysOfWeek(value: unknown): number[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) fail('服药星期必须是数组')
  const seen = new Set<number>()
  for (const item of value) {
    const day = requireInteger(item, '服药星期', 0)
    if (day > 6) fail('服药星期必须在 0 到 6 之间')
    seen.add(day)
  }
  return [...seen].sort((a, b) => a - b)
}

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function requireTimeOfDay(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TIME_OF_DAY_RE.test(value)) {
    fail(`${label}格式必须为 HH:mm`)
  }
  return value
}

// ---------------------------------------------------------------------------
// 内部查询
// ---------------------------------------------------------------------------

async function getMedicationRow(db: SQLiteDatabase, id: string): Promise<MedicationRow | null> {
  return db.getFirstAsync<MedicationRow>('SELECT * FROM medication WHERE id = ?', id)
}

async function getTreatmentRow(db: SQLiteDatabase, id: string): Promise<TreatmentRow | null> {
  return db.getFirstAsync<TreatmentRow>('SELECT * FROM treatment WHERE id = ?', id)
}

async function getTreatmentLineRow(
  db: SQLiteDatabase,
  id: string,
): Promise<TreatmentLineRow | null> {
  return db.getFirstAsync<TreatmentLineRow>('SELECT * FROM treatment_line WHERE id = ?', id)
}

async function getDoseLogRow(db: SQLiteDatabase, id: string): Promise<DoseLogRow | null> {
  return db.getFirstAsync<DoseLogRow>('SELECT * FROM dose_log WHERE id = ?', id)
}

async function getSymptomRow(db: SQLiteDatabase, id: string): Promise<SymptomLogRow | null> {
  return db.getFirstAsync<SymptomLogRow>('SELECT * FROM symptom_log WHERE id = ?', id)
}

async function getReminderRowFor(
  db: SQLiteDatabase,
  treatmentId: string,
): Promise<ReminderRuleRow | null> {
  return db.getFirstAsync<ReminderRuleRow>(
    'SELECT * FROM reminder_rule WHERE treatment_id = ?',
    treatmentId,
  )
}

async function requireMedicationExists(db: SQLiteDatabase, id: string): Promise<MedicationRow> {
  const row = await getMedicationRow(db, id)
  if (!row) fail('所选药物不存在')
  return row
}

async function requireTreatmentExists(db: SQLiteDatabase, id: string): Promise<TreatmentRow> {
  const row = await getTreatmentRow(db, id)
  if (!row) fail('治疗方案不存在')
  return row
}

async function requireTreatmentLineExists(
  db: SQLiteDatabase,
  id: string,
): Promise<TreatmentLineRow> {
  const row = await getTreatmentLineRow(db, id)
  if (!row) fail('治疗方案里的用药条目不存在')
  return row
}

/** 一次取回多条治疗方案的 line + phase，避免 N+1。 */
async function loadTreatments(db: SQLiteDatabase, rows: TreatmentRow[]): Promise<Treatment[]> {
  if (rows.length === 0) return []

  const placeholders = rows.map(() => '?').join(', ')
  const treatmentIds = rows.map((row) => row.id)
  const lineRows = await db.getAllAsync<TreatmentLineRow>(
    `SELECT * FROM treatment_line
      WHERE treatment_id IN (${placeholders})
      ORDER BY is_host DESC, rowid ASC`,
    treatmentIds,
  )

  const phasesByLine = new Map<string, TreatmentPhase[]>()
  if (lineRows.length > 0) {
    const linePlaceholders = lineRows.map(() => '?').join(', ')
    const phaseRows = await db.getAllAsync<TreatmentPhaseRow>(
      `SELECT * FROM treatment_phase
        WHERE line_id IN (${linePlaceholders})
        ORDER BY order_idx ASC`,
      lineRows.map((row) => row.id),
    )
    for (const phase of phaseRows) {
      const list = phasesByLine.get(phase.line_id)
      if (list) {
        list.push(mapTreatmentPhase(phase))
      } else {
        phasesByLine.set(phase.line_id, [mapTreatmentPhase(phase)])
      }
    }
  }

  const linesByTreatment = new Map<string, TreatmentLine[]>()
  for (const lineRow of lineRows) {
    const line = mapTreatmentLine(lineRow, phasesByLine.get(lineRow.id) ?? [])
    const list = linesByTreatment.get(lineRow.treatment_id)
    if (list) {
      list.push(line)
    } else {
      linesByTreatment.set(lineRow.treatment_id, [line])
    }
  }

  return rows.map((row) => mapTreatment(row, linesByTreatment.get(row.id) ?? []))
}

async function loadTreatment(db: SQLiteDatabase, row: TreatmentRow): Promise<Treatment> {
  const [treatment] = await loadTreatments(db, [row])
  return treatment
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

  /** 某病种可用的药（内置目录药按 disease_ids 过滤）。 */
  async listForDisease(diseaseId: string): Promise<Medication[]> {
    requireNonEmptyString(diseaseId, '病种 ID')
    const all = await medications.list()
    return all.filter(
      (med) => med.isBuiltin && med.diseaseIds.includes(diseaseId),
    )
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
    const route = normalizeRoute(input.route, 'sc')
    const diseaseIds = Array.isArray(input.diseaseIds)
      ? input.diseaseIds.filter((id) => typeof id === 'string' && id.length > 0)
      : []
    const catalogKey =
      input.catalogKey === null || input.catalogKey === undefined
        ? null
        : requireNonEmptyString(input.catalogKey, '目录标识')
    const brandNames = normalizeNames(input.brandNames, '商品名')

    if (typeof input.isBuiltin !== 'boolean') fail('isBuiltin 必须是布尔值')

    const db = await getDatabase()
    if (catalogKey !== null) {
      const duplicate = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM medication WHERE catalog_key = ? LIMIT 1',
        catalogKey,
      )
      if (duplicate) fail('目录标识已存在，不能重复创建药物')
    }
    const row: MedicationRow = {
      id: Crypto.randomUUID(),
      name,
      generic_name: genericName,
      brand_names: JSON.stringify(brandNames),
      default_dose: defaultDose,
      unit,
      color,
      route,
      disease_ids: JSON.stringify(diseaseIds),
      catalog_key: catalogKey,
      is_builtin: input.isBuiltin ? 1 : 0,
      extra: JSON.stringify(isPlainObject(input.extra) ? input.extra : {}),
      created_at: Date.now(),
    }

    await db.runAsync(
      `INSERT INTO medication
        (id, name, generic_name, brand_names, default_dose, unit, color, route,
         disease_ids, catalog_key, is_builtin, extra, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.generic_name,
      row.brand_names,
      row.default_dose,
      row.unit,
      row.color,
      row.route,
      row.disease_ids,
      row.catalog_key,
      row.is_builtin,
      row.extra,
      row.created_at,
    )
    return mapMedication(row)
  },

  /**
   * 修改药物。
   * 内置药的名称/通用名/商品名/途径由目录维护，只允许改默认剂量；
   * 自定义药可以改全部字段。
   */
  async update(
    id: string,
    patch: Partial<
      Pick<
        Medication,
        'name' | 'genericName' | 'brandNames' | 'defaultDose' | 'unit' | 'route' | 'extra'
      >
    >,
  ): Promise<Medication> {
    requireNonEmptyString(id, '药物 ID')
    const db = await getDatabase()
    const row = await getMedicationRow(db, id)
    if (!row) fail('药物不存在')

    const builtin = row.is_builtin === 1
    if (builtin) {
      const forbidden = ['name', 'genericName', 'brandNames', 'route'] as const
      if (forbidden.some((key) => patch[key] !== undefined)) {
        fail('内置药物的名称与给药途径来自目录，不能修改')
      }
    }

    const sets: string[] = []
    const values: Array<string | number | null> = []

    if (patch.name !== undefined) {
      sets.push('name = ?')
      values.push(requireNonEmptyString(patch.name, '药物名称'))
    }
    if (patch.genericName !== undefined) {
      sets.push('generic_name = ?')
      values.push(
        patch.genericName === null ? null : requireNonEmptyString(patch.genericName, '通用名'),
      )
    }
    if (patch.brandNames !== undefined) {
      sets.push('brand_names = ?')
      values.push(JSON.stringify(normalizeNames(patch.brandNames, '商品名')))
    }
    if (patch.defaultDose !== undefined) {
      sets.push('default_dose = ?')
      values.push(requireNullableDose(patch.defaultDose, '默认剂量'))
    }
    if (patch.unit !== undefined) {
      sets.push('unit = ?')
      values.push(requireNonEmptyString(patch.unit, '单位'))
    }
    if (patch.route !== undefined) {
      sets.push('route = ?')
      values.push(normalizeRoute(patch.route, 'sc'))
    }
    if (patch.extra !== undefined) {
      sets.push('extra = ?')
      values.push(JSON.stringify(isPlainObject(patch.extra) ? patch.extra : {}))
    }

    if (sets.length === 0) return mapMedication(row)

    values.push(id)
    await db.runAsync(`UPDATE medication SET ${sets.join(', ')} WHERE id = ?`, values)

    const updated = await getMedicationRow(db, id)
    if (!updated) fail('药物不存在')
    return mapMedication(updated)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '药物 ID')
    const db = await getDatabase()
    const row = await getMedicationRow(db, id)
    if (!row) fail('药物不存在')
    if (row.is_builtin === 1) fail('内置药物不可删除')

    const used = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM treatment_line WHERE medication_id = ? LIMIT 1',
      id,
    )
    if (used) fail('该药物已被治疗方案使用，请先删除相关方案')

    await db.runAsync('DELETE FROM medication WHERE id = ?', id)
  },
}

// ---------------------------------------------------------------------------
// treatments
// ---------------------------------------------------------------------------

/** 新建治疗方案时的用药条目（id 由仓库生成）。 */
export interface TreatmentLineInput {
  medicationId: string
  kind: LineKind
  label: string
  isHost?: boolean
  syncWithHost?: boolean
  anchor?: RegimenAnchor
  windowDays?: number
  /** 停用时间；新增线通常为 null，导入备份时会带上 */
  endedAt?: number | null
  /** 注射线必填，至少一个阶段 */
  phases?: Array<Omit<TreatmentPhase, 'id' | 'lineId'>>
  /** 口服线必填 */
  oral?: OralPlan | null
}

export interface TreatmentInput {
  name: string
  lines: TreatmentLineInput[]
}

interface NormalizedLine {
  row: TreatmentLineRow
  phases: TreatmentPhaseRow[]
}

function normalizeOralPlan(value: unknown): OralPlan {
  if (!isPlainObject(value)) fail('口服计划不能为空')
  const plan = value as unknown as OralPlan
  const startDate = requireTimestamp(plan.startDate, '开始服药时间')
  const durationDays =
    plan.durationDays === null || plan.durationDays === undefined
      ? null
      : requireInteger(plan.durationDays, '服药天数', 1)
  const frequency = requireOralFrequency(plan.frequency)
  let timesPerPeriod = 0
  let daysOfWeek: number[] = []
  if (frequency === 'weekly') {
    // weekly 只使用「每周 N 次」，按周均匀分布；daysOfWeek 一律清空。
    timesPerPeriod = requireInteger(plan.timesPerPeriod, '每周服药次数', 1)
    if (timesPerPeriod > 7) fail('每周服药次数不能超过 7')
  } else if (frequency === 'custom') {
    // custom 只使用固定周几，timesPerPeriod 不参与排程。
    daysOfWeek = normalizeDaysOfWeek(plan.daysOfWeek)
    if (daysOfWeek.length === 0) fail('请至少选择一天服药')
  }
  const remindTime = requireTimeOfDay(plan.remindTime, '服药提醒时间')
  return { startDate, durationDays, frequency, timesPerPeriod, daysOfWeek, remindTime }
}

function normalizePhases(
  lineId: string,
  phases: unknown,
): { phases: TreatmentPhaseRow[]; mapped: TreatmentPhase[] } {
  if (!Array.isArray(phases) || phases.length === 0) {
    fail('注射用药至少需要一个阶段')
  }
  const rows: TreatmentPhaseRow[] = phases.map((phase) => {
    const orderIdx = requireInteger(phase.orderIdx, '阶段顺序', 0)
    const kind = requirePhaseKind(phase.kind)
    const intervalDays = requireInteger(phase.intervalDays, '间隔天数', 1)
    const repeatCount = requireInteger(phase.repeatCount, '重复次数', 0)
    const dose = requireNullableDose(phase.dose, '阶段剂量')
    const unit = requireNonEmptyString(phase.unit, '阶段单位')
    const effectiveFrom =
      phase.effectiveFrom === null || phase.effectiveFrom === undefined
        ? null
        : requireTimestamp(phase.effectiveFrom, '阶段生效时间')
    return {
      id: Crypto.randomUUID(),
      line_id: lineId,
      order_idx: orderIdx,
      kind,
      interval_days: intervalDays,
      repeat_count: repeatCount,
      dose,
      unit,
      effective_from: effectiveFrom,
    }
  })

  const seen = new Set<number>()
  for (const phase of rows) {
    if (seen.has(phase.order_idx)) fail('阶段顺序不能重复')
    seen.add(phase.order_idx)
  }
  rows.sort((a, b) => a.order_idx - b.order_idx)
  return { phases: rows, mapped: rows.map(mapTreatmentPhase) }
}

function normalizeLine(treatmentId: string, input: TreatmentLineInput): NormalizedLine {
  const medicationId = requireNonEmptyString(input?.medicationId, '药物 ID')
  const kind = requireLineKind(input.kind)
  const label = requireNonEmptyString(input.label, '用药条目名称')
  const anchor = requireAnchor(input.anchor ?? 'actual')
  const windowDays = requireInteger(input.windowDays ?? 2, '按时窗口', 0)
  const isHost = normalizeBoolean(input.isHost ?? false, '主药标记')
  const syncWithHost = normalizeBoolean(input.syncWithHost ?? false, '跟随主药标记')
  if (isHost && syncWithHost) fail('主药不能同时跟随其他主药')
  if (kind === 'oral' && isHost) fail('口服用药不能设为主药')
  if (kind === 'oral' && syncWithHost) fail('口服用药不参与跟随主药')

  const lineId = Crypto.randomUUID()
  const row: TreatmentLineRow = {
    id: lineId,
    treatment_id: treatmentId,
    medication_id: medicationId,
    kind,
    label,
    is_host: isHost ? 1 : 0,
    sync_with_host: syncWithHost ? 1 : 0,
    anchor,
    window_days: windowDays,
    ended_at: normalizeEndedAt(input.endedAt),
    oral_start: null,
    oral_duration_days: null,
    oral_frequency: null,
    oral_times_per_period: null,
    oral_days_of_week: null,
    oral_remind_time: null,
  }

  if (kind === 'oral') {
    const oral = normalizeOralPlan(input.oral)
    row.oral_start = oral.startDate
    row.oral_duration_days = oral.durationDays
    row.oral_frequency = oral.frequency
    row.oral_times_per_period = oral.timesPerPeriod
    row.oral_days_of_week = JSON.stringify(oral.daysOfWeek)
    row.oral_remind_time = oral.remindTime
    return { row, phases: [] }
  }

  const { phases } = normalizePhases(lineId, input.phases)
  return { row, phases }
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}必须是布尔值`)
  return value
}

async function insertLine(db: SQLiteDatabase, line: NormalizedLine): Promise<void> {
  const row = line.row
  await db.runAsync(
    `INSERT INTO treatment_line
      (id, treatment_id, medication_id, kind, label, is_host, sync_with_host, anchor,
       window_days, ended_at, oral_start, oral_duration_days, oral_frequency, oral_times_per_period,
       oral_days_of_week, oral_remind_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.treatment_id,
    row.medication_id,
    row.kind,
    row.label,
    row.is_host,
    row.sync_with_host,
    row.anchor,
    row.window_days,
    row.ended_at,
    row.oral_start,
    row.oral_duration_days,
    row.oral_frequency,
    row.oral_times_per_period,
    row.oral_days_of_week,
    row.oral_remind_time,
  )
  for (const phase of line.phases) {
    await db.runAsync(
      `INSERT INTO treatment_phase
        (id, line_id, order_idx, kind, interval_days, repeat_count, dose, unit, effective_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      phase.id,
      phase.line_id,
      phase.order_idx,
      phase.kind,
      phase.interval_days,
      phase.repeat_count,
      phase.dose,
      phase.unit,
      phase.effective_from,
    )
  }
}

/** `update` 可以改的字段：名称，以及逐条线的配置。 */
export interface TreatmentPatch {
  name?: string
  /** 按 lineId 覆盖已有 line 的字段（phases 传给注射线时会整体替换） */
  lines?: Array<
    Partial<Omit<TreatmentLine, 'id' | 'treatmentId' | 'kind' | 'phases'>> & {
      id: string
      phases?: Array<Omit<TreatmentPhase, 'id' | 'lineId'>>
    }
  >
  /** 同一次事务里删除的用药线（级联删除打卡） */
  removeLines?: string[]
  /** 同一次事务里新增的用药线 */
  addLines?: TreatmentLineInput[]
}

interface PreparedLineUpdate {
  id: string
  sets: string[]
  values: Array<string | number | null>
  phases: TreatmentPhaseRow[] | null
  isHost: 0 | 1 | undefined
  medicationId: string | undefined
}

export const treatments = {
  async list(): Promise<Treatment[]> {
    const db = await getDatabase()
    const rows = await db.getAllAsync<TreatmentRow>(
      'SELECT * FROM treatment ORDER BY created_at ASC',
    )
    return loadTreatments(db, rows)
  },

  async getActive(): Promise<Treatment | null> {
    const db = await getDatabase()
    const row = await db.getFirstAsync<TreatmentRow>(
      'SELECT * FROM treatment WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1',
    )
    if (!row) return null
    return loadTreatment(db, row)
  },

  async get(id: string): Promise<Treatment | null> {
    requireNonEmptyString(id, '治疗方案 ID')
    const db = await getDatabase()
    const row = await getTreatmentRow(db, id)
    if (!row) return null
    return loadTreatment(db, row)
  },

  async create(input: TreatmentInput): Promise<Treatment> {
    const name = requireNonEmptyString(input?.name, '治疗方案名称')
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      fail('治疗方案至少需要一种药')
    }

    const db = await getDatabase()

    const treatmentId = Crypto.randomUUID()
    const createdAt = Date.now()

    const lineIds = new Set<string>()
    const lines: NormalizedLine[] = []
    for (const lineInput of input.lines) {
      const medicationId = requireNonEmptyString(lineInput?.medicationId, '药物 ID')
      await requireMedicationExists(db, medicationId)
      const normalized = normalizeLine(treatmentId, lineInput)
      const lineKey = `${normalized.row.kind}:${normalized.row.medication_id}`
      if (lineIds.has(lineKey)) {
        fail('同一个治疗方案里不能重复添加同一种药')
      }
      lineIds.add(lineKey)
      lines.push(normalized)
    }

    const hosts = lines.filter((line) => line.row.is_host === 1)
    if (hosts.length > 1) fail('一个治疗方案只能有一个主药')

    const row: TreatmentRow = {
      id: treatmentId,
      name,
      is_active: 0,
      created_at: createdAt,
    }

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT INTO treatment (id, name, is_active, created_at) VALUES (?, ?, ?, ?)',
        row.id,
        row.name,
        row.is_active,
        row.created_at,
      )
      for (const line of lines) {
        await insertLine(db, line)
      }
    })

    return loadTreatment(db, row)
  },

  /** 给已有治疗方案增加一条用药线（导入新药时用）。 */
  async addLine(treatmentId: string, input: TreatmentLineInput): Promise<TreatmentLine> {
    requireNonEmptyString(treatmentId, '治疗方案 ID')
    const db = await getDatabase()
    await requireTreatmentExists(db, treatmentId)

    const medicationId = requireNonEmptyString(input?.medicationId, '药物 ID')
    await requireMedicationExists(db, medicationId)
    const duplicate = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM treatment_line WHERE treatment_id = ? AND medication_id = ? AND kind = ? LIMIT 1',
      treatmentId,
      medicationId,
      input.kind,
    )
    if (duplicate) fail('同一个治疗方案里不能重复添加同一种药')

    const normalized = normalizeLine(treatmentId, input)
    if (normalized.row.is_host === 1) {
      const host = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM treatment_line WHERE treatment_id = ? AND is_host = 1 LIMIT 1',
        treatmentId,
      )
      if (host) fail('一个治疗方案只能有一个主药')
    }

    // 不在仓库层开事务：导入时会把它放进自己的事务里，避免嵌套 BEGIN。
    await insertLine(db, normalized)

    return mapTreatmentLine(normalized.row, normalized.phases.map(mapTreatmentPhase))
  },

  /** 删除一条用药线（其打卡记录会随外键级联删除）。 */
  async removeLine(lineId: string): Promise<void> {
    requireNonEmptyString(lineId, '用药线 ID')
    const db = await getDatabase()
    const row = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM treatment_line WHERE id = ? LIMIT 1',
      lineId,
    )
    if (!row) fail('用药线不存在')
    await db.runAsync('DELETE FROM treatment_line WHERE id = ?', lineId)
  },

  /** 停用 / 恢复一条用药线。endedAt 为 null 表示恢复；重复停用保留更早的时间。 */
  async setLineEnded(lineId: string, endedAt: number | null): Promise<TreatmentLine> {
    requireNonEmptyString(lineId, '用药线 ID')
    const db = await getDatabase()
    await requireTreatmentLineExists(db, lineId)
    const value = normalizeEndedAt(endedAt)
    await db.runAsync(
      `UPDATE treatment_line
        SET ended_at = CASE
          WHEN ? IS NULL THEN NULL
          WHEN ended_at IS NULL OR ended_at > ? THEN ?
          ELSE ended_at
        END
        WHERE id = ?`,
      value,
      value,
      value,
      lineId,
    )
    const updated = await db.getFirstAsync<TreatmentLineRow>(
      'SELECT * FROM treatment_line WHERE id = ?',
      lineId,
    )
    if (!updated) fail('用药线不存在')
    const phaseRows = await db.getAllAsync<TreatmentPhaseRow>(
      'SELECT * FROM treatment_phase WHERE line_id = ? ORDER BY order_idx ASC',
      lineId,
    )
    return mapTreatmentLine(updated, phaseRows.map(mapTreatmentPhase))
  },

  async setActive(id: string, active: boolean): Promise<void> {    requireNonEmptyString(id, '治疗方案 ID')
    if (typeof active !== 'boolean') fail('激活状态必须是布尔值')
    const db = await getDatabase()
    await requireTreatmentExists(db, id)

    await db.withTransactionAsync(async () => {
      if (active) {
        await db.runAsync('UPDATE treatment SET is_active = 0 WHERE id <> ?', id)
      }
      await db.runAsync('UPDATE treatment SET is_active = ? WHERE id = ?', active ? 1 : 0, id)
    })
  },

  async update(id: string, patch: TreatmentPatch): Promise<Treatment> {
    requireNonEmptyString(id, '治疗方案 ID')
    const db = await getDatabase()
    const existing = await requireTreatmentExists(db, id)

    const newName =
      patch.name !== undefined ? requireNonEmptyString(patch.name, '治疗方案名称') : null

    const linePatches = Array.isArray(patch.lines) ? patch.lines : []
    const prepared: PreparedLineUpdate[] = []
    const seenLines = new Set<string>()
    for (const linePatch of linePatches) {
      const lineId = requireNonEmptyString(linePatch?.id, '用药条目 ID')
      if (seenLines.has(lineId)) fail('同一条用药条目不能重复修改')
      seenLines.add(lineId)
      const lineRow = await requireTreatmentLineExists(db, lineId)
      if (lineRow.treatment_id !== id) fail('用药条目不属于该治疗方案')

      const sets: string[] = []
      const values: Array<string | number | null> = []
      let isHost: 0 | 1 | undefined

      let medicationId: string | undefined
      if (linePatch.medicationId !== undefined) {
        medicationId = requireNonEmptyString(linePatch.medicationId, '药物 ID')
        await requireMedicationExists(db, medicationId)
        if (medicationId !== lineRow.medication_id) {
          const logs = await db.getFirstAsync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM dose_log WHERE line_id = ?',
            lineId,
          )
          if ((logs?.n ?? 0) > 0) {
            fail('已有打卡记录的用药线不能更换药物，请新建一条用药线')
          }
        }
        sets.push('medication_id = ?')
        values.push(medicationId)
      }
      if (linePatch.label !== undefined) {
        sets.push('label = ?')
        values.push(requireNonEmptyString(linePatch.label, '用药条目名称'))
      }
      if (linePatch.anchor !== undefined) {
        sets.push('anchor = ?')
        values.push(requireAnchor(linePatch.anchor))
      }
      if (linePatch.windowDays !== undefined) {
        sets.push('window_days = ?')
        values.push(requireInteger(linePatch.windowDays, '按时窗口', 0))
      }
      if (linePatch.endedAt !== undefined) {
        const endedAt = normalizeEndedAt(linePatch.endedAt)
        if (endedAt !== null) {
          sets.push('ended_at = ?')
          values.push(endedAt)
        } else {
          sets.push('ended_at = NULL')
        }
      }
      if (linePatch.isHost !== undefined) {
        isHost = normalizeBoolean(linePatch.isHost, '主药标记') ? 1 : 0
        if (isHost === 1 && lineRow.kind === 'oral') fail('口服用药不能设为主药')
        sets.push('is_host = ?')
        values.push(isHost)
      }
      if (linePatch.syncWithHost !== undefined) {
        const sync = normalizeBoolean(linePatch.syncWithHost, '跟随主药标记')
        if (sync && (linePatch.isHost === true || (linePatch.isHost === undefined && lineRow.is_host === 1))) {
          fail('主药不能同时跟随其他主药')
        }
        if (sync && lineRow.kind === 'oral') fail('口服用药不参与跟随主药')
        sets.push('sync_with_host = ?')
        values.push(sync ? 1 : 0)
      }

      let phases: TreatmentPhaseRow[] | null = null
      if (linePatch.phases !== undefined) {
        if (lineRow.kind !== 'injection') fail('口服用药没有注射阶段')
        phases = normalizePhases(lineId, linePatch.phases).phases
      }

      if (lineRow.kind === 'oral' && linePatch.oral !== undefined) {
        const oral = normalizeOralPlan(linePatch.oral)
        sets.push(
          'oral_start = ?',
          'oral_duration_days = ?',
          'oral_frequency = ?',
          'oral_times_per_period = ?',
          'oral_days_of_week = ?',
          'oral_remind_time = ?',
        )
        values.push(
          oral.startDate,
          oral.durationDays,
          oral.frequency,
          oral.timesPerPeriod,
          JSON.stringify(oral.daysOfWeek),
          oral.remindTime,
        )
      }

      prepared.push({ id: lineId, sets, values, phases, isHost, medicationId })
    }

    // 维护「一个治疗方案只有一个主药」的不变式：允许一次保存里换主药。
    const newHosts = prepared.filter((entry) => entry.isHost === 1)
    if (newHosts.length > 1) fail('一个治疗方案只能有一个主药')

    const removeLineIds = Array.isArray(patch.removeLines) ? patch.removeLines : []
    const addLineInputs = Array.isArray(patch.addLines) ? patch.addLines : []
    const normalizedAdds: NormalizedLine[] = []
    for (const input of addLineInputs) {
      const medicationId = requireNonEmptyString(input?.medicationId, '药物 ID')
      await requireMedicationExists(db, medicationId)
      normalizedAdds.push(normalizeLine(id, input))
    }

    // 用「当前行 + 本次修改 - 删除 + 新增」做一次预检，确保同药线不重复、主药唯一。
    const currentRows = await db.getAllAsync<{
      id: string
      medication_id: string
      kind: LineKind
      is_host: number
    }>('SELECT id, medication_id, kind, is_host FROM treatment_line WHERE treatment_id = ?', id)
    const finalLines = new Map(
      currentRows.map((row) => [
        row.id,
        { medicationId: row.medication_id, kind: row.kind, isHost: row.is_host === 1 },
      ]),
    )
    for (const entry of prepared) {
      const current = finalLines.get(entry.id)
      if (!current) continue
      if (entry.medicationId !== undefined) current.medicationId = entry.medicationId
      if (entry.isHost !== undefined) current.isHost = entry.isHost === 1
    }

    const removed = new Set<string>()
    for (const removeId of removeLineIds) {
      const lineId = requireNonEmptyString(removeId, '用药线 ID')
      if (removed.has(lineId)) fail('同一条用药线不能重复删除')
      if (seenLines.has(lineId)) fail('同一条用药线不能同时修改和删除')
      const lineRow = await requireTreatmentLineExists(db, lineId)
      if (lineRow.treatment_id !== id) fail('用药线不属于该治疗方案')
      removed.add(lineId)
      finalLines.delete(lineId)
    }

    for (const normalized of normalizedAdds) {
      const key = `${normalized.row.kind}:${normalized.row.medication_id}`
      const duplicate = [...finalLines.values()].some(
        (line) => `${line.kind}:${line.medicationId}` === key,
      )
      if (duplicate) fail('同一个治疗方案里不能重复添加同一种药')
      if (normalized.row.is_host === 1) {
        const host = [...finalLines.values()].some((line) => line.isHost)
        if (host) fail('一个治疗方案只能有一个主药')
      }
      finalLines.set(normalized.row.id, {
        medicationId: normalized.row.medication_id,
        kind: normalized.row.kind,
        isHost: normalized.row.is_host === 1,
      })
    }

    const finalHosts = [...finalLines.values()].filter((line) => line.isHost)
    if (finalHosts.length > 1) fail('一个治疗方案只能有一个主药')

    // 修改已有线的 medicationId 也要查重，否则可以把两条同途径的线改成同一种药。
    const usedLineKeys = new Set<string>()
    for (const line of finalLines.values()) {
      const lineKey = `${line.kind}:${line.medicationId}`
      if (usedLineKeys.has(lineKey)) {
        fail('同一个治疗方案里不能重复添加同一种药')
      }
      usedLineKeys.add(lineKey)
    }

    const clearHosts =
      newHosts.length > 0 || normalizedAdds.some((line) => line.row.is_host === 1)

    const touched = prepared.filter((entry) => entry.sets.length > 0 || entry.phases !== null)
    if (
      newName === null &&
      touched.length === 0 &&
      removed.size === 0 &&
      normalizedAdds.length === 0
    ) {
      return loadTreatment(db, existing)
    }

    await db.withTransactionAsync(async () => {
      if (newName !== null) {
        await db.runAsync('UPDATE treatment SET name = ? WHERE id = ?', newName, id)
      }
      if (clearHosts) {
        await db.runAsync('UPDATE treatment_line SET is_host = 0 WHERE treatment_id = ?', id)
      }
      for (const entry of touched) {
        if (entry.sets.length > 0) {
          await db.runAsync(
            `UPDATE treatment_line SET ${entry.sets.join(', ')} WHERE id = ?`,
            [...entry.values, entry.id],
          )
        }
        if (entry.phases !== null) {
          // 阶段整体替换：先删后插，避免 order_idx 冲突
          await db.runAsync('DELETE FROM treatment_phase WHERE line_id = ?', entry.id)
          for (const phase of entry.phases) {
            await db.runAsync(
              `INSERT INTO treatment_phase
                (id, line_id, order_idx, kind, interval_days, repeat_count, dose, unit, effective_from)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              phase.id,
              phase.line_id,
              phase.order_idx,
              phase.kind,
              phase.interval_days,
              phase.repeat_count,
              phase.dose,
              phase.unit,
              phase.effective_from,
            )
          }
        }
      }
      for (const removeId of removed) {
        await db.runAsync('DELETE FROM treatment_line WHERE id = ?', removeId)
      }
      for (const normalized of normalizedAdds) {
        await insertLine(db, normalized)
      }
    })

    const updated = await getTreatmentRow(db, id)
    if (!updated) fail('治疗方案不存在')
    return loadTreatment(db, updated)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '治疗方案 ID')
    const db = await getDatabase()
    await requireTreatmentExists(db, id)
    // treatment_line / treatment_phase / dose_log / reminder_rule 都是 ON DELETE CASCADE
    await db.runAsync('DELETE FROM treatment WHERE id = ?', id)
  },
}

// ---------------------------------------------------------------------------
// efficacy events（疗效下降 / 失效）
// ---------------------------------------------------------------------------

const EFFICACY_KINDS: EfficacyKind[] = [
  'reduced',
  'failed',
  'intolerance',
  'antibody',
  'other',
]

function requireEfficacyKind(value: unknown): EfficacyKind {
  if (typeof value !== 'string' || !EFFICACY_KINDS.includes(value as EfficacyKind)) {
    fail('疗效事件类型不合法')
  }
  return value as EfficacyKind
}

export interface EfficacyEventInput {
  lineId: string
  kind: EfficacyKind
  occurredAt: number
  note?: string | null
  /** 是否同时停用这条用药线；默认 false */
  stopLine?: boolean
}

export const efficacyEvents = {
  /** 按 lineId 过滤，或返回全部；按发生时间倒序。 */
  async list(lineId?: string): Promise<EfficacyEvent[]> {
    const db = await getDatabase()
    if (lineId !== undefined) {
      requireNonEmptyString(lineId, '用药线 ID')
      const rows = await db.getAllAsync<EfficacyEventRow>(
        'SELECT * FROM efficacy_event WHERE line_id = ? ORDER BY occurred_at DESC, created_at DESC',
        lineId,
      )
      return rows.map(mapEfficacyEvent)
    }
    const rows = await db.getAllAsync<EfficacyEventRow>(
      'SELECT * FROM efficacy_event ORDER BY occurred_at DESC, created_at DESC',
    )
    return rows.map(mapEfficacyEvent)
  },

  /** transaction 仅供已经开启事务的导入流程复用，避免嵌套 BEGIN。 */
  async create(input: EfficacyEventInput, transaction?: SQLiteDatabase): Promise<EfficacyEvent> {
    const lineId = requireNonEmptyString(input?.lineId, '用药线 ID')
    const kind = requireEfficacyKind(input.kind)
    const occurredAt = requireTimestamp(input.occurredAt, '发生时间')
    if (occurredAt > Date.now() + 24 * 60 * 60 * 1000) {
      fail('发生时间不能晚于今天')
    }
    const note = normalizeOptionalText(input.note)
    const stopLine = input.stopLine === true

    const db = transaction ?? await getDatabase()
    await requireTreatmentLineExists(db, lineId)

    const row: EfficacyEventRow = {
      id: Crypto.randomUUID(),
      line_id: lineId,
      kind,
      occurred_at: occurredAt,
      doses_count: 0,
      note,
      created_at: Date.now(),
    }

    const write = async () => {
      const counted = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM dose_log
          WHERE line_id = ? AND status = 'done'
            AND COALESCE(taken_at, scheduled_at, created_at) <= ?`,
        lineId,
        occurredAt,
      )
      row.doses_count = counted?.n ?? 0

      await db.runAsync(
        `INSERT INTO efficacy_event
          (id, line_id, kind, occurred_at, doses_count, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.line_id,
        row.kind,
        row.occurred_at,
        row.doses_count,
        row.note,
        row.created_at,
      )

      if (stopLine) {
        // 已有更早的停用时间时保留更早的那个。
        await db.runAsync(
          `UPDATE treatment_line
            SET ended_at = MIN(COALESCE(ended_at, ?), ?)
            WHERE id = ?`,
          occurredAt,
          occurredAt,
          lineId,
        )
      }
    }
    if (transaction) await write()
    else await db.withTransactionAsync(write)

    return mapEfficacyEvent(row)
  },

  async remove(id: string): Promise<void> {
    const eventId = requireNonEmptyString(id, '疗效事件 ID')
    const db = await getDatabase()
    const row = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM efficacy_event WHERE id = ? LIMIT 1',
      eventId,
    )
    if (!row) fail('疗效事件不存在')
    await db.runAsync('DELETE FROM efficacy_event WHERE id = ?', eventId)
  },
}

// ---------------------------------------------------------------------------
// dose logs（注射与口服共用）
// ---------------------------------------------------------------------------

export interface DoseLogInput {
  lineId: string
  scheduledAt: number | null
  takenAt: number | null
  status: DoseStatus
  dose?: number | null
  unit?: string | null
  site?: InjectionSite | null
  lotNumber?: string | null
  note?: string | null
}

function normalizeOptionalUnit(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = requireNonEmptyString(value, '单位')
  return text
}

function normalizeOptionalSite(value: InjectionSite | null | undefined): InjectionSite | null {
  if (value === null || value === undefined) return null
  return requireSite(value)
}

export const doseLogs = {
  /** 按 lineId 过滤，或返回全部；按 scheduled_at 升序。 */
  async list(lineId?: string): Promise<DoseLog[]> {
    const db = await getDatabase()
    if (lineId !== undefined) {
      requireNonEmptyString(lineId, '用药条目 ID')
      const rows = await db.getAllAsync<DoseLogRow>(
        `SELECT * FROM dose_log WHERE line_id = ?
          ORDER BY scheduled_at IS NULL, scheduled_at ASC, created_at ASC`,
        lineId,
      )
      return rows.map(mapDoseLog)
    }
    const rows = await db.getAllAsync<DoseLogRow>(
      'SELECT * FROM dose_log ORDER BY scheduled_at IS NULL, scheduled_at ASC, created_at ASC',
    )
    return rows.map(mapDoseLog)
  },

  /** 按计划时间区间查询（两端都包含），用于趋势与通知。 */
  async listBetween(from: number, to: number): Promise<DoseLog[]> {
    const start = requireTimestamp(from, '起始时间')
    const end = requireTimestamp(to, '结束时间')
    if (end < start) fail('结束时间不能早于起始时间')
    const db = await getDatabase()
    const rows = await db.getAllAsync<DoseLogRow>(
      `SELECT * FROM dose_log
        WHERE scheduled_at IS NOT NULL AND scheduled_at BETWEEN ? AND ?
        ORDER BY scheduled_at ASC, created_at ASC`,
      start,
      end,
    )
    return rows.map(mapDoseLog)
  },

  async create(input: DoseLogInput): Promise<DoseLog> {
    const lineId = requireNonEmptyString(input?.lineId, '用药条目 ID')
    const status = requireDoseStatus(input.status)
    const scheduledAt =
      input.scheduledAt === null || input.scheduledAt === undefined
        ? null
        : requireTimestamp(input.scheduledAt, '计划时间')
    const takenAt =
      input.takenAt === null || input.takenAt === undefined
        ? null
        : requireTimestamp(input.takenAt, '打卡时间')
    if (status === 'done' && takenAt === null) fail('已完成的记录需要填写打卡时间')

    const dose = requireNullableDose(input.dose, '剂量')
    const unit = normalizeOptionalUnit(input.unit)
    const site = normalizeOptionalSite(input.site)
    const lotNumber = normalizeOptionalText(input.lotNumber)
    const note = normalizeOptionalText(input.note)

    const db = await getDatabase()
    await requireTreatmentLineExists(db, lineId)

    const now = Date.now()
    const row: DoseLogRow = {
      id: Crypto.randomUUID(),
      line_id: lineId,
      scheduled_at: scheduledAt,
      taken_at: takenAt,
      status,
      dose,
      unit,
      site,
      lot_number: lotNumber,
      note,
      created_at: now,
      updated_at: now,
    }

    await db.runAsync(
      `INSERT INTO dose_log
        (id, line_id, scheduled_at, taken_at, status, dose, unit, site,
         lot_number, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.line_id,
      row.scheduled_at,
      row.taken_at,
      row.status,
      row.dose,
      row.unit,
      row.site,
      row.lot_number,
      row.note,
      row.created_at,
      row.updated_at,
    )
    return mapDoseLog(row)
  },

  async update(
    id: string,
    patch: Partial<Omit<DoseLog, 'id' | 'lineId' | 'createdAt'>>,
  ): Promise<DoseLog> {
    requireNonEmptyString(id, '打卡记录 ID')
    const db = await getDatabase()
    const existing = await getDoseLogRow(db, id)
    if (!existing) fail('打卡记录不存在')

    const sets: string[] = []
    const values: Array<string | number | null> = []

    if (patch.scheduledAt !== undefined) {
      sets.push('scheduled_at = ?')
      values.push(
        patch.scheduledAt === null ? null : requireTimestamp(patch.scheduledAt, '计划时间'),
      )
    }
    if (patch.takenAt !== undefined) {
      sets.push('taken_at = ?')
      values.push(patch.takenAt === null ? null : requireTimestamp(patch.takenAt, '打卡时间'))
    }
    if (patch.status !== undefined) {
      sets.push('status = ?')
      values.push(requireDoseStatus(patch.status))
    }
    if (patch.dose !== undefined) {
      sets.push('dose = ?')
      values.push(requireNullableDose(patch.dose, '剂量'))
    }
    if (patch.unit !== undefined) {
      sets.push('unit = ?')
      values.push(normalizeOptionalUnit(patch.unit))
    }
    if (patch.site !== undefined) {
      sets.push('site = ?')
      values.push(normalizeOptionalSite(patch.site))
    }
    if (patch.lotNumber !== undefined) {
      sets.push('lot_number = ?')
      values.push(normalizeOptionalText(patch.lotNumber))
    }
    if (patch.note !== undefined) {
      sets.push('note = ?')
      values.push(normalizeOptionalText(patch.note))
    }

    if (sets.length === 0) return mapDoseLog(existing)

    const nextStatus =
      patch.status !== undefined ? requireDoseStatus(patch.status) : existing.status
    const nextTakenAt =
      patch.takenAt !== undefined
        ? patch.takenAt === null
          ? null
          : requireTimestamp(patch.takenAt, '打卡时间')
        : existing.taken_at
    if (nextStatus === 'done' && nextTakenAt === null) {
      fail('已完成的记录需要填写打卡时间')
    }

    sets.push('updated_at = ?')
    values.push(Date.now())

    values.push(id)
    await db.runAsync(`UPDATE dose_log SET ${sets.join(', ')} WHERE id = ?`, values)

    const updated = await getDoseLogRow(db, id)
    if (!updated) fail('打卡记录不存在')
    return mapDoseLog(updated)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '打卡记录 ID')
    const db = await getDatabase()
    const result = await db.runAsync('DELETE FROM dose_log WHERE id = ?', id)
    if (result.changes === 0) fail('打卡记录不存在')
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

  async get(id: string): Promise<SymptomLog | null> {
    requireNonEmptyString(id, '症状记录 ID')
    const db = await getDatabase()
    const row = await getSymptomRow(db, id)
    return row ? mapSymptom(row) : null
  },

  async create(input: Omit<SymptomLog, 'id'>): Promise<SymptomLog> {
    const loggedAt = requireTimestamp(input?.loggedAt, '记录时间')
    const severity = requireInteger(input.severity, '严重程度', 1)
    if (severity > 5) fail('严重程度必须在 1 到 5 之间')

    if (!Array.isArray(input.tags)) fail('症状标签必须是数组')
    const tags = normalizeTags(input.tags)

    const painScore = normalizePainScore(input.painScore)
    const note = normalizeOptionalText(input.note)
    const temperature = normalizeTemperature(input.temperature)
    const doseLogId = normalizeOptionalId(input.injectionId)

    const db = await getDatabase()
    if (doseLogId !== null) {
      const log = await getDoseLogRow(db, doseLogId)
      if (!log) fail('关联的打卡记录不存在')
    }

    const row: SymptomLogRow = {
      id: Crypto.randomUUID(),
      logged_at: loggedAt,
      severity,
      pain_score: painScore,
      tags: JSON.stringify(tags),
      note,
      temperature,
      dose_log_id: doseLogId,
    }

    await db.runAsync(
      `INSERT INTO symptom_log
        (id, logged_at, severity, pain_score, tags, note, temperature, dose_log_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.logged_at,
      row.severity,
      row.pain_score,
      row.tags,
      row.note,
      row.temperature,
      row.dose_log_id,
    )
    return mapSymptom(row)
  },

  async update(id: string, patch: Partial<Omit<SymptomLog, 'id'>>): Promise<SymptomLog> {
    requireNonEmptyString(id, '症状记录 ID')
    const db = await getDatabase()
    const existing = await getSymptomRow(db, id)
    if (!existing) fail('症状记录不存在')

    const sets: string[] = []
    const values: Array<string | number | null> = []

    if (patch.loggedAt !== undefined) {
      sets.push('logged_at = ?')
      values.push(requireTimestamp(patch.loggedAt, '记录时间'))
    }
    if (patch.severity !== undefined) {
      const severity = requireInteger(patch.severity, '严重程度', 1)
      if (severity > 5) fail('严重程度必须在 1 到 5 之间')
      sets.push('severity = ?')
      values.push(severity)
    }
    if (patch.painScore !== undefined) {
      sets.push('pain_score = ?')
      values.push(normalizePainScore(patch.painScore))
    }
    if (patch.tags !== undefined) {
      if (!Array.isArray(patch.tags)) fail('症状标签必须是数组')
      sets.push('tags = ?')
      values.push(JSON.stringify(normalizeTags(patch.tags)))
    }
    if (patch.note !== undefined) {
      sets.push('note = ?')
      values.push(normalizeOptionalText(patch.note))
    }
    if (patch.temperature !== undefined) {
      sets.push('temperature = ?')
      values.push(normalizeTemperature(patch.temperature))
    }
    if (patch.injectionId !== undefined) {
      const doseLogId = normalizeOptionalId(patch.injectionId)
      if (doseLogId !== null) {
        const log = await getDoseLogRow(db, doseLogId)
        if (!log) fail('关联的打卡记录不存在')
      }
      sets.push('dose_log_id = ?')
      values.push(doseLogId)
    }

    if (sets.length === 0) return mapSymptom(existing)

    values.push(id)
    await db.runAsync(`UPDATE symptom_log SET ${sets.join(', ')} WHERE id = ?`, values)

    const updated = await getSymptomRow(db, id)
    if (!updated) fail('症状记录不存在')
    return mapSymptom(updated)
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '症状记录 ID')
    const db = await getDatabase()
    const result = await db.runAsync('DELETE FROM symptom_log WHERE id = ?', id)
    if (result.changes === 0) fail('症状记录不存在')
  },
}

// ---------------------------------------------------------------------------
// symptom tags（用户可维护的症状名称）
// ---------------------------------------------------------------------------

async function insertSymptomTag(db: SQLiteDatabase, safeName: string): Promise<SymptomTagRow> {
  const maxRow = await db.getFirstAsync<{ max_order: number | null }>(
    'SELECT MAX(sort_order) AS max_order FROM symptom_tag',
  )
  const row: SymptomTagRow = {
    id: Crypto.randomUUID(),
    name: safeName,
    is_builtin: 0,
    sort_order: (maxRow?.max_order ?? -1) + 1,
    created_at: Date.now(),
  }
  await db.runAsync(
    `INSERT INTO symptom_tag (id, name, is_builtin, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    row.id,
    row.name,
    row.is_builtin,
    row.sort_order,
    row.created_at,
  )
  return row
}

export const symptomTags = {
  async list(): Promise<SymptomTag[]> {
    const db = await getDatabase()
    const rows = await db.getAllAsync<SymptomTagRow>(
      'SELECT * FROM symptom_tag ORDER BY sort_order ASC, created_at ASC',
    )
    return rows.map(mapSymptomTag)
  },

  async create(name: string): Promise<SymptomTag> {
    const safeName = requireNonEmptyString(name, '症状名称')
    if (safeName.length > 20) fail('症状名称最多 20 个字')

    const db = await getDatabase()
    const duplicate = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM symptom_tag WHERE name = ? COLLATE NOCASE LIMIT 1',
      safeName,
    )
    if (duplicate) fail('这个症状已经存在')

    return mapSymptomTag(await insertSymptomTag(db, safeName))
  },

  async remove(id: string): Promise<void> {
    requireNonEmptyString(id, '症状标签 ID')
    const db = await getDatabase()
    const row = await db.getFirstAsync<{ is_builtin: number }>(
      'SELECT is_builtin FROM symptom_tag WHERE id = ? LIMIT 1',
      id,
    )
    if (!row) fail('症状标签不存在')
    if (row.is_builtin === 1) fail('内置症状标签不能删除')
    await db.runAsync('DELETE FROM symptom_tag WHERE id = ?', id)
  },

  /** 导入时按名字补齐标签：已存在就复用，不报错。 */
  async ensure(name: string): Promise<{ tag: SymptomTag; created: boolean }> {
    const safeName = requireNonEmptyString(name, '症状名称')
    if (safeName.length > 20) fail('症状名称最多 20 个字')

    const db = await getDatabase()
    const existing = await db.getFirstAsync<SymptomTagRow>(
      'SELECT * FROM symptom_tag WHERE name = ? COLLATE NOCASE LIMIT 1',
      safeName,
    )
    if (existing) return { tag: mapSymptomTag(existing), created: false }

    return { tag: mapSymptomTag(await insertSymptomTag(db, safeName)), created: true }
  },
}

// ---------------------------------------------------------------------------
// reminder rules（每个治疗方案一条）
// ---------------------------------------------------------------------------

export interface ReminderRuleInput {
  treatmentId: string
  offsets: number[]
  timeOfDay: string
  snoozeMinutes: number
  enabled: boolean
  id?: string
}

export const reminderRules = {
  async getFor(treatmentId: string): Promise<ReminderRuleV5 | null> {
    requireNonEmptyString(treatmentId, '治疗方案 ID')
    const db = await getDatabase()
    const row = await getReminderRowFor(db, treatmentId)
    return row ? mapReminderRule(row) : null
  },

  async upsert(input: ReminderRuleInput): Promise<ReminderRuleV5> {
    const treatmentId = requireNonEmptyString(input?.treatmentId, '治疗方案 ID')
    if (!Array.isArray(input.offsets) || input.offsets.length === 0) {
      fail('提醒偏移不能为空')
    }
    const offsets = input.offsets.map((offset) => requireInteger(offset, '提醒偏移'))
    const timeOfDay = requireTimeOfDay(input.timeOfDay, '提醒时间')
    const snoozeMinutes = requireInteger(input.snoozeMinutes, '稍后提醒分钟数', 0)
    if (typeof input.enabled !== 'boolean') fail('提醒开关必须是布尔值')

    const db = await getDatabase()
    await requireTreatmentExists(db, treatmentId)

    const byId = input.id
      ? await db.getFirstAsync<ReminderRuleRow>('SELECT * FROM reminder_rule WHERE id = ?', input.id)
      : null
    if (byId && byId.treatment_id !== treatmentId) {
      fail('提醒规则不属于该治疗方案')
    }

    const existing = (await getReminderRowFor(db, treatmentId)) ?? byId

    if (existing) {
      await db.runAsync(
        `UPDATE reminder_rule
            SET treatment_id = ?, offsets = ?, time_of_day = ?, snooze_minutes = ?, enabled = ?
          WHERE id = ?`,
        treatmentId,
        JSON.stringify(offsets),
        timeOfDay,
        snoozeMinutes,
        input.enabled ? 1 : 0,
        existing.id,
      )
      return mapReminderRule({
        ...existing,
        treatment_id: treatmentId,
        offsets: JSON.stringify(offsets),
        time_of_day: timeOfDay,
        snooze_minutes: snoozeMinutes,
        enabled: input.enabled ? 1 : 0,
      })
    }

    const row: ReminderRuleRow = {
      id: input.id ?? Crypto.randomUUID(),
      treatment_id: treatmentId,
      offsets: JSON.stringify(offsets),
      time_of_day: timeOfDay,
      snooze_minutes: snoozeMinutes,
      enabled: input.enabled ? 1 : 0,
    }

    await db.runAsync(
      `INSERT INTO reminder_rule
        (id, treatment_id, offsets, time_of_day, snooze_minutes, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row.id,
      row.treatment_id,
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

function normalizeNames(value: unknown, label: string): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const name = requireNonEmptyString(item, label)
    if (name.length > 40) fail(`${label}单项最多 40 个字`)
    if (seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTemperature(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const temp = requireFiniteNumber(value, '体温')
  if (temp < 30 || temp > 45) fail('体温必须在 30℃ 到 45℃ 之间')
  return temp
}

/** NRS 0–10 整数评分；null 表示本次未评估。 */
function normalizePainScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const score = requireInteger(value, '疼痛评分', 0)
  if (score > 10) fail('疼痛评分必须在 0 到 10 之间')
  return score
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    const name = requireNonEmptyString(tag, '症状标签')
    if (name.length > 20) fail('症状名称最多 20 个字')
    if (seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}
