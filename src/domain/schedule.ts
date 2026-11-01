import type {
  DoseLog,
  LineKind,
  OralPlan,
  PhaseKind,
  RegimenAnchor,
  TreatmentLine,
  TreatmentPhase,
  WindowStatus,
} from '@/types'

/**
 * 排程引擎（纯函数）。
 *
 * 模型：一个 treatment 里有多条 treatment_line。每条线是一种药：
 * - 注射线：按 phases（负荷 / 维持）推进，anchor 决定是「按实际」还是「按计划」起算；
 *   `syncWithHost` 的线不自己推进，直接跟随本 treatment 宿主线（isHost=true 的注射线）的针日。
 * - 口服线：按 startDate + durationDays + frequency 生成打卡点。
 *
 * 所有时间均为 UTC 毫秒，内部只做毫秒算术，不做时区换算（周几按 UTC 周几判定）。
 * 计划表不落库，每次由「治疗线 + 用药记录 + 当前时间」实时推导。
 */

const DAY = 86_400_000

/** 注射线返回值在历史计划之后额外覆盖的未来针数 */
const INJECTION_FUTURE_DOSE_COUNT = 2

/** 口服线默认覆盖未来多少天（含今天） */
export const ORAL_HORIZON_DAYS = 14

/** 口服线历史上限保护：计划点超过该数量即视为参数异常 */
const MAX_ORAL_PLANS = 20_000

/** 防御性上限：避免异常参数（例如小到浮点无法推进的间隔）造成死循环 */
const MAX_PLANS = 100_000

export type PlanStatus = 'done' | 'due' | 'upcoming' | 'overdue' | 'missed'

export interface SchedulePlan {
  /** 第几针 / 第几次打卡，从 0 开始 */
  index: number
  lineId: string
  treatmentId: string
  medicationId: string
  kind: LineKind
  /** 注射线才有；口服线为 null */
  phaseId: string | null
  /** 注射线才有；口服线为 null */
  phaseKind: PhaseKind | null
  plannedAt: number
  status: PlanStatus
  dose: number | null
  unit: string
  /** 实际执行时间（done 时有值，skipped 也有值用于排序展示） */
  actualAt?: number
  /** 实际 - 计划，单位天（保留一位小数） */
  deviationDays?: number
  /** 注射线才有：实际执行相对计划日的窗口判定 */
  windowStatus?: WindowStatus
  /** 对应的用药记录 id（dose_log） */
  doseLogId?: string
}

/** @deprecated 旧名字，保留给尚未迁移的调用方 */
export type DosePlan = SchedulePlan

/** 口服线配置，直接复用 types 里的 OralPlan */
export type OralConfig = OralPlan

export interface ScheduleInput {
  /** 一个 treatment 的所有治疗线（主注射线、错开线、口服线都在里面） */
  lines: TreatmentLine[]
  /** 这些线的用药记录；内部会按记录时间排序，不要求调用方排序 */
  logs: DoseLog[]
  now: number
  /** 口服线向前（含今天）覆盖的天数；默认 ORAL_HORIZON_DAYS */
  horizonDays?: number
  /** 注射线额外覆盖的未来针数；默认 2，日历可以传更大的值 */
  futureDoseCount?: number
}

/** 单条线的排程输入 */
export interface LineScheduleInput {
  line: TreatmentLine
  logs: DoseLog[]
  now: number
  horizonDays?: number
  futureDoseCount?: number
  /** 可选：注入宿主线解析器（通常用 resolveHostLine 的结果） */
  resolveHost?: (line: TreatmentLine) => TreatmentLine | null
  /** 可选：宿主线的用药记录（同步线需要，才能对齐宿主真实针日） */
  hostLogs?: DoseLog[]
}

function assertWindowDays(windowDays: number): void {
  if (!Number.isFinite(windowDays) || windowDays < 0) {
    throw new Error('允许偏差窗口不能小于 0 天')
  }
}

function assertIntervalDays(intervalDays: number): void {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    throw new Error('给药间隔必须大于 0 天')
  }
}

/** 多条线里最早的一个停用时间；都没有停用则返回 null。 */
function earliestEnd(...values: Array<number | null | undefined>): number | null {
  let result: number | null = null
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (result === null || value < result) result = value
  }
  return result
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10
  // 避免 -0（Object.is(-0, 0) === false，会让调用方的严格断言意外失败）
  return Object.is(rounded, -0) ? 0 : rounded
}

function isInjectionLine(line: TreatmentLine): boolean {
  return line.kind === 'injection'
}

/** 该线是否是同步线（只有注射线才可能同步） */
function isSyncedLine(line: TreatmentLine): boolean {
  return isInjectionLine(line) && line.syncWithHost === true
}

/** 解析宿主线：本 treatment 里 isHost 的那条注射线；没有则取第一条非同步注射线。 */
export function resolveHostLine(
  line: TreatmentLine,
  lines: TreatmentLine[],
): TreatmentLine | null {
  const injectionLines = lines.filter(
    (item) => isInjectionLine(item) && item.id !== line.id,
  )
  return (
    injectionLines.find((item) => item.isHost === true) ??
    injectionLines.find((item) => !isSyncedLine(item)) ??
    null
  )
}

/**
 * 按次数推进阶段（旧逻辑），忽略带生效时间的阶段。
 * repeatCount === 0 表示该阶段无限重复；消耗完返回 null。
 */
function phaseAtByCount(phases: TreatmentPhase[], index: number): TreatmentPhase | null {
  let remaining = index
  for (const phase of phases) {
    if (phase.repeatCount === 0) return phase
    if (remaining < phase.repeatCount) return phase
    remaining -= phase.repeatCount
  }
  return null
}

/** 找到上一个计划时间之后最早生效的阶段。 */
function nextEffectivePhase(
  phases: TreatmentPhase[],
  after: number,
): TreatmentPhase | null {
  return (
    phases
      .filter(
        (phase) =>
          phase.effectiveFrom !== null && phase.effectiveFrom > after,
      )
      .sort(
        (a, b) =>
          (a.effectiveFrom ?? 0) - (b.effectiveFrom ?? 0) ||
          a.orderIdx - b.orderIdx,
      )[0] ?? null
  )
}

/**
 * 第 index 针落在哪个阶段。
 *
 * - 有 effectiveFrom 的阶段按日期生效，优先于次数推进；
 * - 日期相同时取 orderIdx 更大的；
 * - 如果 index 已被旧阶段用尽、但日期还没到新阶段，回退到最后一个无生效时间的阶段，
 *   这样之后补录更早的历史记录也能按旧间隔显示。
 */
function phaseAt(
  phases: TreatmentPhase[],
  index: number,
  plannedAt?: number,
): TreatmentPhase | null {
  if (plannedAt !== undefined) {
    const dated = phases
      .filter(
        (phase) =>
          phase.effectiveFrom !== null && phase.effectiveFrom <= plannedAt,
      )
      .sort(
        (a, b) =>
          (a.effectiveFrom ?? 0) - (b.effectiveFrom ?? 0) ||
          a.orderIdx - b.orderIdx,
      )
    if (dated.length > 0) return dated[dated.length - 1]
  }

  const undated = phases.filter((phase) => phase.effectiveFrom === null)
  const byCount = phaseAtByCount(undated, index)
  if (byCount) return byCount

  if (phases.some((phase) => phase.effectiveFrom !== null)) {
    return undated[undated.length - 1] ?? phases[0] ?? null
  }
  return null
}

function floorToDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function sameLocalDay(a: number, b: number): boolean {
  return floorToDay(a) === floorToDay(b)
}

/**
 * 判定一次实际执行相对计划时间的窗口状态。
 * |实际 - 计划| <= windowDays 天 → on_time；更早 → early；更晚 → late。
 */
export function classifyWindow(
  plannedAt: number,
  actualAt: number,
  windowDays: number,
): WindowStatus {
  assertWindowDays(windowDays)
  if (Math.abs(actualAt - plannedAt) <= windowDays * DAY) return 'on_time'
  return actualAt < plannedAt ? 'early' : 'late'
}

/**
 * 一次计划还没有记录时的状态。
 * 超过计划日 1 天仍未登记 → overdue；±1 天内 → due；否则 → upcoming。
 */
export function classifyStatus(plannedAt: number, now: number): PlanStatus {
  if (plannedAt < now - DAY) return 'overdue'
  if (Math.abs(plannedAt - now) <= DAY) return 'due'
  return 'upcoming'
}

// ---------------------------------------------------------------------------
// 用药记录映射：把「按时间排序的一串记录」对到「按时间排序的一串计划」上
// ---------------------------------------------------------------------------

interface SortedLog {
  log: DoseLog
  sortAt: number
}

function logTime(log: DoseLog): number {
  return log.takenAt ?? log.scheduledAt ?? 0
}

function sortLogs(logs: DoseLog[]): SortedLog[] {
  return logs
    .map((log) => ({ log, sortAt: logTime(log) }))
    .sort((a, b) => a.sortAt - b.sortAt)
}

/**
 * 把记录对到计划上：
 * 1. 已登记到计划日（dose_log.scheduledAt 命中）的记录优先认领该计划；
 * 2. 否则只接受「同一时段」（由 samePeriod 判断，例如口服按本地自然日）的记录；
 *    对不上的记录保持未认领，绝不顺移去占用后面的计划。
 */
function pairLogs<T extends { plannedAt: number }>(
  plans: T[],
  sortedLogs: SortedLog[],
  samePeriod: (plannedAt: number, logAt: number) => boolean,
): Array<DoseLog | null> {
  const assigned: Array<DoseLog | null> = plans.map(() => null)
  const used = new Set<string>()

  plans.forEach((plan, planIndex) => {
    const exact = sortedLogs.find(
      (item) => !used.has(item.log.id) && item.log.scheduledAt === plan.plannedAt,
    )
    if (exact) {
      assigned[planIndex] = exact.log
      used.add(exact.log.id)
    }
  })

  plans.forEach((plan, planIndex) => {
    if (assigned[planIndex]) return
    const nearby = sortedLogs.find(
      (item) =>
        !used.has(item.log.id) &&
        item.log.scheduledAt === null &&
        samePeriod(plan.plannedAt, item.sortAt),
    )
    if (!nearby) return
    assigned[planIndex] = nearby.log
    used.add(nearby.log.id)
  })

  return assigned
}

/** 找到距离计划时间最近、且未被使用的记录；不标记为已使用。 */
function findNearestLog(
  sortedLogs: SortedLog[],
  used: Set<string>,
  plannedAt: number,
  toleranceDays: number,
  minAt?: number,
): DoseLog | null {
  const tolerance = toleranceDays * DAY
  let best: SortedLog | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const item of sortedLogs) {
    if (used.has(item.log.id)) continue
    if (minAt !== undefined && item.sortAt < minAt) continue
    const distance =
      item.log.scheduledAt === plannedAt ? 0 : Math.abs(item.sortAt - plannedAt)
    if (distance > tolerance) continue
    if (distance < bestDistance) {
      best = item
      bestDistance = distance
    }
  }
  return best?.log ?? null
}

/** 取距离计划时间最近的未使用记录（注射线用）；超出容差的记录不认领。 */
function takeNearestLog(
  sortedLogs: SortedLog[],
  used: Set<string>,
  plannedAt: number,
  toleranceDays: number,
  minAt?: number,
): DoseLog | null {
  const best = findNearestLog(sortedLogs, used, plannedAt, toleranceDays, minAt)
  if (best) used.add(best.id)
  return best
}

function statusForLogged(
  log: DoseLog,
  plannedAt: number,
  now: number,
): PlanStatus {
  if (log.status === 'done') return 'done'
  if (log.status === 'skipped') {
    // 爽约：计划日已过 → missed；还没到 → 视为已取消的 upcoming
    return plannedAt < now ? 'missed' : 'upcoming'
  }
  // status === 'missed'（系统判定漏掉）
  return 'missed'
}

function applyLog(
  plan: SchedulePlan,
  log: DoseLog,
  now: number,
  windowDays: number | null,
): SchedulePlan {
  plan.status = statusForLogged(log, plan.plannedAt, now)
  plan.doseLogId = log.id
  if (log.dose !== null) plan.dose = log.dose
  if (log.unit) plan.unit = log.unit

  const actualAt = log.takenAt
  if (actualAt === null) return plan

  plan.actualAt = actualAt
  plan.deviationDays = round1((actualAt - plan.plannedAt) / DAY)
  if (windowDays !== null) {
    plan.windowStatus = classifyWindow(plan.plannedAt, actualAt, windowDays)
  }
  return plan
}

// ---------------------------------------------------------------------------
// 注射线
// ---------------------------------------------------------------------------

/**
 * 生成一条注射线的计划：全部历史 + 未来 2 针。
 * anchor: 'actual' → 上一针有实际记录时从实际时间起算，否则退回上一针计划时间；
 * anchor: 'planned' → 一律从上一针计划时间起算。
 */
export function buildInjectionPlans(input: {
  line: TreatmentLine
  logs: DoseLog[]
  now: number
  futureDoseCount?: number
}): SchedulePlan[] {
  const { line, logs, now } = input
  const futureDoseLimit = input.futureDoseCount ?? INJECTION_FUTURE_DOSE_COUNT

  if (!isInjectionLine(line)) return []
  assertWindowDays(line.windowDays ?? 0)

  const phases = [...(line.phases ?? [])].sort((a, b) => a.orderIdx - b.orderIdx)
  for (const phase of phases) assertIntervalDays(phase.intervalDays)
  if (phases.length === 0) return []

  const anchor: RegimenAnchor = line.anchor ?? 'planned'
  const windowDays = line.windowDays ?? 0
  const endedAt = line.endedAt ?? null
  const sortedLogs = sortLogs(logs)

  const plans: SchedulePlan[] = []
  const actualTimes: Array<number | null> = []
  const usedLogIds = new Set<string>()
  let futureCount = 0

  for (let index = 0; ; index += 1) {
    let plannedAt: number
    let previousPhase: TreatmentPhase | null = null
    if (index === 0) {
      const first = sortedLogs[0]
      plannedAt = first
        ? first.log.scheduledAt ?? first.sortAt
        : floorToDay(now)
    } else {
      const previousPlanned = plans[index - 1].plannedAt
      const previousActual = actualTimes[index - 1]
      const base =
        anchor === 'actual' && previousActual !== null ? previousActual : previousPlanned
      previousPhase = phaseAt(
        phases,
        index - 1,
        plans[index - 1].plannedAt,
      )
      plannedAt = base + (previousPhase?.intervalDays ?? 0) * DAY
      const nextPhase = nextEffectivePhase(phases, previousPlanned)
      if (nextPhase?.effectiveFrom !== null && nextPhase?.effectiveFrom !== undefined) {
        const oldTolerance = Math.max(
          2,
          windowDays + 1,
          Math.ceil((previousPhase?.intervalDays ?? 28) / 2),
        )
        const oldLog = findNearestLog(sortedLogs, usedLogIds, plannedAt, oldTolerance)
        const oldLogAt = oldLog
          ? oldLog.takenAt ?? oldLog.scheduledAt ?? oldLog.createdAt
          : null
        // 补录的旧记录如果落在生效时间之前，仍然保留旧计划日；否则从生效时间开始用新阶段。
        if (oldLogAt === null || oldLogAt >= nextPhase.effectiveFrom) {
          plannedAt = nextPhase.effectiveFrom
        }
      }
    }

    const phase = phaseAt(phases, index, plannedAt)
    if (phase === null) break

    // 停用后不再生成普通未来计划；但停用日之后如果确实补录了打卡，仍要把它显示出来。
    const toleranceDays = Math.max(2, windowDays + 1, Math.ceil(phase.intervalDays / 2))
    const afterEnd = endedAt !== null && plannedAt > endedAt
    if (afterEnd) {
      const nextPostEnd = sortedLogs.find(
        (item) => !usedLogIds.has(item.log.id) && item.sortAt > endedAt,
      )
      if (!nextPostEnd) break
      // 计划已经停在停用日，补录记录直接按实际时间展示，不再硬套后面的计划日。
      plannedAt = nextPostEnd.sortAt
    }
    const log = takeNearestLog(
      sortedLogs,
      usedLogIds,
      plannedAt,
      toleranceDays,
      afterEnd ? endedAt : undefined,
    )
    if (afterEnd && !log) break

    // 未来针只保留前 INJECTION_FUTURE_DOSE_COUNT 个，之后不再推进（无限维持阶段也不会死循环）。
    // 有记录的未来针（例如补录了提前的注射）仍然保留。
    if (!log && plannedAt > now) {
      futureCount += 1
      if (futureCount > futureDoseLimit) break
    }
    if (plans.length >= MAX_PLANS) {
      throw new Error('排程长度超出上限，请检查给药间隔')
    }

    const plan: SchedulePlan = {
      index,
      lineId: line.id,
      treatmentId: line.treatmentId,
      medicationId: line.medicationId,
      kind: line.kind,
      phaseId: phase.id,
      phaseKind: phase.kind,
      plannedAt,
      status: classifyStatus(plannedAt, now),
      dose: phase.dose,
      unit: phase.unit,
    }
    if (log) applyLog(plan, log, now, windowDays)

    plans.push(plan)
    actualTimes.push(log?.takenAt ?? null)
  }

  return plans
}

/**
 * 同步线：针日直接跟随宿主线的针日，不自己累加。
 * 宿主计划不够覆盖未来时，顺延宿主间隔继续延伸，保证提醒覆盖更远的未来。
 */
function buildSyncedPlans(input: {
  line: TreatmentLine
  hostPlans: SchedulePlan[]
  logs: DoseLog[]
  now: number
  /** 任一条线停用后的截止时间；null 表示都仍在用 */
  endAt?: number | null
  futureDoseCount?: number
}): SchedulePlan[] {
  const { line, hostPlans, logs, now, endAt = null } = input
  const futureDoseLimit = input.futureDoseCount ?? INJECTION_FUTURE_DOSE_COUNT
  const ownPhases = [...(line.phases ?? [])].sort((a, b) => a.orderIdx - b.orderIdx)
  for (const phase of ownPhases) assertIntervalDays(phase.intervalDays)
  if (ownPhases.length === 0 || hostPlans.length === 0) return []

  const windowDays = line.windowDays ?? 0
  assertWindowDays(windowDays)
  const fallbackPhase = ownPhases[ownPhases.length - 1]
  const step = fallbackPhase.intervalDays * DAY

  const timestamps = hostPlans
    .map((plan) => plan.plannedAt)
    .filter((timestamp) => endAt === null || timestamp <= endAt)
  if (timestamps.length === 0) return []

  let futureCount = timestamps.filter((timestamp) => timestamp > now).length
  let cursor = timestamps[timestamps.length - 1]
  while (futureCount < futureDoseLimit) {
    if (timestamps.length >= MAX_PLANS) {
      throw new Error('排程长度超出上限，请检查给药间隔')
    }
    const next = cursor + step
    if (endAt !== null && next > endAt) break
    cursor = next
    timestamps.push(cursor)
    if (cursor > now) futureCount += 1
  }

  const plans: SchedulePlan[] = timestamps.map((plannedAt, index) => {
    const phase = phaseAt(ownPhases, index, plannedAt) ?? fallbackPhase
    return {
      index,
      lineId: line.id,
      treatmentId: line.treatmentId,
      medicationId: line.medicationId,
      kind: line.kind,
      phaseId: phase.id,
      phaseKind: phase.kind,
      plannedAt,
      status: classifyStatus(plannedAt, now),
      dose: phase.dose,
      unit: phase.unit,
    }
  })

  const logTolerance =
    Math.max(windowDays + 1, Math.ceil(fallbackPhase.intervalDays / 2)) * DAY
  const assigned = pairLogs(
    plans,
    sortLogs(logs),
    (plannedAt, logAt) => Math.abs(logAt - plannedAt) <= logTolerance,
  )
  plans.forEach((plan, index) => {
    const log = assigned[index]
    if (log) applyLog(plan, log, now, windowDays)
  })

  return plans
}

// ---------------------------------------------------------------------------
// 口服线
// ---------------------------------------------------------------------------

function startOfLocalDay(timestamp: number): number {
  return floorToDay(timestamp)
}

function normalizeWeekdays(daysOfWeek: number[]): number[] {
  const valid = Array.from(
    new Set(daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
  ).sort((a, b) => a - b)
  if (valid.length === 0) {
    throw new Error('自定义服药频率至少要选择一周中的一天')
  }
  return valid
}

/**
 * weekly 没有指定周几时，按「一周第 n 天」近似均匀分布（以周一为起点）：
 * 每周 1 次 → 周一；2 次 → 周一、周五；3 次 → 周一、周三、周六；……
 */
function evenlySpacedWeekdays(timesPerPeriod: number): number[] {
  const count = Math.max(1, Math.min(7, Math.round(timesPerPeriod)))
  // 周一到周日的顺序（Date#getUTCDay 里 0 = 周日）
  const weekOrder = [1, 2, 3, 4, 5, 6, 0]
  const days: number[] = []
  for (let slot = 0; slot < count; slot += 1) {
    const day = weekOrder[Math.round((slot * 7) / count) % 7]
    if (!days.includes(day)) days.push(day)
  }
  return days.sort((a, b) => a - b)
}

/** 口服线按哪几个（UTC）周几打卡 */
export function oralWeekdays(oral: OralConfig): number[] {
  if (oral.frequency === 'daily') return evenlySpacedWeekdays(7)
  if (oral.frequency === 'custom') return normalizeWeekdays(oral.daysOfWeek ?? [])
  // 每周 N 次：按 N 均匀分布到一周，不再同时读取 daysOfWeek，避免两个参数冲突。
  return evenlySpacedWeekdays(oral.timesPerPeriod ?? 1)
}

/**
 * 生成一条口服线的打卡点：
 * - 起点 = startDate 当天（UTC 0 点）；
 * - daily → 天天打卡；custom → 只在 daysOfWeek 指定的周几；
 * - weekly → 每周 timesPerPeriod 次（优先用 daysOfWeek，否则均匀分布）；
 * - 历史全量输出，未来覆盖到 max(now, startDate) + horizonDays；
 * - durationDays 非 null 时到达疗程天数后停止。
 */
export function buildOralPlans(input: {
  line: TreatmentLine
  logs: DoseLog[]
  now: number
  horizonDays?: number
}): SchedulePlan[] {
  const { line, logs, now } = input
  if (line.kind !== 'oral') return []

  const oral = line.oral
  if (!oral) return []

  const horizonDays = input.horizonDays ?? ORAL_HORIZON_DAYS
  const weekdays = oralWeekdays(oral)
  const startDay = startOfLocalDay(oral.startDate ?? now)
  const durationDays = oral.durationDays
  const endedAt = line.endedAt ?? null
  // 从 startDate 往前留够历史，同时也允许「今天才开始的线」往后覆盖两周。
  const endAt = startOfLocalDay(Math.max(now, startDay)) + horizonDays * DAY

  const plannedTimes: number[] = []
  for (let day = 0; ; day += 1) {
    if (durationDays !== null && durationDays !== undefined && day >= durationDays) break
    const cursor = new Date(startDay)
    cursor.setDate(cursor.getDate() + day)
    const timestamp = cursor.getTime()
    if (timestamp > endAt) break
    if (endedAt !== null && timestamp > endedAt) break
    if (plannedTimes.length >= MAX_ORAL_PLANS) {
      throw new Error('排程长度超出上限，请检查口服频率')
    }

    const weekday = cursor.getDay()
    if (weekdays.includes(weekday)) plannedTimes.push(timestamp)
  }

  const plans: SchedulePlan[] = plannedTimes.map((plannedAt, index) => ({
    index,
    lineId: line.id,
    treatmentId: line.treatmentId,
    medicationId: line.medicationId,
    kind: line.kind,
    phaseId: null,
    phaseKind: null,
    plannedAt,
    status: classifyStatus(plannedAt, now),
    dose: null,
    unit: '',
  }))

  const sortedLogs = sortLogs(logs)
  const assigned = pairLogs(plans, sortedLogs, sameLocalDay)
  const assignedIds = new Set(
    assigned.filter((log): log is DoseLog => log !== null).map((log) => log.id),
  )
  plans.forEach((plan, index) => {
    const log = assigned[index]
    if (log) applyLog(plan, log, now, null)
  })

  // 停用或疗程结束后补录的打卡，仍以计划点的形式显示出来，避免“库里有、界面没有”。
  const boundary =
    endedAt ??
    (durationDays !== null && durationDays !== undefined
      ? startDay + durationDays * DAY - 1
      : null)
  if (boundary !== null) {
    const seenDays = new Set(plans.map((plan) => startOfLocalDay(plan.plannedAt)))
    for (const item of sortedLogs) {
      if (assignedIds.has(item.log.id)) continue
      if (item.sortAt <= boundary) continue
      const day = startOfLocalDay(item.sortAt)
      if (seenDays.has(day)) continue
      seenDays.add(day)
      const plan: SchedulePlan = {
        index: plans.length,
        lineId: line.id,
        treatmentId: line.treatmentId,
        medicationId: line.medicationId,
        kind: line.kind,
        phaseId: null,
        phaseKind: null,
        plannedAt: day,
        status: classifyStatus(day, now),
        dose: null,
        unit: '',
      }
      applyLog(plan, item.log, now, null)
      plans.push(plan)
    }
    plans.sort((a, b) => a.plannedAt - b.plannedAt)
    plans.forEach((plan, index) => {
      plan.index = index
    })
  }

  return plans
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/** 单条线的计划（注射线会自动解析宿主线；宿主计划由调用方提供） */
export function buildLineSchedule(input: LineScheduleInput): SchedulePlan[] {
  const { line, logs, now, horizonDays, futureDoseCount } = input

  if (line.kind === 'oral') {
    return buildOralPlans({ line, logs, now, horizonDays })
  }

  if (isSyncedLine(line)) {
    const host = input.resolveHost ? input.resolveHost(line) : null
    if (!host) return []
    const hostPlans = buildInjectionPlans({
      line: host,
      logs: input.hostLogs ?? [],
      now,
      futureDoseCount,
    })
    if (hostPlans.length === 0) return []
    return buildSyncedPlans({
      line,
      hostPlans,
      logs,
      now,
      endAt: earliestEnd(line.endedAt, host.endedAt),
      futureDoseCount,
    })
  }

  return buildInjectionPlans({ line, logs, now, futureDoseCount })
}

/** 按 lines 顺序展开并汇总，按 plannedAt 升序（同一时间保持线的原始顺序） */
export function buildSchedule(input: ScheduleInput): SchedulePlan[] {
  const { lines, logs, now, horizonDays, futureDoseCount } = input

  const logsByLine = new Map<string, DoseLog[]>()
  for (const line of lines) {
    logsByLine.set(line.id, logs.filter((log) => log.lineId === line.id))
  }

  // 先算非同步注射线（宿主候选），同步线直接复用它们的针日。
  const hostPlansById = new Map<string, SchedulePlan[]>()
  for (const line of lines) {
    if (line.kind === 'injection' && !isSyncedLine(line)) {
      hostPlansById.set(
        line.id,
        buildInjectionPlans({
          line,
          logs: logsByLine.get(line.id) ?? [],
          now,
          futureDoseCount,
        }),
      )
    }
  }

  const all: SchedulePlan[] = []
  for (const line of lines) {
    const lineLogs = logsByLine.get(line.id) ?? []

    if (line.kind === 'oral') {
      for (const plan of buildOralPlans({ line, logs: lineLogs, now, horizonDays })) {
        all.push(plan)
      }
      continue
    }

    if (isSyncedLine(line)) {
      const host = resolveHostLine(line, lines)
      if (!host) continue
      const hostPlans = hostPlansById.get(host.id) ?? []
      if (hostPlans.length === 0) continue
      for (const plan of buildSyncedPlans({
        line,
        hostPlans,
        logs: lineLogs,
        now,
        endAt: earliestEnd(line.endedAt, host.endedAt),
        futureDoseCount,
      })) {
        all.push(plan)
      }
      continue
    }

    const cached = hostPlansById.get(line.id)
    const plans = cached ?? buildInjectionPlans({ line, logs: lineLogs, now, futureDoseCount })
    for (const plan of plans) all.push(plan)
  }

  // Array.prototype.sort 是稳定排序：同一时间点保持线顺序。
  return all.sort((a, b) => a.plannedAt - b.plannedAt)
}

/** 超过这个天数仍未补的漏针不再占用首页「今天要做」，避免几年后还提示“逾期 203 天”。 */
const OVERDUE_ACTIONABLE_DAYS = 30

/**
 * 从一条线的计划里挑「下一步」：
 * 今天到期 → 最近 30 天内最近一次逾期 → 最近的未来 → 更早的逾期（仅用于展示）。
 */
export function selectNextPlan(plans: SchedulePlan[], now: number): SchedulePlan | null {
  const actionable = plans.filter(
    (plan) => plan.status !== 'done' && plan.status !== 'missed',
  )
  if (actionable.length === 0) return null

  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const todayStart = dayStart.getTime()
  const todayEnd = todayStart + DAY

  const dueToday = actionable.find(
    (plan) => plan.plannedAt >= todayStart && plan.plannedAt < todayEnd,
  )
  if (dueToday) return dueToday

  const overdue = actionable
    .filter((plan) => plan.plannedAt < todayStart)
    .sort((a, b) => b.plannedAt - a.plannedAt)
  const recentOverdue = overdue.find(
    (plan) => now - plan.plannedAt <= OVERDUE_ACTIONABLE_DAYS * DAY,
  )
  if (recentOverdue) return recentOverdue

  const upcoming = actionable
    .filter((plan) => plan.plannedAt >= todayEnd)
    .sort((a, b) => a.plannedAt - b.plannedAt)[0]
  if (upcoming) return upcoming

  // 既没有近期逾期也没有未来计划：方案可能已结束，不再把很久以前的漏针当“今天要做”。
  return null
}

/** 所有线里最该关注的下一步 */
export function nextDose(input: ScheduleInput): SchedulePlan | null {
  return selectNextPlan(buildSchedule(input), input.now)
}

/** 指定线里最该关注的下一步 */
export function nextDoseForLine(input: LineScheduleInput): SchedulePlan | null {
  return selectNextPlan(buildLineSchedule(input), input.now)
}

/**
 * 一条注射线总共计划多少针。
 * repeatCount === 0 的维持阶段视为无限，返回 Infinity。
 */
export function totalPlannedDoses(phases: TreatmentPhase[]): number {
  for (const phase of phases) assertIntervalDays(phase.intervalDays)

  let total = 0
  for (const phase of phases) {
    if (phase.repeatCount === 0) return Number.POSITIVE_INFINITY
    total += phase.repeatCount
  }
  return total
}
