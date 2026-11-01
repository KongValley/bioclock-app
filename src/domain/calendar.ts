import type { SchedulePlan } from './schedule'

/**
 * 日历用的纯函数。
 * 统一按设备本地时区把时间戳归到「自然日」，避免 UTC 日期与界面日期错一天。
 */

export interface MonthCursor {
  year: number
  /** 0 = 一月 … 11 = 十二月 */
  month: number
}

export function dayStart(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const date = new Date(cursor.year, cursor.month + delta, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function monthOf(timestamp: number): MonthCursor {
  const date = new Date(timestamp)
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function isSameMonth(cursor: MonthCursor, timestamp: number): boolean {
  const date = new Date(timestamp)
  return date.getFullYear() === cursor.year && date.getMonth() === cursor.month
}

/**
 * 生成 6×7 的月视图（周一起始）。
 * 返回的是每个格子对应自然日的本地 0 点时间戳，前后会补齐上/下月日期。
 */
export function buildMonthCells(cursor: MonthCursor): number[] {
  const first = new Date(cursor.year, cursor.month, 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(cursor.year, cursor.month, 1 - mondayOffset)
  const cells: number[] = []
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    cells.push(date.getTime())
  }
  return cells
}

export function monthTitle(cursor: MonthCursor): string {
  return `${cursor.year}年${cursor.month + 1}月`
}

/** 按本地自然日分组，值按计划时间升序。 */
export function groupPlansByDay(plans: SchedulePlan[]): Map<number, SchedulePlan[]> {
  const grouped = new Map<number, SchedulePlan[]>()
  for (const plan of plans) {
    const key = dayStart(plan.plannedAt)
    const bucket = grouped.get(key)
    if (bucket) bucket.push(plan)
    else grouped.set(key, [plan])
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.plannedAt - b.plannedAt)
  }
  return grouped
}
