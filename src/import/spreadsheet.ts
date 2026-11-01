import * as XLSX from 'xlsx'
import { parseImportRows, type ImportPayload } from './schema'

/**
 * Excel 导入。
 *
 * 支持 .xlsx / .xls，工作簿可以有下列工作表：
 * - 「注射记录」：注射时间* / 药物 / 剂量 / 单位 / 部位 / 批号 / 备注 / 状态 / 用药线
 * - 「症状记录」：记录时间* / 严重程度 / 疼痛评分 / 症状 / 体温 / 备注 / 关联注射时间
 * - 「药物」：药名* / 通用名 / 商品名 / 给药途径 / 默认剂量 / 单位 / 目录标识
 * - 「口服打卡」：记录时间* / 药物* / 状态 / 剂量 / 单位 / 备注
 *
 * 只有一个工作表时按表头自动判断类型。
 * 表头支持中英文别名，日期可以是 Excel 日期单元格或 `2026-03-01 09:00` 文本。
 */

type Row = Record<string, unknown>

const INJECTION_ALIASES: Record<string, string[]> = {
  injectedAt: ['注射时间', '时间', '日期时间', 'injectedat', 'date'],
  medication: ['药物', '药名', '药品', 'medication', 'drug'],
  dose: ['剂量', 'dose'],
  unit: ['单位', 'unit'],
  site: ['注射部位', '部位', 'site'],
  lotNumber: ['批号', '批次', 'lotnumber', 'lot'],
  note: ['备注', '说明', 'note'],
  status: ['状态', 'status'],
  lineLabel: ['用药线', '用药条目', 'linelabel', 'line'],
}

const SYMPTOM_ALIASES: Record<string, string[]> = {
  loggedAt: ['记录时间', '时间', 'loggedat', 'date'],
  severity: ['严重程度', '严重度', 'severity'],
  painScore: ['疼痛评分', '疼痛', 'painscore', 'pain'],
  tags: ['症状', '症状标签', 'tags'],
  temperature: ['体温', '温度', 'temperature'],
  note: ['备注', '说明', 'note'],
  injectionAt: ['关联注射时间', '关联注射', 'injectionat'],
}

const MEDICATION_ALIASES: Record<string, string[]> = {
  name: ['药名', '药物', '药品', '名称', 'name'],
  genericName: ['通用名', 'genericname', 'generic'],
  brandNames: ['商品名', 'brandnames', 'brand'],
  route: ['给药途径', '途径', '用药途径', 'route'],
  defaultDose: ['默认剂量', '剂量', 'defaultdose', 'dose'],
  unit: ['单位', 'unit'],
  catalogKey: ['目录标识', '目录', 'catalogkey'],
}

const ORAL_ALIASES: Record<string, string[]> = {
  takenAt: ['记录时间', '时间', '服药时间', '打卡时间', 'takenat', 'loggedat', 'date'],
  medication: ['药物', '药名', '药品', 'medication', 'drug'],
  status: ['状态', 'status'],
  dose: ['剂量', 'dose'],
  unit: ['单位', 'unit'],
  note: ['备注', '说明', 'note'],
  lineLabel: ['用药线', '用药条目', 'linelabel', 'line'],
}

const INJECTION_SHEET_NAMES = ['注射记录', '注射', 'injections', 'injection']
const SYMPTOM_SHEET_NAMES = ['症状记录', '症状', 'symptoms', 'symptom']
const MEDICATION_SHEET_NAMES = [
  '药物',
  '药品',
  '药物目录',
  'medications',
  'medication',
  'drugs',
  'drug',
]
const ORAL_SHEET_NAMES = ['口服打卡', '口服记录', '口服', 'orallogs', 'oral']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function serialToText(serial: number): string {
  const parsed = XLSX.SSF.parse_date_code(serial)
  if (!parsed) return String(serial)
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)} ${pad(parsed.H)}:${pad(parsed.M)}`
}

function dateCellText(value: unknown): string {
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'number') return serialToText(value)
  return String(value ?? '').trim()
}

function plainText(value: unknown): string {
  if (value instanceof Date) return formatDate(value)
  return String(value ?? '').trim()
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s_\-*:：]/g, '')
}

function buildIndex(header: unknown[], aliases: Record<string, string[]>): Record<string, number> {
  const normalized = header.map(normalizeHeader)
  const index: Record<string, number> = {}
  for (const [key, names] of Object.entries(aliases)) {
    const found = normalized.findIndex((cell) => names.includes(cell))
    if (found >= 0) index[key] = found
  }
  return index
}

function readRow(row: unknown[], index: Record<string, number>): Row {
  const result: Row = {}
  for (const [key, position] of Object.entries(index)) {
    const value = row[position]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      result[key] = value
    }
  }
  return result
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')
}

function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
}

function parseMatrix(
  matrix: unknown[][],
  aliases: Record<string, string[]>,
  requiredKey: string,
  missingMessage: string,
): Row[] {
  if (matrix.length === 0) return []
  const index = buildIndex(matrix[0], aliases)
  if (index[requiredKey] === undefined) throw new Error(missingMessage)
  const rows: Row[] = []
  for (let i = 1; i < matrix.length; i += 1) {
    if (isEmptyRow(matrix[i])) continue
    rows.push(readRow(matrix[i], index))
  }
  return rows
}

function parseInjectionMatrix(matrix: unknown[][]): Row[] {
  return parseMatrix(matrix, INJECTION_ALIASES, 'injectedAt', '注射记录缺少「注射时间」列')
}

function parseSymptomMatrix(matrix: unknown[][]): Row[] {
  return parseMatrix(matrix, SYMPTOM_ALIASES, 'loggedAt', '症状记录缺少「记录时间」列')
}

function parseMedicationMatrix(matrix: unknown[][]): Row[] {
  return parseMatrix(matrix, MEDICATION_ALIASES, 'name', '药物缺少「药名」列')
}

function parseOralMatrix(matrix: unknown[][]): Row[] {
  return parseMatrix(matrix, ORAL_ALIASES, 'takenAt', '口服打卡缺少「记录时间」列')
}

type RowKind = 'injection' | 'symptom' | 'medication' | 'oral'

function splitList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : plainText(value)
        .split(/[、,，;；/\n]+/)
        .map((item) => item.trim())
  return raw.map((item) => plainText(item)).filter((item) => item !== '')
}

function normalizeRows(rows: Row[], kind: RowKind): Row[] {
  return rows.map((row) => {
    const next: Row = { ...row }
    if (kind === 'injection') {
      if (next.injectedAt !== undefined) next.injectedAt = dateCellText(next.injectedAt)
      if (next.site !== undefined) next.site = plainText(next.site)
      if (next.status !== undefined) next.status = plainText(next.status)
      if (next.lineLabel !== undefined) next.lineLabel = plainText(next.lineLabel)
    } else if (kind === 'symptom') {
      if (next.loggedAt !== undefined) next.loggedAt = dateCellText(next.loggedAt)
      if (next.injectionAt !== undefined) next.injectionAt = dateCellText(next.injectionAt)
      if (next.tags !== undefined) next.tags = splitList(next.tags)
    } else if (kind === 'medication') {
      for (const key of ['name', 'genericName', 'route', 'unit', 'catalogKey'] as const) {
        if (next[key] !== undefined) next[key] = plainText(next[key])
      }
      if (next.brandNames !== undefined) next.brandNames = splitList(next.brandNames)
    } else {
      if (next.takenAt !== undefined) next.takenAt = dateCellText(next.takenAt)
      for (const key of ['medication', 'status', 'unit', 'note', 'lineLabel'] as const) {
        if (next[key] !== undefined) next[key] = plainText(next[key])
      }
    }
    return next
  })
}

function findSheet(
  workbook: XLSX.WorkBook,
  names: string[],
): XLSX.WorkSheet | undefined {
  const sheetName = workbook.SheetNames.find((name) =>
    names.includes(name.trim().toLowerCase()),
  )
  return sheetName ? workbook.Sheets[sheetName] : undefined
}

function looksLikeInjection(matrix: unknown[][]): boolean {
  if (matrix.length === 0) return false
  const index = buildIndex(matrix[0], INJECTION_ALIASES)
  return index.injectedAt !== undefined && index.medication !== undefined
}

function looksLikeSymptom(matrix: unknown[][]): boolean {
  if (matrix.length === 0) return false
  const index = buildIndex(matrix[0], SYMPTOM_ALIASES)
  return (
    index.loggedAt !== undefined &&
    (index.severity !== undefined ||
      index.tags !== undefined ||
      index.temperature !== undefined ||
      index.painScore !== undefined)
  )
}

function looksLikeOral(matrix: unknown[][]): boolean {
  if (matrix.length === 0) return false
  const index = buildIndex(matrix[0], ORAL_ALIASES)
  return index.takenAt !== undefined && index.medication !== undefined
}

function looksLikeMedication(matrix: unknown[][]): boolean {
  if (matrix.length === 0) return false
  const index = buildIndex(matrix[0], MEDICATION_ALIASES)
  return index.name !== undefined
}

export function parseSpreadsheet(data: ArrayBuffer | Uint8Array): ImportPayload {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false })

  let injectionRows: Row[] = []
  let symptomRows: Row[] = []
  let medicationRows: Row[] = []
  let oralRows: Row[] = []

  const injectionSheet = findSheet(workbook, INJECTION_SHEET_NAMES)
  const symptomSheet = findSheet(workbook, SYMPTOM_SHEET_NAMES)
  const medicationSheet = findSheet(workbook, MEDICATION_SHEET_NAMES)
  const oralSheet = findSheet(workbook, ORAL_SHEET_NAMES)

  if (injectionSheet) injectionRows = parseInjectionMatrix(sheetToMatrix(injectionSheet))
  if (symptomSheet) symptomRows = parseSymptomMatrix(sheetToMatrix(symptomSheet))
  if (medicationSheet) medicationRows = parseMedicationMatrix(sheetToMatrix(medicationSheet))
  if (oralSheet) oralRows = parseOralMatrix(sheetToMatrix(oralSheet))

  if (!injectionSheet && !symptomSheet && !medicationSheet && !oralSheet) {
    // 单表：按表头判断类型
    const first = workbook.SheetNames[0]
    if (!first) throw new Error('工作簿里没有工作表')
    const matrix = sheetToMatrix(workbook.Sheets[first])
    if (looksLikeInjection(matrix)) injectionRows = parseInjectionMatrix(matrix)
    else if (looksLikeSymptom(matrix)) symptomRows = parseSymptomMatrix(matrix)
    else if (looksLikeOral(matrix)) oralRows = parseOralMatrix(matrix)
    else if (looksLikeMedication(matrix)) medicationRows = parseMedicationMatrix(matrix)
    else {
      throw new Error(
        '没找到可识别的表头：注射表需要「注射时间、药物」，症状表需要「记录时间、严重程度」，药物表需要「药名」',
      )
    }
  }

  return parseImportRows(
    normalizeRows(medicationRows, 'medication'),
    normalizeRows(injectionRows, 'injection'),
    normalizeRows(oralRows, 'oral'),
    normalizeRows(symptomRows, 'symptom'),
  )
}
