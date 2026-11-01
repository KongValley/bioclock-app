import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { parseSpreadsheet } from '../spreadsheet'

function workbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return wb
}

function toBytes(wb: XLSX.WorkBook): Uint8Array {
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('Excel 导入', () => {
  it('读取注射与症状两个工作表', () => {
    const wb = workbook({
      注射记录: [
        ['注射时间', '药物', '剂量', '单位', '部位', '批号', '备注'],
        ['2026-03-15 09:00', '阿达木单抗', 40, 'mg', '腹部左上', 'AB1', '第一针'],
        ['2026-03-29 09:10', '阿达木单抗', 40, 'mg', '左大腿', '', ''],
      ],
      症状记录: [
        ['记录时间', '严重程度', '疼痛评分', '症状', '体温(℃)', '备注', '关联注射时间'],
        ['2026-03-30 20:30', 4, 6, '发热、乏力', 37.8, '晚上加重', '2026-03-29 09:10'],
      ],
    })

    const payload = parseSpreadsheet(toBytes(wb))
    expect(payload.injections).toHaveLength(2)
    expect(payload.injections[0].site).toBe('abdomen_ul')
    expect(payload.injections[1].site).toBe('thigh_l')
    expect(payload.injections[1].lotNumber).toBeNull()

    expect(payload.symptoms).toHaveLength(1)
    expect(payload.symptoms[0].tags).toEqual(['发热', '乏力'])
    expect(payload.symptoms[0].painScore).toBe(6)
    expect(payload.symptoms[0].temperature).toBe(37.8)
    expect(payload.symptoms[0].injectionAt).toBe(payload.injections[1].injectedAt)
  })

  it('单表按表头自动识别为症状表', () => {
    const wb = workbook({
      Sheet1: [
        ['记录时间', '严重程度', '症状'],
        ['2026-03-30 20:30', 3, '头痛'],
      ],
    })
    const payload = parseSpreadsheet(toBytes(wb))
    expect(payload.injections).toHaveLength(0)
    expect(payload.symptoms).toHaveLength(1)
    expect(payload.symptoms[0].severity).toBe(3)
  })

  it('支持 Excel 日期序列号', () => {
    // 2026-03-15 09:00 的 Excel 序列号
    const serial = 46096 + 9 / 24
    const wb = workbook({
      注射记录: [
        ['注射时间', '药物'],
        [serial, '阿达木单抗'],
      ],
    })
    const payload = parseSpreadsheet(toBytes(wb))
    expect(new Date(payload.injections[0].injectedAt).getFullYear()).toBe(2026)
  })

  it('缺少必要表头时给出明确错误', () => {
    const wb = workbook({ 注射记录: [['药物', '剂量'], ['阿达木单抗', 40]] })
    expect(() => parseSpreadsheet(toBytes(wb))).toThrow(/注射时间/)
  })

  it('没有数据行时报错', () => {
    const wb = workbook({ 注射记录: [] })
    expect(() => parseSpreadsheet(toBytes(wb))).toThrow(/没有任何记录/)
  })
})
