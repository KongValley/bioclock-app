import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { injections, medications, regimens, reminderRules, settings } from '@/db/repo'
import type { AppSettings, Injection, Medication, Regimen, ReminderRule } from '@/types'
import { buildSchedule } from '@/domain/schedule'
import type { DosePlan } from '@/domain/schedule'
import { buildReminderContent, NOTIFY_PREP_HINT } from './content'

export { NOTIFY_PREP_HINT }

const REMINDER_CHANNEL_ID = 'bioclock-reminders'
const SCHEDULE_WINDOW_DAYS = 56
const MAX_SCHEDULED_NOTIFICATIONS = 60
const EVENING_CATCH_UP_MINUTES = 20 * 60
const DEFAULT_REMINDER_MINUTES = 9 * 60
const DEFAULT_DND_START = '22:00'
const DEFAULT_DND_END = '08:00'
const DAY_MS = 24 * 60 * 60 * 1000

interface DndWindow {
  startMinutes: number
  endMinutes: number
}

interface ReminderDraft {
  regimenId: string
  plannedAt: number
  triggerAt: number
  title: string
  body: string
}

/**
 * 申请通知权限，并确保 Android 通知渠道存在。
 * exactAlarm 表示系统是否允许精确闹钟；无法可靠检测时返回 false，不抛错。
 */
export async function ensurePermissions(): Promise<{ granted: boolean; exactAlarm: boolean }> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: '用药提醒',
      importance: Notifications.AndroidImportance.HIGH,
    })
  }

  let permission = await Notifications.getPermissionsAsync()
  let granted = isNotificationGranted(permission)
  if (!granted) {
    permission = await Notifications.requestPermissionsAsync()
    granted = isNotificationGranted(permission)
  }

  const exactAlarm = await detectExactAlarm()
  return { granted, exactAlarm }
}

/**
 * 清空后按「未来 8 周」重新排程。
 * 返回实际写入系统的通知条数（不会超过 60 条）。
 */
export async function rescheduleAll(): Promise<{ scheduled: number }> {
  await cancelAll()

  const regimen = await regimens.listActive()
  if (!regimen) return { scheduled: 0 }

  const [regimenInjections, reminder, appSettings, medication] = await Promise.all([
    injections.list(regimen.id),
    reminderRules.getFor(regimen.id),
    settings.all(),
    medications.get(regimen.medicationId),
  ])

  if (!reminder || !reminder.enabled || reminder.offsets.length === 0) {
    return { scheduled: 0 }
  }

  const now = Date.now()
  const horizon = now + SCHEDULE_WINDOW_DAYS * DAY_MS
  const plans = collectPlansThrough(regimen, regimenInjections, now, horizon).filter(
    (plan) => plan.status !== 'done' && plan.plannedAt <= horizon,
  )

  const drafts = buildDrafts({
    plans,
    reminder,
    medication,
    regimenId: regimen.id,
    regimenName: regimen.name,
    now,
    dnd: resolveDndWindow(appSettings),
  })

  drafts.sort((a, b) => a.triggerAt - b.triggerAt || a.plannedAt - b.plannedAt)
  const limited = drafts.slice(0, MAX_SCHEDULED_NOTIFICATIONS)

  for (const draft of limited) {
    await scheduleDraft(draft)
  }

  return { scheduled: limited.length }
}

export async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync()
}

/**
 * 契约中的 buildSchedule 只返回「历史 + 未来 2 针」，不足以覆盖 8 周。
 * 若末尾计划还没到 horizon，则以 horizon 为 now 再取一次，并按稳定的 index 合并。
 */
function collectPlansThrough(
  regimen: Regimen,
  regimenInjections: Injection[],
  now: number,
  horizon: number,
): DosePlan[] {
  const plans = buildSchedule({ regimen, injections: regimenInjections, now })
  const last = plans[plans.length - 1]
  if (!last || last.plannedAt >= horizon) return plans

  const extended = buildSchedule({ regimen, injections: regimenInjections, now: horizon })
  const byIndex = new Map<number, DosePlan>()
  for (const plan of plans) byIndex.set(plan.index, plan)
  for (const plan of extended) {
    if (!byIndex.has(plan.index)) byIndex.set(plan.index, plan)
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index)
}

function buildDrafts(input: {
  plans: ReturnType<typeof buildSchedule>
  reminder: ReminderRule
  medication: Medication | null
  regimenId: string
  regimenName: string
  now: number
  dnd: DndWindow
}): ReminderDraft[] {
  const { plans, reminder, medication, regimenId, regimenName, now, dnd } = input
  const reminderMinutes = parseTimeOfDay(reminder.timeOfDay, DEFAULT_REMINDER_MINUTES)
  const offsets = Array.from(new Set(reminder.offsets.filter((offset) => Number.isInteger(offset)))).sort(
    (a, b) => a - b,
  )
  const medicationName = medication?.name ?? regimenName
  const route = medication?.route ?? 'sc'

  const drafts: ReminderDraft[] = []
  const seen = new Set<string>()

  for (const plan of plans) {
    for (const offset of offsets) {
      const day = addLocalDays(plan.plannedAt, offset)
      const rawTriggerAt = atLocalMinutes(day, reminderMinutes)
      const triggerAt = shiftOutOfDnd(rawTriggerAt, dnd)
      if (triggerAt <= now || !claimDraftKey(seen, plan.plannedAt, triggerAt)) continue

      const content = buildReminderContent({
        medicationName,
        dose: plan.dose,
        unit: plan.unit,
        offsetDays: Math.abs(offset),
        route,
      })
      drafts.push({
        regimenId,
        plannedAt: plan.plannedAt,
        triggerAt,
        title: content.title,
        body: content.body,
      })
    }

    // 注射日当天 20:00 的「仍未登记」补提醒。
    if (offsets.includes(0)) {
      const rawTriggerAt = atLocalMinutes(plan.plannedAt, EVENING_CATCH_UP_MINUTES)
      const triggerAt = shiftOutOfDnd(rawTriggerAt, dnd)
      if (triggerAt > now && claimDraftKey(seen, plan.plannedAt, triggerAt)) {
        const content = buildReminderContent({
          medicationName,
          dose: plan.dose,
          unit: plan.unit,
          offsetDays: 0,
          isSameDayEvening: true,
          route,
        })
        drafts.push({
          regimenId,
          plannedAt: plan.plannedAt,
          triggerAt,
          title: content.title,
          body: content.body,
        })
      }
    }
  }

  return drafts
}

async function scheduleDraft(draft: ReminderDraft): Promise<void> {
  const trigger: Notifications.DateTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(draft.triggerAt),
    ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: draft.title,
      body: draft.body,
      data: {
        type: 'dose',
        regimenId: draft.regimenId,
        plannedAt: draft.plannedAt,
      },
    },
    trigger,
  })
}

function isNotificationGranted(
  permission: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>,
): boolean {
  if (permission.granted) return true
  const iosStatus = permission.ios?.status
  return (
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  )
}

async function detectExactAlarm(): Promise<boolean> {
  if (Platform.OS !== 'android') return true

  try {
    const permission = await Notifications.getExactAlarmPermissionsAsync()
    return permission.granted
  } catch {
    // 部分定制 ROM 或旧原生模块没有该能力。无法可靠探测时按不可用处理，
    // 由调用方提示用户到系统设置中检查，避免在排程路径上抛错。
    return false
  }
}

function resolveDndWindow(appSettings: AppSettings): DndWindow {
  return {
    startMinutes: parseTimeOfDay(appSettings.dnd_start ?? DEFAULT_DND_START, 22 * 60),
    endMinutes: parseTimeOfDay(appSettings.dnd_end ?? DEFAULT_DND_END, 8 * 60),
  }
}

function parseTimeOfDay(value: string, fallbackMinutes: number): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!match) return fallbackMinutes
  return Number(match[1]) * 60 + Number(match[2])
}

/** 落在免打扰区间内的提醒顺延到区间结束；跨午夜的区间按两段处理。 */
function shiftOutOfDnd(timestamp: number, dnd: DndWindow): number {
  const start = dnd.startMinutes
  const end = dnd.endMinutes
  if (start === end) return timestamp

  const date = new Date(timestamp)
  const minutes = date.getHours() * 60 + date.getMinutes()

  if (start < end) {
    if (minutes >= start && minutes < end) {
      return atLocalMinutes(timestamp, end)
    }
    return timestamp
  }

  if (minutes >= start) {
    return atLocalMinutes(addLocalDays(timestamp, 1), end)
  }
  if (minutes < end) {
    return atLocalMinutes(timestamp, end)
  }
  return timestamp
}

function atLocalMinutes(timestamp: number, minutesOfDay: number): number {
  const date = new Date(timestamp)
  date.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0)
  return date.getTime()
}

function addLocalDays(timestamp: number, days: number): number {
  const date = new Date(timestamp)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

function claimDraftKey(seen: Set<string>, plannedAt: number, triggerAt: number): boolean {
  const key = `${plannedAt}|${triggerAt}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
