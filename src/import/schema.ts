import type { InjectionSite, SymptomLog } from '@/types'
import { SITE_LABELS } from '@/domain/rotation'

/**
 * 导入文件解析（纯函数，可在 Node 里直接单测）。
 *
 * 文件是 UTF-8 JSON，结构见 docs/import-format.md：
 * {
 *   "format": "bioclock-import",
 *   "version": 1,
 *   "injections": [...],
 *   "symptoms": [...]
 * }
 *
 * 时间一律写成本地时间字符串（YYYY-MM-DD HH:mm），不写时区，
 * 这样用户从纸质记录抄过来不会有 UTC 偏移的坑。
 */

export interface ImportInjection {
  injectedAt: number
  /** 药名，留空表示使用当前方案的药物 */
  medicationName: string | null
  dose: number | null
  unit: string | null
  site: InjectionSite
  lotNumber: string | null
  note: string | null
}

export interface ImportSymptom {
  loggedAt: number
  severity: SymptomLog['severity']
  painScore: number | null
  tags: string[]
  temperature: number | null
  note: string | null
  /** 可选：用同一时刻关联一条注射记录 */
  injectionAt: number | null
}

export interface ImportPayload {
  injections: ImportInjection[]
  symptoms: ImportSymptom[]
}

export const IMPORT_FORMAT = 'bioclock-import'
export const IMPORT_VERSION = 1
export const IMPORT_MAX_ROWS = 2000

const SITE_ALIASES: Record<string, InjectionSite> = Object.fromEntries(
  (Object.keys(SITE_LABELS) as InjectionSite[]).flatMap((site) => [
    [site, site],
    [SITE_LABELS[site], site],
  ]),
) as Record<string, InjectionSite>

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
  if (raw.version !== IMPORT_VERSION) {
    fail(`不支持的导入文件版本：${String(raw.version)}，当前仅支持版本 ${IMPORT_VERSION}`)
  }

  const injectionRows = readArray(raw.injections, 'injections')
  const symptomRows = readArray(raw.symptoms, 'symptoms')
  if (injectionRows.length + symptomRows.length === 0) fail('文件里没有任何记录')
  if (injectionRows.length > IMPORT_MAX_ROWS || symptomRows.length > IMPORT_MAX_ROWS) {
    fail(`单次最多导入 ${IMPORT_MAX_ROWS} 条记录，请拆分成多个文件`)
  }

  return {
    injections: injectionRows.map((row, index) => parseInjection(row, index)),
    symptoms: symptomRows.map((row, index) => parseSymptom(row, index)),
  }
}
