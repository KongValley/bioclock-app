import { describe, expect, it } from 'vitest'
import { parseImportJson, parseLocalDateTime } from '../schema'

const fileV2 = {
  format: 'bioclock-import',
  version: 2,
  medications: [
    {
      name: '甲氨蝶呤',
      genericName: '甲氨蝶呤',
      brandNames: ['MTX', '氨甲蝶呤'],
      route: 'oral',
      defaultDose: 10,
      unit: 'mg',
      catalogKey: null,
    },
  ],
  injections: [
    {
      injectedAt: '2026-03-01 09:00',
      medication: '阿达木单抗',
      dose: 40,
      unit: 'mg',
      site: '腹部左上',
      lotNumber: 'AB123',
      note: '第一针',
      status: 'done',
      lineLabel: '阿达木单抗',
    },
    {
      injectedAt: '2026-03-15 09:00',
      medication: '阿达木单抗',
      status: 'skipped',
    },
  ],
  oralLogs: [
    {
      takenAt: '2026-03-02 08:00',
      medication: '甲氨蝶呤',
      status: 'done',
      dose: 10,
      unit: 'mg',
      note: '早餐后',
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

describe('导入文件解析（v2）', () => {
  it('解析药物、注射、口服与症状记录', () => {
    const payload = parseImportJson(JSON.stringify(fileV2))

    expect(payload.medications).toHaveLength(1)
    expect(payload.medications[0].name).toBe('甲氨蝶呤')
    expect(payload.medications[0].route).toBe('oral')
    expect(payload.medications[0].brandNames).toEqual(['MTX', '氨甲蝶呤'])
    expect(payload.medications[0].defaultDose).toBe(10)

    expect(payload.injections).toHaveLength(2)
    expect(payload.injections[0].site).toBe('abdomen_ul')
    expect(payload.injections[0].dose).toBe(40)
    expect(payload.injections[0].medicationName).toBe('阿达木单抗')
    expect(payload.injections[0].status).toBe('done')
    expect(payload.injections[0].lineLabel).toBe('阿达木单抗')
    expect(payload.injections[1].status).toBe('skipped')
    expect(payload.injections[1].lineLabel).toBeNull()

    expect(payload.oralLogs).toHaveLength(1)
    expect(payload.oralLogs[0].medicationName).toBe('甲氨蝶呤')
    expect(payload.oralLogs[0].status).toBe('done')
    expect(payload.oralLogs[0].takenAt).toBe(parseLocalDateTime('2026-03-02 08:00', '时间'))

    expect(payload.symptoms).toHaveLength(1)
    expect(payload.symptoms[0].severity).toBe(4)
    expect(payload.symptoms[0].painScore).toBe(6)
    expect(payload.symptoms[0].tags).toEqual(['发热', '乏力'])
    expect(payload.symptoms[0].temperature).toBe(37.8)
    expect(payload.symptoms[0].injectionAt).toBe(
      parseLocalDateTime('2026-03-01 09:00', '时间'),
    )
  })

  it('接受 v1 文件（没有 medications / oralLogs，注射也没有 status）', () => {
    const payload = parseImportJson(
      JSON.stringify({
        format: 'bioclock-import',
        version: 1,
        injections: [{ injectedAt: '2026-03-01 09:00', medication: '阿达木单抗' }],
        symptoms: [{ loggedAt: '2026-03-02 08:00' }],
      }),
    )
    expect(payload.medications).toHaveLength(0)
    expect(payload.oralLogs).toHaveLength(0)
    expect(payload.injections[0].status).toBe('done')
    expect(payload.injections[0].lineLabel).toBeNull()
    expect(payload.symptoms[0].severity).toBe(3)
    expect(payload.symptoms[0].painScore).toBeNull()
    expect(payload.symptoms[0].tags).toEqual([])
  })

  it('口服打卡接受 loggedAt 别名，默认状态为已完成', () => {
    const payload = parseImportJson(
      JSON.stringify({
        format: 'bioclock-import',
        version: 2,
        oralLogs: [{ loggedAt: '2026-03-02 08:00', medication: '甲氨蝶呤' }],
      }),
    )
    expect(payload.oralLogs[0].status).toBe('done')
    expect(payload.oralLogs[0].takenAt).toBe(
      parseLocalDateTime('2026-03-02 08:00', '时间'),
    )
  })

  it('给药途径支持中英文别名', () => {
    const payload = parseImportJson(
      JSON.stringify({
        format: 'bioclock-import',
        version: 2,
        medications: [
          { name: 'A', route: '皮下注射' },
          { name: 'B', route: 'IV' },
        ],
      }),
    )
    expect(payload.medications[0].route).toBe('sc')
    expect(payload.medications[1].route).toBe('iv')
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
      parseImportJson(JSON.stringify({ format: 'bioclock-import', version: 99, symptoms: [] })),
    ).toThrow(/版本/)
    expect(() => parseImportJson('not json')).toThrow(/JSON/)
    expect(() => parseImportJson('')).toThrow(/空的/)
  })

  it('拒绝越界的评分、错误部位与错误途径，并给出行号', () => {
    const badSeverity = {
      format: 'bioclock-import',
      version: 2,
      symptoms: [{ loggedAt: '2026-03-02 08:00', severity: 6 }],
    }
    expect(() => parseImportJson(JSON.stringify(badSeverity))).toThrow(/第 1 条症状记录/)

    const badSite = {
      format: 'bioclock-import',
      version: 2,
      injections: [{ injectedAt: '2026-03-02 08:00', site: '屁股' }],
    }
    expect(() => parseImportJson(JSON.stringify(badSite))).toThrow(/注射部位/)

    const badRoute = {
      format: 'bioclock-import',
      version: 2,
      medications: [{ name: '某药', route: '鼻喷' }],
    }
    expect(() => parseImportJson(JSON.stringify(badRoute))).toThrow(/给药途径/)
  })

  it('解析 v3 的用药线状态与疗效记录', () => {
    const payload = parseImportJson(
      JSON.stringify({
        format: 'bioclock-import',
        version: 3,
        lineStates: [
          { lineLabel: '阿达木单抗', medication: '阿达木单抗', kind: 'injection', endedAt: '2026-03-02 08:00' },
        ],
        efficacyEvents: [
          {
            lineLabel: '阿达木单抗',
            medication: '阿达木单抗',
            kind: 'failed',
            occurredAt: '2026-03-02 09:00',
            note: '医生评估后换药',
          },
        ],
      }),
    )

    expect(payload.lineStates[0].kind).toBe('injection')
    expect(payload.lineStates[0].endedAt).toBe(parseLocalDateTime('2026-03-02 08:00', '时间'))
    expect(payload.efficacyEvents[0].kind).toBe('failed')
    expect(payload.efficacyEvents[0].occurredAt).toBe(
      parseLocalDateTime('2026-03-02 09:00', '时间'),
    )
  })
})
