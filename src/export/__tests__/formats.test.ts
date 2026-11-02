import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { Medication, SymptomLog, Treatment } from '@/types'
import { DAY, T0, makeInjectionLine, makeLog, makeOralLine } from '@/domain/__tests__/fixtures'
import { parseImportJson } from '@/import/schema'
import { parseSpreadsheet } from '@/import/spreadsheet'

const mocks = vi.hoisted(() => ({
  files: new Map<string, string | ArrayBuffer | Uint8Array>(),
  print: vi.fn(), readBuffer: vi.fn(),
  treatments: vi.fn(), medications: vi.fn(), logs: vi.fn(), symptoms: vi.fn(), events: vi.fn(), settings: vi.fn(),
}))
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///test-cache' },
  File: class {
    uri: string
    constructor(...parts: string[]) { this.uri = parts.join('/') }
    get exists() { return mocks.files.has(this.uri) }
    delete() { mocks.files.delete(this.uri) }
    create() { mocks.files.set(this.uri, '') }
    write(value: string | ArrayBuffer | Uint8Array) { mocks.files.set(this.uri, value) }
  },
}))
vi.mock('expo-print', () => ({ printToFileAsync: mocks.print }))
vi.mock('@/ui/components/file', () => ({ readPickedBuffer: mocks.readBuffer }))
vi.mock('@/db/repo', () => ({
  treatments: { list: mocks.treatments }, medications: { list: mocks.medications },
  doseLogs: { list: mocks.logs }, symptoms: { list: mocks.symptoms },
  efficacyEvents: { list: mocks.events }, settings: { all: mocks.settings },
}))

import { exportCsv } from '../csv'
import { exportExcel } from '../excel'
import { exportJson } from '../json'
import { exportPdf } from '../pdf'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0 + 40 * DAY)
  vi.resetAllMocks()
  mocks.files.clear()
  const treatment: Treatment = {
    id: 'treatment-1', name: '验收方案', isActive: true, createdAt: T0,
    lines: [makeInjectionLine(), makeOralLine({})],
  }
  const medication: Medication = {
    id: 'med-1', name: '验收药物', genericName: '测试通用名', brandNames: ['测试商品名'],
    defaultDose: 40, unit: 'mg', color: '', route: 'sc', diseaseIds: [], catalogKey: null,
    isBuiltin: false, extra: { source: 'synthetic-test' }, createdAt: T0,
  }
  const done = { ...makeLog({ takenAt: T0, scheduledAt: T0 }), note: '含逗号,与"引号"\n第二行' }
  const logs = [
    done,
    makeLog({ scheduledAt: T0 + 14 * DAY, status: 'skipped' }),
    makeLog({ scheduledAt: T0 + 28 * DAY, status: 'missed' }),
    makeLog({ lineId: 'line-oral', takenAt: T0 + DAY, site: null }),
  ]
  const symptom: SymptomLog = {
    id: 's1', loggedAt: T0 + DAY, severity: 1, painScore: 0,
    tags: ['验收标签'], temperature: null, note: null, injectionId: done.id,
  }
  mocks.treatments.mockResolvedValue([treatment])
  mocks.medications.mockResolvedValue([medication, { ...medication, id: 'med-oral', name: '验收口服药', route: 'oral' }])
  mocks.logs.mockResolvedValue(logs)
  mocks.symptoms.mockResolvedValue([symptom])
  mocks.events.mockResolvedValue([])
  mocks.settings.mockResolvedValue({})
  mocks.print.mockResolvedValue({ uri: 'file:///printed.pdf' })
  mocks.readBuffer.mockResolvedValue(new Uint8Array([37, 80, 68, 70]).buffer)
})

afterEach(() => vi.useRealTimers())

describe('导出格式与重新导入契约', () => {
  it('CSV 带 BOM、三种状态、正确转义且只含注射记录', async () => {
    const file = await exportCsv()
    const csv = mocks.files.get(file.path) as string
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const rows = XLSX.utils.sheet_to_json<string[]>(XLSX.read(csv, { type: 'string' }).Sheets.Sheet1, { header: 1 })
    expect(rows).toHaveLength(4)
    expect(rows[0].at(-1)).toBe('状态')
    expect(rows.slice(1).map((row) => row.at(-1))).toEqual(['已用', '跳过', '漏用'])
    expect(rows[1][7]).toBe('含逗号,与"引号"\n第二行')
    expect(csv).not.toContain('验收口服药')
  })

  it('CSV 静脉输注不输出注射部位', async () => {
    const medications = await mocks.medications()
    medications[0].route = 'iv'
    const file = await exportCsv()
    const csv = mocks.files.get(file.path) as string
    expect(csv).not.toContain('腹部左上')
  })

  it('JSON 往返保留三种状态、药物扩展字段、零分疼痛和注射关联', async () => {
    const file = await exportJson()
    const text = mocks.files.get(file.path) as string
    const payload = parseImportJson(text)
    expect(payload.injections.map((log) => log.status)).toEqual(['done', 'skipped', 'missed'])
    expect(payload.oralLogs).toHaveLength(1)
    expect(payload.medications[0].extra).toEqual({ source: 'synthetic-test' })
    expect(payload.symptoms[0].painScore).toBe(0)
    expect(payload.symptoms[0].injectionAt).toBe(T0)
    expect(JSON.parse(text).exportedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('Excel 五张工作表可重新解析，状态与症状关联不丢失', async () => {
    const file = await exportExcel()
    const bytes = mocks.files.get(file.path) as ArrayBuffer
    const workbook = XLSX.read(bytes, { type: 'array' })
    expect(workbook.SheetNames).toEqual(['注射记录', '症状记录', '药物', '口服打卡', '用药线'])
    const payload = parseSpreadsheet(bytes)
    expect(payload.injections.map((log) => log.status)).toEqual(['done', 'skipped', 'missed'])
    expect(payload.symptoms[0].painScore).toBe(0)
    expect(payload.symptoms[0].injectionAt).toBe(T0)
    expect(payload.oralLogs).toHaveLength(1)
  })

  it('PDF 明确区分状态、保留医疗声明并转义用户输入', async () => {
    const file = await exportPdf({ patientName: '<script>alert(1)</script>' })
    const html = mocks.print.mock.calls[0][0].html as string
    expect(file.filename).toMatch(/\.pdf$/)
    expect(mocks.readBuffer).toHaveBeenCalledWith('file:///printed.pdf')
    expect(mocks.files.get(file.path)).toEqual(new Uint8Array([37, 80, 68, 70]))
    expect(html).toContain('<th>状态</th>')
    for (const status of ['已用', '跳过', '漏用']) expect(html).toContain(`<td>${status}</td>`)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('仅用于自我观察，不构成因果判断')
    expect(html).toContain('不构成医疗诊断或用药建议')
    expect(html).toContain('依从性统计（全部历史）')
  })

  it('PDF 按所选日期范围筛选记录，空表仍与状态列对齐', async () => {
    await exportPdf({ rangeDays: 1 })
    const html = mocks.print.mock.calls[0][0].html as string
    expect(html).toContain('colspan="8">该时间范围内暂无注射记录')
    expect(html).not.toContain('含逗号')
  })

  it('PDF 拒绝不合法的报告范围', async () => {
    await expect(exportPdf({ rangeDays: 0 })).rejects.toThrow('统计范围')
    expect(mocks.print).not.toHaveBeenCalled()
  })

  it('PDF 临时文件读取失败时保留已有报告', async () => {
    const file = await exportPdf()
    const existing = mocks.files.get(file.path)
    mocks.readBuffer.mockRejectedValueOnce(new Error('读取失败'))
    await expect(exportPdf()).rejects.toThrow('读取失败')
    expect(mocks.files.get(file.path)).toBe(existing)
  })
})
