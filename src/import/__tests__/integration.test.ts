import { randomUUID } from 'node:crypto'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREATE_TABLES_SQL } from '@/db/schema'
import { CATALOG_DRUGS } from '@/data/catalog'
import type { Treatment } from '@/types'
import { DAY, T0, makeInjectionLine } from '@/domain/__tests__/fixtures'
import { parseImportJson } from '../schema'

const connection = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('@/db', () => ({ getDatabase: async () => connection.database }))
vi.mock('expo-crypto', () => ({ randomUUID: () => randomUUID() }))

import { doseLogs, efficacyEvents, medications, symptoms, symptomTags, treatments } from '@/db/repo'
import { importPayload, previewImport } from '../index'

let sqlite: DatabaseSync
let treatment: Treatment

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec(CREATE_TABLES_SQL)
  // 仅替换 Expo 的数据库传输层；仓库 SQL、校验、映射及导入代码都实际执行。
  connection.database = {
    async getAllAsync(sql: string, ...params: Array<SQLInputValue | SQLInputValue[]>) { return sqlite.prepare(sql).all(...params.flat()) },
    async getFirstAsync(sql: string, ...params: Array<SQLInputValue | SQLInputValue[]>) { return sqlite.prepare(sql).get(...params.flat()) ?? null },
    async runAsync(sql: string, ...params: Array<SQLInputValue | SQLInputValue[]>) { return sqlite.prepare(sql).run(...params.flat()) },
    async execAsync(sql: string) { sqlite.exec(sql) },
    async withTransactionAsync(write: () => Promise<void>) {
      sqlite.exec('BEGIN')
      try {
        await write()
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  const medication = await medications.create({
    name: '验收注射药', genericName: '测试通用名', brandNames: ['测试商品名'],
    route: 'sc', defaultDose: 40, unit: 'mg', color: CATALOG_DRUGS[0].color, diseaseIds: [],
    catalogKey: null, isBuiltin: false, extra: {},
  })
  treatment = await treatments.create({ name: '验收方案', lines: [makeInjectionLine({ medicationId: medication.id })] })
  await treatments.setActive(treatment.id, true)
})

afterEach(() => {
  vi.restoreAllMocks()
  sqlite.close()
})

function payload(extra: Record<string, unknown> = {}) {
  return parseImportJson(JSON.stringify({
    format: 'bioclock-import', version: 3,
    injections: [{ injectedAt: '2026-01-05 09:00', medication: '测试商品名', status: 'done' }],
    symptoms: [{ loggedAt: '2026-01-05 20:00', severity: 2, tags: ['验收标签'], injectionAt: '2026-01-05 09:00' }],
    ...extra,
  }))
}

describe('真实 SQLite 导入集成', () => {
  it('预览不写库，实际落库数量一致，按药物别名匹配并关联症状', async () => {
    const input = payload()
    const preview = await previewImport(input)
    expect(await doseLogs.list()).toHaveLength(0)
    expect(await symptoms.list()).toHaveLength(0)
    expect(await importPayload(input)).toEqual(preview)
    const logs = await doseLogs.list()
    expect(logs).toHaveLength(1)
    expect(logs[0].lineId).toBe(treatment.lines[0].id)
    expect((await symptoms.list())[0].injectionId).toBe(logs[0].id)
    expect((await symptomTags.list()).map((tag) => tag.name)).toContain('验收标签')
  })

  it('重复导入不会增加打卡、症状或标签', async () => {
    const input = payload()
    await importPayload(input)
    const result = await importPayload(input)
    expect(result).toMatchObject({ injections: 0, symptoms: 0, tags: 0, skipped: 2 })
    expect(await doseLogs.list()).toHaveLength(1)
    expect(await symptoms.list()).toHaveLength(1)
    expect(await symptomTags.list()).toHaveLength(1)
  })

  it('自动创建口服用药线，预览与实际一致', async () => {
    const input = payload({
      medications: [{ name: '验收口服药', route: 'oral', unit: 'mg' }],
      oralLogs: [{ takenAt: '2026-01-06 09:00', medication: '验收口服药', status: 'done' }],
    })
    const preview = await previewImport(input)
    expect(preview).toMatchObject({ medicationsCreated: 1, linesCreated: 1, oralLogs: 1 })
    expect(await importPayload(input)).toEqual(preview)
    expect((await treatments.getActive())!.lines).toHaveLength(2)
  })

  it('标签补齐失败时回滚打卡、症状和新建药物/用药线', async () => {
    const input = payload({
      medications: [{ name: '验收口服药', route: 'oral', unit: 'mg' }],
      oralLogs: [{ takenAt: '2026-01-06 09:00', medication: '验收口服药', status: 'done' }],
    })
    vi.spyOn(symptomTags, 'ensure').mockRejectedValueOnce(new Error('标签写入失败'))
    await expect(importPayload(input)).rejects.toThrow('标签写入失败')
    expect(await doseLogs.list()).toHaveLength(0)
    expect(await symptoms.list()).toHaveLength(0)
    expect(await medications.list()).toHaveLength(1)
    expect((await treatments.getActive())!.lines).toHaveLength(1)
  })

  it('疗效事件用别名匹配，预览排除未匹配和重复事件，支持新建线', async () => {
    const input = payload({
      medications: [{ name: '验收口服药', route: 'oral', unit: 'mg' }],
      oralLogs: [{ takenAt: '2026-01-06 09:00', medication: '验收口服药', status: 'done' }],
      efficacyEvents: [
        { medication: '测试商品名', kind: 'other', occurredAt: '2026-01-06 10:00' },
        { medication: '测试商品名', kind: 'other', occurredAt: '2026-01-06 10:00' },
        { medication: '不存在的药', kind: 'other', occurredAt: '2026-01-06 10:00' },
        { medication: '验收口服药', kind: 'other', occurredAt: '2026-01-06 10:00' },
      ],
    })
    const preview = await previewImport(input)
    expect(preview.efficacyEvents).toBe(2)
    expect(await importPayload(input)).toEqual(preview)
    expect((await efficacyEvents.list()).map((event) => event.dosesCount)).toEqual([1, 1])
    expect((await previewImport(input)).efficacyEvents).toBe(0)
    expect((await importPayload(input)).efficacyEvents).toBe(0)
  })

  it('疗效写入失败时连同停用状态、标签和打卡一起回滚', async () => {
    const input = payload({
      lineStates: [{ medication: '测试商品名', kind: 'injection', endedAt: '2026-01-06 12:00' }],
      efficacyEvents: [{ medication: '测试商品名', kind: 'other', occurredAt: '2026-01-06 10:00' }],
    })
    vi.spyOn(efficacyEvents, 'create').mockRejectedValueOnce(new Error('事件写入失败'))
    await expect(importPayload(input)).rejects.toThrow('事件写入失败')
    expect((await treatments.getActive())!.lines[0].endedAt).toBeNull()
    expect(await doseLogs.list()).toHaveLength(0)
    expect(await symptoms.list()).toHaveLength(0)
    expect(await symptomTags.list()).toHaveLength(0)
  })

  it('停用线允许补录停用前历史，重复导入不建重复线也不恢复用药', async () => {
    await treatments.setLineEnded(treatment.lines[0].id, T0 + 2 * DAY)
    await importPayload(payload())
    const result = await importPayload(payload())
    expect(result).toMatchObject({ injections: 0, skipped: 2, linesCreated: 0 })
    const active = await treatments.getActive()
    expect(active!.lines).toHaveLength(1)
    expect(active!.lines[0].endedAt).toBe(T0 + 2 * DAY)
  })

  it('停用后的普通补录在预览阶段给出明确错误，不修改数据', async () => {
    await treatments.setLineEnded(treatment.lines[0].id, T0)
    await expect(previewImport(payload())).rejects.toThrow('已停用')
    expect(await doseLogs.list()).toHaveLength(0)
  })

  it('没有激活方案时拒绝含打卡的文件且不创建药物', async () => {
    await treatments.setActive(treatment.id, false)
    await expect(importPayload(payload())).rejects.toThrow('还没有治疗方案')
    expect(await doseLogs.list()).toHaveLength(0)
  })
})
