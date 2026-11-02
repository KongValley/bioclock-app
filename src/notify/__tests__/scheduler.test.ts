import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, DoseLog, ReminderRuleV5, Treatment } from '@/types'
import { DAY, T0, makeInjectionLine, makeLog, makeOralLine, makePhase } from '@/domain/__tests__/fixtures'

const native = vi.hoisted(() => ({
  channel: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
}))
const repo = vi.hoisted(() => ({
  treatment: vi.fn(), logs: vi.fn(), reminder: vi.fn(), settings: vi.fn(), medications: vi.fn(),
}))

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: native.channel,
  AndroidImportance: { HIGH: 4 },
  cancelAllScheduledNotificationsAsync: native.cancel,
  scheduleNotificationAsync: native.schedule,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}))
vi.mock('@/db/repo', () => ({
  treatments: { getActive: repo.treatment },
  doseLogs: { list: repo.logs },
  reminderRules: { getFor: repo.reminder },
  settings: { all: repo.settings },
  medications: { list: repo.medications },
}))

import { rescheduleAll } from '../scheduler'

const HOUR = 3_600_000
let treatment: Treatment
let logs: DoseLog[]
let reminder: ReminderRuleV5
let settings: AppSettings

function notifications() {
  return native.schedule.mock.calls.map(([request]) => request as {
    content: { title: string; body: string; data: { lineId: string; kind: string; plannedAt: number } }
    trigger: { date: Date }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0 + 7 * HOUR)
  vi.resetAllMocks()
  treatment = { id: 'treatment-1', name: '测试方案', isActive: true, createdAt: T0, lines: [makeInjectionLine()] }
  logs = []
  reminder = { id: 'r1', treatmentId: treatment.id, offsets: [0], timeOfDay: '09:00', snoozeMinutes: 10, enabled: true }
  settings = {}
  repo.treatment.mockImplementation(async () => treatment)
  repo.logs.mockImplementation(async () => logs)
  repo.reminder.mockImplementation(async () => reminder)
  repo.settings.mockImplementation(async () => settings)
  repo.medications.mockResolvedValue([])
  native.cancel.mockResolvedValue(undefined)
  native.channel.mockResolvedValue(null)
  native.schedule.mockResolvedValue('notification-id')
})

afterEach(() => vi.useRealTimers())

describe('本地通知排程（真实排程函数 + 系统通知适配器）', () => {
  it('备份恢复后也在替换通知前创建用药渠道', async () => {
    await rescheduleAll()
    expect(native.channel).toHaveBeenCalledWith('bioclock-reminders', { name: '用药提醒', importance: 4 })
    expect(native.channel.mock.invocationCallOrder[0]).toBeLessThan(native.cancel.mock.invocationCallOrder[0])
    expect(native.cancel.mock.invocationCallOrder[0]).toBeLessThan(native.schedule.mock.invocationCallOrder[0])
  })

  it('创建通知渠道失败时保留已有提醒', async () => {
    native.channel.mockRejectedValueOnce(new Error('创建渠道失败'))
    await expect(rescheduleAll()).rejects.toThrow('创建渠道失败')
    expect(native.cancel).not.toHaveBeenCalled()
    expect(native.schedule).not.toHaveBeenCalled()
  })

  it('为 14 天间隔的注射覆盖完整 8 周，包含当天补提醒', async () => {
    await rescheduleAll()
    const requests = notifications()
    expect(requests).toHaveLength(8)
    expect(requests.map((request) => request.content.data.plannedAt)).toContain(T0 + 42 * DAY)
    expect(requests.every((request) => request.trigger.date.getTime() > Date.now())).toBe(true)
  })

  it.each(['skipped', 'missed', 'done'] as const)('不为已登记 %s 的注射重复提醒', async (status) => {
    logs = [makeLog({ scheduledAt: T0, takenAt: status === 'done' ? T0 : null, status })]
    await rescheduleAll()
    expect(notifications().some((request) => request.content.data.plannedAt === T0)).toBe(false)
    expect(notifications().length).toBeGreaterThan(0)
  })

  it('提前跳过未来注射时也不生成该针的提前或当天提醒', async () => {
    logs = [
      makeLog({ scheduledAt: T0, takenAt: T0 }),
      makeLog({ scheduledAt: T0 + 14 * DAY, status: 'skipped' }),
    ]
    reminder.offsets = [-2, -1, 0]
    await rescheduleAll()
    expect(notifications().some((request) => request.content.data.plannedAt === T0 + 14 * DAY)).toBe(false)
  })

  it('当天口服提醒按免打扰顺延后判断是否过期', async () => {
    const line = makeOralLine({})
    line.oral!.remindTime = '06:00'
    treatment.lines = [line]
    await rescheduleAll()
    expect(notifications()[0].trigger.date.getTime()).toBe(T0 + 8 * HOUR)
  })

  it('免打扰导致跨日时丢弃提醒，避免次日仍提示今天用药', async () => {
    const line = makeOralLine({})
    line.oral!.remindTime = '23:00'
    treatment.lines = [line]
    await rescheduleAll()
    expect(notifications()).toHaveLength(0)
  })

  it('口服只预排包含今天的未来 14 天', async () => {
    treatment.lines = [makeOralLine({})]
    await rescheduleAll()
    const requests = notifications()
    expect(requests).toHaveLength(14)
    expect(requests.at(-1)!.trigger.date.getTime()).toBe(T0 + 13 * DAY + 9 * HOUR)
  })

  it('未来已跳过的口服打卡不重复提醒', async () => {
    treatment.lines = [makeOralLine({})]
    logs = [makeLog({ lineId: 'line-oral', scheduledAt: T0 + DAY, status: 'skipped' })]
    await rescheduleAll()
    expect(notifications().some((request) => request.content.data.plannedAt === T0 + DAY)).toBe(false)
  })

  it('相同时刻的口服药合并，不同时刻分别保留', async () => {
    const later = makeOralLine({ id: 'later', medicationId: 'm3', label: '晚间药物' })
    later.oral!.remindTime = '18:00'
    treatment.lines = [
      makeOralLine({ label: '药物 A' }),
      makeOralLine({ id: 'other', medicationId: 'm2', label: '药物 B' }),
      later,
    ]
    await rescheduleAll()
    const today = notifications().filter((request) => request.content.data.plannedAt === T0)
    expect(today).toHaveLength(2)
    expect(today[0].content.body).toContain('药物 A、药物 B')
    expect(today[1].trigger.date.getTime()).toBe(T0 + 18 * HOUR)
  })

  it('关闭提醒总开关后注射和口服都取消', async () => {
    treatment.lines.push(makeOralLine({}))
    reminder.enabled = false
    expect(await rescheduleAll()).toEqual({ scheduled: 0 })
    expect(native.cancel).toHaveBeenCalledOnce()
    expect(native.schedule).not.toHaveBeenCalled()
  })

  it('最多 60 条且优先保留注射提醒', async () => {
    treatment.lines = [makeInjectionLine({ phases: [makePhase({ orderIdx: 0, intervalDays: 1 })] }), makeOralLine({})]
    expect(await rescheduleAll()).toEqual({ scheduled: 60 })
    expect(notifications().every((request) => request.content.data.kind === 'injection')).toBe(true)
  })

  it('读取数据失败时保留系统已有提醒', async () => {
    repo.logs.mockRejectedValueOnce(new Error('读取失败'))
    await expect(rescheduleAll()).rejects.toThrow('读取失败')
    expect(native.cancel).not.toHaveBeenCalled()
  })

  it('过期的并发排程请求被合并，只应用最新请求', async () => {
    await Promise.all([rescheduleAll(), rescheduleAll(), rescheduleAll()])
    expect(native.cancel).toHaveBeenCalledOnce()
    expect(notifications()).toHaveLength(8)
  })

  it('单条排程失败会继续处理并返回警告所需的错误', async () => {
    native.schedule.mockRejectedValueOnce(new Error('系统拒绝'))
    await expect(rescheduleAll()).rejects.toThrow('有 1 条提醒未能排程')
    expect(native.schedule).toHaveBeenCalledTimes(8)
  })

  it('没有激活方案时清除旧提醒', async () => {
    repo.treatment.mockResolvedValue(null)
    expect(await rescheduleAll()).toEqual({ scheduled: 0 })
    expect(native.cancel).toHaveBeenCalledOnce()
  })
})
