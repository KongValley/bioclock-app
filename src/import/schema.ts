import type {
  DoseStatus,
  EfficacyKind,
  InjectionSite,
  LineKind,
  MedicationRoute,
  SymptomLog,
} from '@/types'
import { SITE_LABELS } from '@/domain/rotation'

/**
 * 导入文件解析（纯函数，可在 Node 里直接单测）。
 *
 * 文件是 UTF-8 JSON，结构见 docs/import-format.md：
 * {
 *   "format": "bioclock-import",
 *   "version": 2,
 *   "medications": [...],
 *   "injections": [...],
 *   "symptoms": [...],
 *   "oralLogs": [...]
 * }
 *
 * v1 仍然接受（v1 没有 medications / oralLogs 段，注射记录也没有 status / lineLabel）。
 * 时间一律写成本地时间字符串（YYYY-MM-DD HH:mm），不写时区，
 * 这样用户从纸质记录抄过来不会有 UTC 偏移的坑。
 */

export interface ImportMedication {
  name: string
  genericName: string | null
  brandNames: string[]
  route: MedicationRoute
  defaultDose: number | null
  unit: string | null
  catalogKey: string | null
  extra: Record<string, unknown>
}

export interface ImportInjection {
  injectedAt: number
  /** 药名，留空表示使用当前治疗方案的宿主注射线 */
  medicationName: string | null
  dose: number | null
  unit: string | null
  site: InjectionSite
  lotNumber: string | null
  note: string | null
  status: DoseStatus
  /** 可选的用药线名称，用来在多条注射线里消歧 */
  lineLabel: string | null
}

export interface ImportOralLog {
  takenAt: number
  medicationName: string | null
  status: DoseStatus
  dose: number | null
  unit: string | null
  note: string | null
  lineLabel: string | null
}

export interface ImportSymptom {
  loggedAt: number
  severity: SymptomLog['severity']
  painScore: number | null
  tags: string[]
  temperature: number | null
  note: string | null
  /** 可选：用同一时刻关联一条用药记录（dose_log） */
  injectionAt: number | null
}

/** v3 备份里的用药线状态（停用时间），按药名/线名匹配当前方案。 */
export interface ImportLineState {
  lineLabel: string | null
  medicationName: string | null
  kind: LineKind
  endedAt: number | null
}

/** v3 备份里的疗效事件。 */
export interface ImportEfficacyEvent {
  lineLabel: string | null
  medicationName: string | null
  kind: EfficacyKind
  occurredAt: number
  note: string | null
}

export interface ImportPayload {
  medications: ImportMedication[]
  injections: ImportInjection[]
  oralLogs: ImportOralLog[]
  symptoms: ImportSymptom[]
  lineStates: ImportLineState[]
  efficacyEvents: ImportEfficacyEvent[]
  /** 换机恢复：允许把历史记录挂到已停用的用药线上，避免重复建线 */
  preserveEndedLines?: boolean
}

export const IMPORT_FORMAT = 'bioclock-import'
export const IMPORT_VERSION = 3
/** 仍然接受的最老版本 */
export const IMPORT_MIN_VERSION = 1
export const IMPORT_MAX_ROWS = 2000

const SITE_ALIASES: Record<string, InjectionSite> = Object.fromEntries(
  (Object.keys(SITE_LABELS) as InjectionSite[]).flatMap((site) => [
    [site, site],
    [SITE_LABELS[site], site],
  ]),
) as Record<string, InjectionSite>

const ROUTE_ALIASES: Record<string, MedicationRoute> = {
  sc: 'sc',
  皮下: 'sc',
  皮下注射: 'sc',
  subcutaneous: 'sc',
  iv: 'iv',
  静脉: 'iv',
  静脉输注: 'iv',
  输注: 'iv',
  intravenous: 'iv',
  oral: 'oral',
  口服: 'oral',
  po: 'oral',
}

const STATUS_ALIASES: Record<string, DoseStatus> = {
  done: 'done',
  已用: 'done',
  已完成: 'done',
  完成: 'done',
  已注射: 'done',
  已服用: 'done',
  skipped: 'skipped',
  跳过: 'skipped',
  取消: 'skipped',
  missed: 'missed',
  漏用: 'missed',
  漏服: 'missed',
  未用: 'missed',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(message)
}

function readArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail(`${label} 必须是数组`)
  return value
}

/** 支持 2026-03-01 09:00、2026-03-01T09:00、2026/3/1 9:00，秒可选。 */
export function parseLocalDateTime(value: unknown, label: string): number {
  if (typeof value !== 'string') fail(`${label}必须是文本时间，例如 2026-03-01 09:00`)
  const text = value.trim().replace(/\//g, '-').replace('T', ' ')
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!match) fail(`${label}格式不正确，应为 2026-03-01 09:00`)

  const [, y, mo, d, h, mi, s] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = s === undefined ? 0 : Number(s)

  if (month < 1 || month > 12) fail(`${label}的月份不合法`)
  if (day < 1 || day > 31) fail(`${label}的日期不合法`)
  if (hour > 23 || minute > 59 || second > 59) fail(`${label}的时间不合法`)

  const date = new Date(year, month - 1, day, hour, minute, second, 0)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    fail(`${label}不是一个真实存在的日期`)
  }
  return date.getTime()
}

function requireText(value: unknown, label: string, maxLength = 200): string {
  const text = optionalText(value, label, maxLength)
  if (text === null) fail(`${label}不能为空`)
  return text
}

function optionalText(value: unknown, label: string, maxLength = 200): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length > maxLength) fail(`${label}最多 ${maxLength} 个字`)
  return trimmed
}

function optionalNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || !Number.isFinite(num)) fail(`${label}必须是数字`)
  return num
}

function optionalInt(value: unknown, label: string, min: number, max: number): number | null {
  const num = optionalNumber(value, label)
  if (num === null) return null
  if (!Number.isInteger(num) || num < min || num > max) {
    fail(`${label}必须是 ${min} 到 ${max} 之间的整数`)
  }
  return num
}

function parseSite(value: unknown, label: string): InjectionSite {
  if (value === undefined || value === null || value === '') return 'abdomen_ul'
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const site = SITE_ALIASES[value.trim()]
  if (!site) {
    fail(`${label}不认识「${value}」，可选：${Object.values(SITE_LABELS).join('、')}`)
  }
  return site
}

function parseRoute(value: unknown, label: string): MedicationRoute {
  if (value === undefined || value === null || value === '') return 'sc'
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const route = ROUTE_ALIASES[value.trim().toLowerCase()] ?? ROUTE_ALIASES[value.trim()]
  if (!route) fail(`${label}不认识「${value}」，可选：sc、iv、oral`)
  return route
}

function parseStatus(value: unknown, label: string): DoseStatus {
  if (value === undefined || value === null || value === '') return 'done'
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const status = STATUS_ALIASES[value.trim().toLowerCase()] ?? STATUS_ALIASES[value.trim()]
  if (!status) fail(`${label}不认识「${value}」，可选：done、skipped、missed`)
  return status
}

function parseLineKind(value: unknown, label: string): LineKind {
  if (value === 'injection' || value === '注射') return 'injection'
  if (value === 'oral' || value === '口服') return 'oral'
  fail(`${label}必须是注射或口服`)
}

const EFFICACY_KIND_ALIASES: Record<string, EfficacyKind> = {
  reduced: 'reduced',
  疗效下降: 'reduced',
  下降: 'reduced',
  failed: 'failed',
  疗效失效: 'failed',
  失效: 'failed',
  intolerance: 'intolerance',
  不耐受: 'intolerance',
  antibody: 'antibody',
  抗药抗体: 'antibody',
  other: 'other',
  其他: 'other',
}

function parseEfficacyKind(value: unknown, label: string): EfficacyKind {
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const kind = EFFICACY_KIND_ALIASES[value.trim().toLowerCase()] ?? EFFICACY_KIND_ALIASES[value.trim()]
  if (!kind) fail(`${label}不认识「${value}」`)
  return kind
}

function parseTags(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') fail(`${label}里的每一项都必须是文本`)
    const tag = item.trim()
    if (tag === '') continue
    if (tag.length > 20) fail(`${label}里的单个症状最多 20 个字`)
    if (seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

/** 商品名：接受数组，也接受用顿号/逗号分隔的文本。 */
function parseNameList(value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[、,，;；/\n]+/)
      : null
  if (raw === null) fail(`${label}必须是数组或文本`)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') fail(`${label}里的每一项都必须是文本`)
    const name = item.trim()
    if (name === '') continue
    if (name.length > 40) fail(`${label}里的单个名称最多 40 个字`)
    if (seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function parseExtra(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) fail(`${label}必须是对象`)
  return value
}

function parseMedication(value: unknown, index: number): ImportMedication {
  const label = `第 ${index + 1} 条药物`
  if (!isRecord(value)) fail(`${label}必须是对象`)

  const defaultDose = optionalNumber(value.defaultDose, `${label}的默认剂量`)
  if (defaultDose !== null && defaultDose < 0) fail(`${label}的默认剂量不能为负数`)

  return {
    name: requireText(value.name, `${label}的药名`, 40),
    genericName: optionalText(value.genericName, `${label}的通用名`, 40),
    brandNames: parseNameList(value.brandNames, `${label}的商品名`),
    route: parseRoute(value.route, `${label}的给药途径`),
    defaultDose,
    unit: optionalText(value.unit, `${label}的单位`, 20),
    catalogKey: optionalText(value.catalogKey, `${label}的目录标识`, 60),
    extra: parseExtra(value.extra, `${label}的扩展字段`),
  }
}

function parseInjection(value: unknown, index: number): ImportInjection {
  const label = `第 ${index + 1} 条注射记录`
  if (!isRecord(value)) fail(`${label}必须是对象`)

  const injectedAt = parseLocalDateTime(value.injectedAt, `${label}的注射时间`)
  const dose = optionalNumber(value.dose, `${label}的剂量`)
  if (dose !== null && dose < 0) fail(`${label}的剂量不能为负数`)

  return {
    injectedAt,
    medicationName: optionalText(value.medication, `${label}的药名`),
    dose,
    unit: optionalText(value.unit, `${label}的单位`, 20),
    site: parseSite(value.site, `${label}的注射部位`),
    lotNumber: optionalText(value.lotNumber, `${label}的批号`, 60),
    note: optionalText(value.note, `${label}的备注`),
    status: parseStatus(value.status, `${label}的状态`),
    lineLabel: optionalText(value.lineLabel, `${label}的用药线名称`, 60),
  }
}

function parseOralLog(value: unknown, index: number): ImportOralLog {
  const label = `第 ${index + 1} 条口服打卡`
  if (!isRecord(value)) fail(`${label}必须是对象`)

  const timeValue = value.takenAt ?? value.loggedAt
  const dose = optionalNumber(value.dose, `${label}的剂量`)
  if (dose !== null && dose < 0) fail(`${label}的剂量不能为负数`)

  return {
    takenAt: parseLocalDateTime(timeValue, `${label}的记录时间`),
    medicationName: optionalText(value.medication, `${label}的药名`),
    status: parseStatus(value.status, `${label}的状态`),
    dose,
    unit: optionalText(value.unit, `${label}的单位`, 20),
    note: optionalText(value.note, `${label}的备注`),
    lineLabel: optionalText(value.lineLabel, `${label}的用药线名称`, 60),
  }
}

function parseSymptom(value: unknown, index: number): ImportSymptom {
  const label = `第 ${index + 1} 条症状记录`
  if (!isRecord(value)) fail(`${label}必须是对象`)

  const severity = optionalInt(value.severity, `${label}的严重程度`, 1, 5) ?? 3
  const painScore = optionalInt(value.painScore, `${label}的疼痛评分`, 0, 10)
  const temperature = optionalNumber(value.temperature, `${label}的体温`)
  if (temperature !== null && (temperature < 30 || temperature > 45)) {
    fail(`${label}的体温应在 30℃ 到 45℃ 之间`)
  }

  return {
    loggedAt: parseLocalDateTime(value.loggedAt, `${label}的记录时间`),
    severity: severity as SymptomLog['severity'],
    painScore,
    tags: parseTags(value.tags, `${label}的症状`),
    temperature,
    note: optionalText(value.note, `${label}的备注`),
    injectionAt:
      value.injectionAt === undefined || value.injectionAt === null
        ? null
        : parseLocalDateTime(value.injectionAt, `${label}的关联注射时间`),
  }
}

function parseLineState(value: unknown, index: number): ImportLineState {
  const label = `第 ${index + 1} 条用药线状态`
  if (!isRecord(value)) fail(`${label}必须是对象`)
  const endedAt =
    value.endedAt === undefined || value.endedAt === null
      ? null
      : parseLocalDateTime(value.endedAt, `${label}的停用时间`)
  if (endedAt !== null && endedAt > Date.now() + 24 * 60 * 60 * 1000) {
    fail(`${label}的停用时间不能晚于今天`)
  }
  return {
    lineLabel: optionalText(value.lineLabel, `${label}的用药线名称`, 60),
    medicationName: optionalText(value.medication, `${label}的药名`),
    kind: parseLineKind(value.kind, `${label}的类型`),
    endedAt,
  }
}

function parseEfficacyEvent(value: unknown, index: number): ImportEfficacyEvent {
  const label = `第 ${index + 1} 条疗效记录`
  if (!isRecord(value)) fail(`${label}必须是对象`)
  return {
    lineLabel: optionalText(value.lineLabel, `${label}的用药线名称`, 60),
    medicationName: optionalText(value.medication, `${label}的药名`),
    kind: parseEfficacyKind(value.kind, `${label}的类型`),
    occurredAt: parseLocalDateTime(value.occurredAt, `${label}的发生时间`),
    note: optionalText(value.note, `${label}的备注`),
  }
}

export function parseImportRows(
  medicationRows: unknown[],
  injectionRows: unknown[],
  oralLogRows: unknown[],
  symptomRows: unknown[],
  lineStateRows: unknown[] = [],
  efficacyRows: unknown[] = [],
): ImportPayload {
  const total =
    medicationRows.length +
    injectionRows.length +
    oralLogRows.length +
    symptomRows.length +
    lineStateRows.length +
    efficacyRows.length
  if (total === 0) fail('文件里没有任何记录')
  for (const [rows, name] of [
    [medicationRows, '药物'],
    [injectionRows, '注射记录'],
    [oralLogRows, '口服打卡'],
    [symptomRows, '症状记录'],
    [lineStateRows, '用药线状态'],
    [efficacyRows, '疗效记录'],
  ] as const) {
    if (rows.length > IMPORT_MAX_ROWS) {
      fail(`${name}最多 ${IMPORT_MAX_ROWS} 条，请拆分成多个文件`)
    }
  }

  return {
    medications: medicationRows.map((row, index) => parseMedication(row, index)),
    injections: injectionRows.map((row, index) => parseInjection(row, index)),
    oralLogs: oralLogRows.map((row, index) => parseOralLog(row, index)),
    symptoms: symptomRows.map((row, index) => parseSymptom(row, index)),
    lineStates: lineStateRows.map((row, index) => parseLineState(row, index)),
    efficacyEvents: efficacyRows.map((row, index) => parseEfficacyEvent(row, index)),
  }
}

export function parseImportJson(text: string): ImportPayload {
  const cleaned = text.replace(/^\uFEFF/, '').trim()
  if (cleaned === '') fail('文件是空的')

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    fail('文件不是有效的 JSON，请检查是否导出完整')
  }
  if (!isRecord(raw)) fail('文件格式不对：顶层必须是一个对象')

  if (raw.format !== IMPORT_FORMAT) {
    fail('这不是 BioClock 的导入文件（缺少 format: "bioclock-import"）')
  }

  const version = raw.version
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < IMPORT_MIN_VERSION ||
    version > IMPORT_VERSION
  ) {
    fail(
      `不支持的导入文件版本：${String(version)}，当前支持版本 ${IMPORT_MIN_VERSION} 到 ${IMPORT_VERSION}`,
    )
  }

  return parseImportRows(
    readArray(raw.medications, 'medications'),
    readArray(raw.injections, 'injections'),
    readArray(raw.oralLogs, 'oralLogs'),
    readArray(raw.symptoms, 'symptoms'),
    readArray(raw.lineStates, 'lineStates'),
    readArray(raw.efficacyEvents, 'efficacyEvents'),
  )
}
