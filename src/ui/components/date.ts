/**
 * 本地时间工具。
 * 数据库统一存 UTC 毫秒，这里只负责「按设备本地时区」格式化与简单加减。
 */

export const MS_PER_DAY = 86_400_000

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 自然日差值（a - b），今天与昨天返回 1。 */
export function calendarDayDiff(a: number, b: number): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / MS_PER_DAY)
}

export function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

export function addMinutes(timestamp: number, minutes: number): number {
  return timestamp + minutes * 60_000
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function formatDate(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const base = `${date.getMonth() + 1}月${date.getDate()}日`
  return sameYear ? base : `${date.getFullYear()}年${base}`
}

export function formatMonth(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

export function monthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

export function formatWeekday(timestamp: number): string {
  return WEEKDAYS[new Date(timestamp).getDay()]
}

export function formatDateTime(timestamp: number, now: number = Date.now()): string {
  return `${formatDate(timestamp, now)} ${formatTime(timestamp)}`
}

export function formatDateTimeFull(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${
    WEEKDAYS[date.getDay()]
  } ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 今天 / 昨天 / 明天，其余返回 M月D日。 */
export function formatRelativeDay(timestamp: number, now: number = Date.now()): string {
  const diff = calendarDayDiff(timestamp, now)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  if (diff === -2) return '前天'
  return formatDate(timestamp, now)
}

export function formatDuration(days: number): string {
  if (!Number.isFinite(days)) return '长期'
  if (days < 1) return '不足 1 天'
  return `${Math.round(days * 10) / 10} 天`
}

/** 供「手动输入」使用的固定格式：YYYY-MM-DD HH:mm */
export function formatManualInput(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

const MANUAL_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/

/** 解析手动输入；非法返回 null。 */
export function parseManualDateTime(text: string): number | null {
  const match = MANUAL_RE.exec(text.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] ? Number(match[4]) : 9
  const minute = match[5] ? Number(match[5]) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59) return null
  const date = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null
  }
  return date.getTime()
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(value.trim())
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

export function toTimeOfDay(hour: number, minute: number): string {
  const normalizedHour = ((hour % 24) + 24) % 24
  const normalizedMinute = ((minute % 60) + 60) % 60
  return `${pad2(normalizedHour)}:${pad2(normalizedMinute)}`
}

export function bumpTimeOfDay(value: string, deltaMinutes: number): string {
  const parsed = parseTimeOfDay(value) ?? { hour: 9, minute: 0 }
  return toTimeOfDay(parsed.hour, parsed.minute + deltaMinutes)
}

export function formatSignedDays(days: number): string {
  if (Math.abs(days) < 0.05) return '0 天'
  const rounded = Math.round(Math.abs(days) * 10) / 10
  return days > 0 ? `+${rounded} 天` : `-${rounded} 天`
}
