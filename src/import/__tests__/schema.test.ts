import { describe, expect, it } from 'vitest'
import { parseImportJson, parseLocalDateTime } from '../schema'

const file = {
  format: 'bioclock-import',
  version: 1,
  injections: [
    {
      injectedAt: '2026-03-01 09:00',
      medication: '阿达木单抗',
      dose: 40,
      unit: 'mg',
      site: '腹部左上',
      lotNumber: 'AB123',
      note: '第一针',
    },
  ],
  symptoms: [
    {
      loggedAt: '2026-03-02 20:30',
      severity: 4,
      painScore: 6,
      tags: ['发热', '乏力', '发热'],
      temperature: 37.8,
      note: '晚上加重',
      injectionAt: '2026-03-01 09:00',
    },
  ],
}

describe('导入文件解析', () => {
  it('解析注射与症状记录，并把中文部位转成枚举', () => {
    const payload = parseImportJson(JSON.stringify(file))

    expect(payload.injections).toHaveLength(1)
    expect(payload.injections[0].site).toBe('abdomen_ul')
    expect(payload.injections[0].dose).toBe(40)
    expect(payload.injections[0].medicationName).toBe('阿达木单抗')

    expect(payload.symptoms).toHaveLength(1)
    expect(payload.symptoms[0].severity).toBe(4)
    expect(payload.symptoms[0].painScore).toBe(6)
    expect(payload.symptoms[0].tags).toEqual(['发热', '乏力'])
    expect(payload.symptoms[0].temperature).toBe(37.8)
    expect(payload.symptoms[0].injectionAt).toBe(
      parseLocalDateTime('2026-03-01 09:00', '时间'),
    )
  })

  it('允许只导入症状', () => {
    const payload = parseImportJson(
      JSON.stringify({ format: 'bioclock-import', version: 1, symptoms: [{ loggedAt: '2026-03-02 08:00' }] }),
    )
    expect(payload.injections).toHaveLength(0)
    expect(payload.symptoms[0].severity).toBe(3)
    expect(payload.symptoms[0].painScore).toBeNull()
    expect(payload.symptoms[0].tags).toEqual([])
  })

  it('接受 ISO 风格与斜杠日期', () => {
    expect(parseLocalDateTime('2026-03-01T09:05', '时间')).toBe(
      parseLocalDateTime('2026/3/1 9:05', '时间'),
    )
  })

  it('拒绝不存在的日期', () => {
    expect(() => parseLocalDateTime('2026-02-30 09:00', '时间')).toThrow(/真实存在/)
  })

  it('拒绝错误格式或版本', () => {
    expect(() => parseImportJson('{}')).toThrow(/format/)
    expect(() =>
      parseImportJson(JSON.stringify({ format: 'bioclock-import', version: 2, symptoms: [] })),
    ).toThrow(/版本/)
    expect(() => parseImportJson('not json')).toThrow(/JSON/)
    expect(() => parseImportJson('')).toThrow(/空的/)
  })

  it('拒绝越界的评分与错误部位，并给出行号', () => {
    const badSeverity = {
      format: 'bioclock-import',
      version: 1,
      symptoms: [{ loggedAt: '2026-03-02 08:00', severity: 6 }],
    }
    expect(() => parseImportJson(JSON.stringify(badSeverity))).toThrow(/第 1 条症状记录/)

    const badSite = {
      format: 'bioclock-import',
      version: 1,
      injections: [{ injectedAt: '2026-03-02 08:00', site: '屁股' }],
    }
    expect(() => parseImportJson(JSON.stringify(badSite))).toThrow(/注射部位/)
  })
})
