import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { zh } from '@/i18n/zh'
import { doseLogs, medications, reminderRules, settings, treatments } from '@/db/repo'
import type {
  AppSettings,
  DoseLog,
  Medication,
  ReminderRuleV5,
  Treatment,
  TreatmentLine,
} from '@/types'
import { buildSchedule, futureDoseCountForHorizon, ORAL_HORIZON_DAYS } from '@/domain/schedule'
import type { SchedulePlan } from '@/domain/schedule'
import { buildReminderContent, NOTIFY_PREP_HINT } from './content'

export { NOTIFY_PREP_HINT }

const REMINDER_CHANNEL_ID = 'bioclock-reminders'
const SCHEDULE_WINDOW_DAYS = 56
// iOS 单 App 待发本地通知约 64 条；留一点余量，优先保证注射提醒。
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
  /** 注射线用计划针所在的 lineId；合并的口服提醒用当天第一条线的 id */
  lineId: string
  kind: 'injection' | 'oral'
  plannedAt: number
  triggerAt: number
  title: string
  body: string
}

/** 幂等创建通知渠道；恢复备份或冷启动排程时无需重复弹出权限请求。 */
async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: zh.notify.channelName,
      importance: Notifications.AndroidImportance.HIGH,
    })
  }
}

/** 申请通知权限；无法可靠检测精确闹钟权限时返回 false。 */
export async function ensurePermissions(): Promise<{ granted: boolean; exactAlarm: boolean }> {
  await ensureReminderChannel()

  let permission = await Notifications.getPermissionsAsync()
  let granted = isNotificationGranted(permission)
  if (!granted) {
    permission = await Notifications.requestPermissionsAsync()
    granted = isNotificationGranted(permission)
  }

  let exactAlarm = await detectExactAlarm()
  if (!exactAlarm) {
    try {
      const requested = await Notifications.requestExactAlarmPermissionsAsync()
      exactAlarm = requested.granted
    } catch {
      // 部分系统/旧版本没有这个能力，保持 false，由调用方提示用户去系统设置。
    }
  }
  return { granted, exactAlarm }
}

/**
 * 清空后按「未来 8 周」重新排程。
 *
 * - 注射线：按 `buildSchedule` 的下一针，用 treatment 级 reminderRules 的偏移（提前 N 天 + 当天）。
 * - 口服线：覆盖含当天的 14 天，每天在 oral.remindTime 提醒；同一天同一时间合并。
 *
 * 返回实际写入系统的通知条数（不会超过 60 条）。
 */
let rescheduleQueue: Promise<unknown> = Promise.resolve()
let rescheduleGeneration = 0

export function rescheduleAll(): Promise<{ scheduled: number }> {
  const generation = ++rescheduleGeneration
  const run = rescheduleQueue
    .catch(() => undefined)
    .then(() => runReschedule(generation))
  rescheduleQueue = run.catch(() => undefined)
  return run
}

async function runReschedule(generation: number): Promise<{ scheduled: number }> {
  if (generation !== rescheduleGeneration) return { scheduled: 0 }

  const treatment = await treatments.getActive()
  if (!treatment) {
    if (generation === rescheduleGeneration) await cancelAll()
    return { scheduled: 0 }
  }

  const [logs, reminder, appSettings, allMedications] = await Promise.all([
    doseLogs.list(),
    reminderRules.getFor(treatment.id),
    settings.all(),
    medications.list(),
  ])

  const now = Date.now()
  const horizon = now + SCHEDULE_WINDOW_DAYS * DAY_MS
  const plans = collectPlansThrough(treatment, logs, now, horizon)
  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const lineById = new Map(treatment.lines.map((line) => [line.id, line]))
  const dnd = resolveDndWindow(appSettings)

  const injectionDrafts =
    reminder && reminder.enabled && reminder.offsets.length > 0
      ? buildInjectionDrafts({
          plans,
          lines: lineById,
          reminder,
          medicationById,
          treatmentName: treatment.name,
          now,
          horizon,
          dnd,
        })
      : []

  // 提醒总开关关闭时，口服也不再推送。
  const oralDrafts =
    reminder?.enabled === false
      ? []
      : buildOralDrafts({
          plans,
          lines: lineById,
          medicationById,
          now,
          horizon,
          dnd,
        })

  injectionDrafts.sort((a, b) => a.triggerAt - b.triggerAt)
  oralDrafts.sort((a, b) => a.triggerAt - b.triggerAt)

  // 先保证注射提醒，再用剩余额度排口服；超出 iOS 64 条时不会把注射挤掉。
  const limitedInjections = injectionDrafts.slice(0, MAX_SCHEDULED_NOTIFICATIONS)
  const remaining = Math.max(0, MAX_SCHEDULED_NOTIFICATIONS - limitedInjections.length)
  const limited = [...limitedInjections, ...oralDrafts.slice(0, remaining)].sort(
    (a, b) => a.triggerAt - b.triggerAt || a.plannedAt - b.plannedAt,
  )

  // 读库或计算失败时保留已有提醒；只有新草稿准备好后才替换。
  // 备份恢复会跳过引导的权限步骤，也必须先建立渠道再排程。
  if (limited.length > 0) await ensureReminderChannel()
  if (generation !== rescheduleGeneration) return { scheduled: 0 }
  await cancelAll()

  let failed = 0
  for (const draft of limited) {
    if (generation !== rescheduleGeneration) return { scheduled: 0 }
    try {
      await scheduleDraft(draft)
    } catch {
      failed += 1
    }
  }

  if (failed > 0) {
    throw new Error(`有 ${failed} 条提醒未能排程，请检查系统通知权限`)
  }
  return { scheduled: limited.length }
}

export async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync()
}

/**
 * buildSchedule 默认只返回「历史 + 未来 2 针」，不足以覆盖 8 周。
 * 这里按所有注射线的最短间隔算出需要多少未来针，确保 14/7 天间隔的药
 * 也能排满整个通知窗口。
 */
function collectPlansThrough(
  treatment: Treatment,
  logs: DoseLog[],
  now: number,
  horizon: number,
): SchedulePlan[] {
  const horizonDays = Math.max(
    ORAL_HORIZON_DAYS,
    Math.ceil((horizon - now) / DAY_MS) + ORAL_HORIZON_DAYS,
  )
  return buildSchedule({
    lines: treatment.lines,
    logs,
    now,
    horizonDays: ORAL_HORIZON_DAYS - 1,
    futureDoseCount: futureDoseCountForHorizon(treatment.lines, horizonDays),
  })
}

function buildInjectionDrafts(input: {
  plans: SchedulePlan[]
  lines: Map<string, TreatmentLine>
  reminder: ReminderRuleV5
  medicationById: Map<string, Medication>
  treatmentName: string
  now: number
  horizon: number
  dnd: DndWindow
}): ReminderDraft[] {
  const { plans, lines, reminder, medicationById, treatmentName, now, horizon, dnd } = input
  const reminderMinutes = parseTimeOfDay(reminder.timeOfDay, DEFAULT_REMINDER_MINUTES)
  const offsets = Array.from(
    new Set(reminder.offsets.filter((offset) => Number.isInteger(offset))),
  ).sort((a, b) => a - b)

  const drafts: ReminderDraft[] = []
  const seen = new Set<string>()

  for (const plan of plans) {
    if (plan.kind !== 'injection') continue
    // skipped 的未来计划仍标记 upcoming，必须同时检查是否已有打卡记录。
    if (plan.doseLogId || plan.status === 'done' || plan.status === 'missed') continue
    if (plan.plannedAt > horizon) continue

    const line = lines.get(plan.lineId)
    const medication = line ? medicationById.get(line.medicationId) ?? null : null
    if (line?.endedAt) continue
    const medicationName = medication?.name ?? line?.label ?? treatmentName
    // 注射线只可能是皮下或静脉；口服线不走这里。
    const route: 'sc' | 'iv' = medication?.route === 'iv' ? 'iv' : 'sc'

    for (const offset of offsets) {
      const day = addLocalDays(plan.plannedAt, offset)
      const rawTriggerAt = atLocalMinutes(day, reminderMinutes)
      if (rawTriggerAt > horizon) continue
      const triggerAt = shiftOutOfDnd(rawTriggerAt, dnd)
      // 顺延到别的日期后文案的「今天/明天」就不成立了，直接丢弃这条草稿。
      if (!sameLocalDay(triggerAt, rawTriggerAt)) continue
      if (triggerAt <= now || !claimDraftKey(seen, plan.lineId, plan.plannedAt, triggerAt)) continue

      const content = buildReminderContent({
        medicationName,
        dose: plan.dose,
        unit: plan.unit,
        offsetDays: Math.abs(offset),
        route,
      })
      drafts.push({
        lineId: plan.lineId,
        kind: 'injection',
        plannedAt: plan.plannedAt,
        triggerAt,
        title: content.title,
        body: content.body,
      })
    }

    // 注射日当天 20:00 的「仍未登记」补提醒。
    if (offsets.includes(0)) {
      const rawTriggerAt = atLocalMinutes(plan.plannedAt, EVENING_CATCH_UP_MINUTES)
      if (rawTriggerAt > horizon) continue
      const triggerAt = shiftOutOfDnd(rawTriggerAt, dnd)
      // 跨日顺延后就不再是「今天还没登记」，丢弃。
      if (
        sameLocalDay(triggerAt, rawTriggerAt) &&
        triggerAt > now &&
        claimDraftKey(seen, plan.lineId, plan.plannedAt, triggerAt)
      ) {
        const content = buildReminderContent({
          medicationName,
          dose: plan.dose,
          unit: plan.unit,
          offsetDays: 0,
          isSameDayEvening: true,
          route,
        })
        drafts.push({
          lineId: plan.lineId,
          kind: 'injection',
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

interface OralDayGroup {
  day: number
  lineIds: string[]
  names: string[]
  remindMinutes: number
}

/** 口服线：按本地日和提醒时间分组，相同时刻的多条线合并提醒。 */
function buildOralDrafts(input: {
  plans: SchedulePlan[]
  lines: Map<string, TreatmentLine>
  medicationById: Map<string, Medication>
  now: number
  horizon: number
  dnd: DndWindow
}): ReminderDraft[] {
  const { plans, lines, medicationById, now, horizon, dnd } = input
  const byDay = new Map<string, OralDayGroup>()

  for (const plan of plans) {
    if (plan.kind !== 'oral') continue
    if (plan.doseLogId || plan.status === 'done' || plan.status === 'missed') continue
    if (plan.plannedAt > horizon) continue

    const line = lines.get(plan.lineId)
    if (!line || !line.oral) continue
    if (line.endedAt) continue

    const day = startOfLocalDay(plan.plannedAt)
    const remindMinutes = parseTimeOfDay(line.oral.remindTime, DEFAULT_REMINDER_MINUTES)
    // 是否过期在免打扰顺延之后判断，保留今天尚未触发的顺延提醒。
    const key = `${day}|${remindMinutes}`
    const medication = medicationById.get(line.medicationId)
    const name = medication?.name ?? line.label

    const existing = byDay.get(key)
    if (existing) {
      if (!existing.lineIds.includes(plan.lineId)) existing.lineIds.push(plan.lineId)
      if (!existing.names.includes(name)) existing.names.push(name)
    } else {
      byDay.set(key, { day, lineIds: [plan.lineId], names: [name], remindMinutes })
    }
  }

  const drafts: ReminderDraft[] = []
  for (const group of byDay.values()) {
    const rawTriggerAt = atLocalMinutes(group.day, group.remindMinutes)
    const triggerAt = shiftOutOfDnd(rawTriggerAt, dnd)
    // 免打扰顺延到次日就不再提示「今天该服药」，直接跳过。
    if (!sameLocalDay(triggerAt, rawTriggerAt)) continue
    if (triggerAt <= now) continue

    const content = buildOralContent(group.names)
    drafts.push({
      lineId: group.lineIds[0],
      kind: 'oral',
      plannedAt: group.day,
      triggerAt,
      title: content.title,
      body: content.body,
    })
  }
  return drafts
}

/** 口服提醒文案：只描述「该服药了」，不做任何剂量或用药建议。 */
function buildOralContent(names: string[]): { title: string; body: string } {
  const unique = names.map((name) => name.trim()).filter((name) => name !== '')
  if (unique.length === 0) {
    return { title: '今天该服药了', body: '按医嘱服用即可，完成后记得回来打卡。' }
  }
  if (unique.length === 1) {
    return {
      title: `今天该服用${unique[0]}`,
      body: '按医嘱服用即可，完成后记得回来打卡。',
    }
  }
  return {
    title: `今天有 ${unique.length} 种口服药`,
    body: `${unique.join('、')}。按医嘱服用，完成后记得回来打卡。`,
  }
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
        kind: draft.kind,
        lineId: draft.lineId,
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

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function sameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b)
}

function claimDraftKey(
  seen: Set<string>,
  lineId: string,
  plannedAt: number,
  triggerAt: number,
): boolean {
  const key = `${lineId}|${plannedAt}|${triggerAt}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
