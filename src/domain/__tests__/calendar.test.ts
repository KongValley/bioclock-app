import { describe, expect, it } from 'vitest'
import {
  buildMonthCells,
  dayStart,
  groupPlansByDay,
  isSameMonth,
  monthOf,
  monthTitle,
  shiftMonth,
} from '../calendar'
import type { SchedulePlan } from '../schedule'

function plan(id: string, plannedAt: number): SchedulePlan {
  return {
    index: 0,
    lineId: id,
    treatmentId: 't1',
    medicationId: 'm1',
    kind: 'injection',
    phaseId: null,
    phaseKind: null,
    plannedAt,
    status: 'upcoming',
    dose: 40,
    unit: 'mg',
  }
}

describe('日历月视图', () => {
  it('从周一开始补齐 42 个格子', () => {
    const cursor = { year: 2026, month: 2 } // 2026-03-01 是周日
    const cells = buildMonthCells(cursor)

    expect(cells).toHaveLength(42)
    expect(new Date(cells[0]).getDay()).toBe(1) // 周一
    expect(new Date(cells[0]).getDate()).toBe(23) // 2 月 23 日
    expect(new Date(cells[6]).getMonth()).toBe(2)
    expect(new Date(cells[6]).getDate()).toBe(1)
    expect(new Date(cells[41]).getDay()).toBe(0) // 周日
  })

  it('切换月份可以跨年', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('生成标题并判断当前月', () => {
    const cursor = { year: 2026, month: 9 }
    expect(monthTitle(cursor)).toBe('2026年10月')
    expect(monthOf(Date.now())).toEqual({
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
    })
    expect(isSameMonth(cursor, new Date(2026, 9, 1).getTime())).toBe(true)
    expect(isSameMonth(cursor, new Date(2026, 10, 1).getTime())).toBe(false)
  })

  it('按自然日分组并按时间排序', () => {
    const first = new Date(2026, 9, 3, 16, 0).getTime()
    const sameDay = new Date(2026, 9, 3, 9, 0).getTime()
    const other = new Date(2026, 9, 4, 9, 0).getTime()
    const grouped = groupPlansByDay([
      plan('a', first),
      plan('b', sameDay),
      plan('c', other),
    ])

    expect(grouped.get(dayStart(first))?.map((item) => item.lineId)).toEqual(['b', 'a'])
    expect(grouped.get(dayStart(other))).toHaveLength(1)
  })
})
