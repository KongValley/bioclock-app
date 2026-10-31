import type {
  Injection,
  PhaseKind,
  Regimen,
  RegimenPhase,
  WindowStatus,
} from '@/types'

/**
 * 排程引擎（纯函数）。
 *
 * 所有时间均为 UTC 毫秒，内部只做毫秒算术，不做时区换算。
 * 计划表不落库，每次由「方案阶段 + 注射记录 + 当前时间」实时推导。
 */

const DAY = 86_400_000

/** 返回值在历史计划之后额外覆盖的未来针数 */
const FUTURE_DOSE_COUNT = 2

/** 防御性上限：避免异常参数（例如小到浮点无法推进的间隔）造成死循环 */
const MAX_PLANS = 100_000

export type DoseStatus = 'done' | 'due' | 'upcoming' | 'overdue'

export interface DosePlan {
  /** 第几针，从 0 开始 */
  index: number
  phaseId: string
  phaseKind: PhaseKind
  plannedAt: number
  dose: number | null
  unit: string
  status: DoseStatus
  actualAt?: number
  /** 实际 - 计划，单位天（保留一位小数） */
  deviationDays?: number
  windowStatus?: WindowStatus
}

export interface ScheduleInput {
  regimen: Regimen
  /** 该方案的注射记录；内部会按 injectedAt 升序排序 */
  injections: Injection[]
  now: number
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

function sortInjections(injections: Injection[]): Injection[] {
  return [...injections].sort((a, b) => a.injectedAt - b.injectedAt)
}

/**
 * 第 index 针落在哪个阶段。
 * 每阶段顺序消耗 repeatCount 次；repeatCount === 0 表示该阶段无限重复。
 * 阶段全部消耗完（有限方案）后返回 null。
 */
function phaseAt(phases: RegimenPhase[], index: number): RegimenPhase | null {
  let remaining = index
  for (const phase of phases) {
    if (phase.repeatCount === 0) return phase
    if (remaining < phase.repeatCount) return phase
    remaining -= phase.repeatCount
  }
  return null
}

function classifyStatus(plannedAt: number, now: number): DoseStatus {
  if (plannedAt < now - DAY) return 'overdue'
  if (Math.abs(plannedAt - now) <= DAY) return 'due'
  return 'upcoming'
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10
  // 避免 -0（Object.is(-0, 0) === false，会让调用方的严格断言意外失败）
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * 判定一次实际注射相对计划时间的窗口状态。
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
 * 生成计划表：全部已发生的计划 + 未来 2 针。
 * 无限维持阶段靠「未来 2 针」截断，不会死循环。
 */
export function buildSchedule(input: ScheduleInput): DosePlan[] {
  const { regimen, now } = input

  assertWindowDays(regimen.windowDays)

  const phases = [...regimen.phases].sort((a, b) => a.orderIdx - b.orderIdx)
  for (const phase of phases) assertIntervalDays(phase.intervalDays)

  if (phases.length === 0) return []

  const injections = sortInjections(input.injections)
  const firstPlannedAt =
    injections.length > 0 ? injections[0].injectedAt : regimen.createdAt

  const plans: DosePlan[] = []
  let futureCount = 0

  for (let index = 0; ; index += 1) {
    const phase = phaseAt(phases, index)
    if (phase === null) break

    if (plans.length >= MAX_PLANS) {
      throw new Error('排程长度超出上限，请检查给药间隔')
    }

    let plannedAt: number
    if (index === 0) {
      plannedAt = firstPlannedAt
    } else {
      const previous = plans[index - 1]
      const previousActual = injections[index - 1]?.injectedAt
      // 实际为锚且上一针有记录 → 从实际时间起算；否则退回上一针计划时间。
      const base =
        regimen.anchor === 'actual' && previousActual !== undefined
          ? previousActual
          : previous.plannedAt
      plannedAt = base + phase.intervalDays * DAY
    }

    const injection = injections[index]
    const plan: DosePlan = {
      index,
      phaseId: phase.id,
      phaseKind: phase.kind,
      plannedAt,
      dose: phase.dose,
      unit: phase.unit,
      status: injection ? 'done' : classifyStatus(plannedAt, now),
    }

    if (injection) {
      plan.actualAt = injection.injectedAt
      plan.deviationDays = round1((injection.injectedAt - plannedAt) / DAY)
      plan.windowStatus = classifyWindow(
        plannedAt,
        injection.injectedAt,
        regimen.windowDays,
      )
    }

    plans.push(plan)

    // 只有「无实际记录且计划时间在未来」的针才算未来针；
    // 全部历史（含逾期未打的）都会先被完整输出。
    if (!injection && plannedAt > now) {
      futureCount += 1
      if (futureCount >= FUTURE_DOSE_COUNT) break
    }
  }

  return plans
}

/** 第一针尚未完成的计划（跳过所有已完成的针） */
export function nextDose(input: ScheduleInput): DosePlan | null {
  return buildSchedule(input).find((plan) => plan.status !== 'done') ?? null
}

/**
 * 方案总共计划多少针。
 * repeatCount === 0 的维持阶段视为无限，返回 Infinity。
 */
export function totalPlannedDoses(phases: RegimenPhase[]): number {
  for (const phase of phases) assertIntervalDays(phase.intervalDays)

  let total = 0
  for (const phase of phases) {
    if (phase.repeatCount === 0) return Number.POSITIVE_INFINITY
    total += phase.repeatCount
  }
  return total
}
