import { describe, expect, it } from 'vitest'
import {
  isTransferFile,
  summarizeTransfer,
  transferToImportPayload,
} from '../transferSchema'

/**
 * 换机快照的解析部分不依赖 expo 原生模块（只有导出函数会用到），
 * 所以这里直接对纯函数做测试。
 */

const base = {
  format: 'bioclock-transfer',
  version: 1,
  schemaVersion: 7,
  exportedAt: 1_760_000_000_000,
  app: 'BioClock',
  medications: [
    {
      id: 'm1',
      name: '阿达木单抗',
      genericName: '阿达木单抗',
      brandNames: ['修美乐'],
      defaultDose: 40,
      unit: 'mg',
      color: '#2B6CB0',
      route: 'sc',
      diseaseIds: ['crohn'],
      catalogKey: 'adalimumab',
      isBuiltin: true,
      extra: {},
    },
  ],
  treatments: [
    {
      id: 't1',
      name: '阿达木单抗',
      isActive: true,
      createdAt: 1,
      lines: [
        {
          id: 'l1',
          medicationId: 'm1',
          kind: 'injection',
          label: '阿达木单抗',
          isHost: true,
          syncWithHost: false,
          anchor: 'actual',
          windowDays: 2,
          endedAt: null,
          phases: [
            {
              orderIdx: 0,
              kind: 'maintenance',
              intervalDays: 42,
              repeatCount: 0,
              dose: 40,
              unit: 'mg',
              effectiveFrom: null,
            },
          ],
          oral: null,
        },
      ],
    },
  ],
  doseLogs: [
    {
      lineId: 'l1',
      scheduledAt: 1_759_000_000_000,
      takenAt: 1_759_000_000_000,
      status: 'done',
      dose: 40,
      unit: 'mg',
      site: 'abdomen_ul',
      lotNumber: null,
      note: null,
      createdAt: 1_759_000_000_000,
      updatedAt: 1_759_000_000_000,
    },
  ],
  symptoms: [
    {
      loggedAt: 1_759_100_000_000,
      severity: 2,
      painScore: 3,
      tags: ['乏力'],
      note: null,
      temperature: null,
      doseIndex: 0,
    },
  ],
  efficacyEvents: [
    {
      lineId: 'l1',
      kind: 'reduced',
      occurredAt: 1_759_200_000_000,
      dosesCount: 1,
      note: '疗效下降',
      createdAt: 1_759_200_000_000,
    },
  ],
  symptomTags: [{ name: '乏力', isBuiltin: false, sortOrder: 99 }],
  reminders: [
    {
      treatmentId: 't1',
      offsets: [-2, -1, 0],
      timeOfDay: '09:00',
      snoozeMinutes: 10,
      enabled: true,
    },
  ],
  settings: { on_boarded_at: '1' },
}

const text = JSON.stringify(base)

describe('换机快照', () => {
  it('识别换机文件', () => {
    expect(isTransferFile(text)).toBe(true)
    expect(isTransferFile(JSON.stringify({ format: 'bioclock-import', version: 3 }))).toBe(false)
    expect(isTransferFile('不是 JSON')).toBe(false)
  })

  it('转换成可导入的 v3 负载，保留打卡、症状关联、停用状态和疗效记录', () => {
    const payload = transferToImportPayload(text)

    expect(payload.injections).toHaveLength(1)
    expect(payload.injections[0].lineLabel).toBe('阿达木单抗')
    expect(payload.injections[0].injectedAt).toBe(1_759_000_000_000)
    expect(payload.symptoms[0].injectionAt).toBe(1_759_000_000_000)
    expect(payload.lineStates[0].kind).toBe('injection')
    expect(payload.efficacyEvents[0].kind).toBe('reduced')
    expect(payload.medications[0].catalogKey).toBe('adalimumab')
  })

  it('生成的负载包含换机所需的打卡、停用状态和疗效记录', () => {
    const payload = transferToImportPayload(text)

    expect(payload.lineStates).toHaveLength(1)
    expect(payload.efficacyEvents).toHaveLength(1)
    expect(payload.symptoms[0].tags).toEqual(['乏力'])
  })

  it('统计用于确认弹窗的数量', () => {
    expect(summarizeTransfer(text)).toMatchObject({
      doses: 1,
      symptoms: 1,
      efficacyEvents: 1,
      schemaVersion: 7,
    })
  })

  it('拒绝非换机文件', () => {
    expect(() => transferToImportPayload(JSON.stringify({ format: 'other' }))).toThrow(/换机/)
  })

  it('done 打卡保留原始计划时间', () => {
    const scheduledAt = 1_759_050_000_000
    const takenAt = 1_759_100_000_000
    const text = JSON.stringify({
      ...base,
      doseLogs: [{ ...base.doseLogs[0], scheduledAt, takenAt }],
    })

    const payload = transferToImportPayload(text)
    expect(payload.injections[0].injectedAt).toBe(takenAt)
    expect(payload.injections[0].scheduledAt).toBe(scheduledAt)
  })

  it('保留 skipped/missed 打卡的计划时间与空部位', () => {
    const skippedAt = 1_759_300_000_000
    const text = JSON.stringify({
      ...base,
      doseLogs: [
        {
          ...base.doseLogs[0],
          scheduledAt: skippedAt,
          takenAt: skippedAt + 3_600_000,
          status: 'skipped',
          site: null,
        },
      ],
      symptoms: [{ ...base.symptoms[0], doseIndex: 0 }],
    })

    const payload = transferToImportPayload(text)
    expect(payload.injections).toHaveLength(1)
    expect(payload.injections[0].injectedAt).toBe(skippedAt)
    expect(payload.injections[0].scheduledAt).toBe(skippedAt)
    expect(payload.injections[0].status).toBe('skipped')
    expect(payload.injections[0].site).toBeNull()
    expect(payload.symptoms[0].injectionAt).toBe(skippedAt)
  })

  it('保留口服跳过记录的计划时间', () => {
    const skippedAt = 1_759_400_000_000
    const text = JSON.stringify({
      ...base,
      treatments: [
        {
          ...base.treatments[0],
          lines: [
            ...base.treatments[0].lines,
            {
              id: 'l2',
              medicationId: 'm1',
              kind: 'oral',
              label: '口服用药线',
              isHost: false,
              syncWithHost: false,
              anchor: 'planned',
              windowDays: 0,
              endedAt: null,
              phases: [],
              oral: {
                startDate: skippedAt,
                durationDays: null,
                frequency: 'daily',
                timesPerPeriod: 1,
                daysOfWeek: [],
                remindTime: '09:00',
              },
            },
          ],
        },
      ],
      doseLogs: [
        ...base.doseLogs,
        {
          ...base.doseLogs[0],
          lineId: 'l2',
          scheduledAt: skippedAt,
          takenAt: null,
          status: 'skipped',
        },
      ],
    })

    const payload = transferToImportPayload(text)
    expect(payload.oralLogs).toHaveLength(1)
    expect(payload.oralLogs[0].takenAt).toBe(skippedAt)
    expect(payload.oralLogs[0].scheduledAt).toBe(skippedAt)
    expect(payload.oralLogs[0].status).toBe('skipped')
  })

  it('恢复未被症状引用的自定义症状标签', () => {
    const text = JSON.stringify({
      ...base,
      symptomTags: [
        { name: '乏力', isBuiltin: false, sortOrder: 99 },
        { name: '夜间咳嗽', isBuiltin: false, sortOrder: 100 },
      ],
    })
    expect(transferToImportPayload(text).symptomTags).toEqual(['乏力', '夜间咳嗽'])
  })

  it('拒绝来自更新版本的备份，并给出中文错误', () => {
    expect(() =>
      transferToImportPayload(JSON.stringify({ ...base, schemaVersion: 8 })),
    ).toThrow(/更新版本的 BioClock/)
    expect(() =>
      transferToImportPayload(JSON.stringify({ ...base, schemaVersion: undefined })),
    ).toThrow(/数据库版本/)
    expect(() =>
      transferToImportPayload(JSON.stringify({ ...base, doseLogs: undefined })),
    ).toThrow(/打卡记录/)
  })
})
