import type {
  DoseLog,
  InjectionSite,
  LineKind,
  RegimenAnchor,
  TreatmentLine,
  TreatmentPhase,
} from '@/types'

/**
 * domain 测试共用的构造器：按「治疗组合 / 治疗线」新模型造数据。
 */

export const DAY = 86_400_000
/** 2026-01-05 00:00 UTC，是周一，便于校验周几 */
export const T0 = Date.UTC(2026, 0, 5)

let seq = 0

export function makePhase(input: {
  lineId?: string
  orderIdx: number
  kind?: TreatmentPhase['kind']
  intervalDays?: number
  repeatCount?: number
  dose?: number | null
  unit?: string
  effectiveFrom?: number | null
}): TreatmentPhase {
  const {
    lineId = 'line-host',
    orderIdx,
    kind = 'maintenance',
    intervalDays = 14,
    repeatCount = 0,
    dose = 40,
    unit = 'mg',
    effectiveFrom = null,
  } = input

  return {
    id: `${lineId}-phase-${orderIdx}`,
    lineId,
    orderIdx,
    kind,
    intervalDays,
    repeatCount,
    dose,
    unit,
    effectiveFrom,
  }
}

export function makeInjectionLine(
  opts: {
    id?: string
    medicationId?: string
    isHost?: boolean
    syncWithHost?: boolean
    anchor?: RegimenAnchor
    windowDays?: number
    endedAt?: number | null
    phases?: TreatmentPhase[]
    label?: string
  } = {},
): TreatmentLine {
  const {
    id = 'line-host',
    medicationId = 'med-1',
    isHost = true,
    syncWithHost = false,
    anchor = 'actual',
    windowDays = 2,
    endedAt = null,
    phases,
    label = '测试注射线',
  } = opts

  return {
    id,
    treatmentId: 'treatment-1',
    medicationId,
    kind: 'injection',
    label,
    isHost,
    syncWithHost,
    anchor,
    windowDays,
    endedAt,
    phases: phases ?? [makePhase({ lineId: id, orderIdx: 0, intervalDays: 14 })],
    oral: null,
  }
}

export function makeOralLine(opts: {
  id?: string
  medicationId?: string
  startDate?: number
  durationDays?: number | null
  frequency?: 'daily' | 'weekly' | 'custom'
  timesPerPeriod?: number
  daysOfWeek?: number[]
  endedAt?: number | null
  label?: string
}): TreatmentLine {
  const {
    id = 'line-oral',
    medicationId = 'med-oral',
    startDate = T0,
    durationDays = null,
    frequency = 'daily',
    timesPerPeriod = 1,
    daysOfWeek = [],
    endedAt = null,
    label = '测试口服线',
  } = opts

  return {
    id,
    treatmentId: 'treatment-1',
    medicationId,
    kind: 'oral' as LineKind,
    label,
    isHost: false,
    syncWithHost: false,
    anchor: 'planned',
    windowDays: 0,
    endedAt,
    phases: [],
    oral: { startDate, durationDays, frequency, timesPerPeriod, daysOfWeek, remindTime: '09:00' },
  }
}

export function makeLog(input: {
  lineId?: string
  scheduledAt?: number | null
  takenAt?: number | null
  status?: DoseLog['status']
  dose?: number | null
  unit?: string
  site?: InjectionSite | null
}): DoseLog {
  const {
    lineId = 'line-host',
    scheduledAt = null,
    takenAt = null,
    status = 'done',
    dose = 40,
    unit = 'mg',
    site = 'abdomen_ul',
  } = input

  seq += 1
  return {
    id: `log-${seq}`,
    lineId,
    scheduledAt,
    takenAt,
    status,
    dose,
    unit,
    site,
    lotNumber: null,
    note: null,
    createdAt: takenAt ?? scheduledAt ?? T0,
    updatedAt: takenAt ?? scheduledAt ?? T0,
  }
}

/** 第 offsetDays 天的注射打卡（scheduledAt 与 takenAt 相同） */
export function injectionLog(offsetDays: number, lineId = 'line-host'): DoseLog {
  const takenAt = T0 + offsetDays * DAY
  return makeLog({ lineId, scheduledAt: takenAt, takenAt, status: 'done' })
}

export function offsets(plans: Array<{ plannedAt: number }>): number[] {
  return plans.map((plan) => (plan.plannedAt - T0) / DAY)
}
