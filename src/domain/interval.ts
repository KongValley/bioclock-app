import type { TreatmentPhase } from '@/types'

export type PhaseDraft = Omit<TreatmentPhase, 'id' | 'lineId'>

function assertInterval(intervalDays: number): void {
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    throw new Error('注射间隔必须是 1 到 365 之间的整数天')
  }
}

/**
 * 从「下一针」开始调整间隔，历史阶段保持原样。
 *
 * 做法：找到下一针所在的阶段，把该阶段截断到下一针之前，
 * 再追加一个新的无限维持阶段。这样 0..nextIndex-1 仍按旧间隔排程，
 * nextIndex 起才使用新间隔。
 */
export function buildIntervalChangePhases(
  phases: TreatmentPhase[],
  nextIndex: number,
  newIntervalDays: number,
): PhaseDraft[] {
  assertInterval(newIntervalDays)
  if (!Number.isInteger(nextIndex) || nextIndex < 0) {
    throw new Error('下一针位置不合法')
  }

  const sorted = [...phases].sort((a, b) => a.orderIdx - b.orderIdx)
  if (sorted.length === 0) throw new Error('这条用药线还没有阶段')

  let remaining = nextIndex
  for (let index = 0; index < sorted.length; index += 1) {
    const phase = sorted[index]
    const infinite = phase.repeatCount === 0
    if (!infinite && remaining >= phase.repeatCount) {
      remaining -= phase.repeatCount
      continue
    }

    if (phase.kind !== 'maintenance') {
      throw new Error('当前还在负荷阶段，请等进入维持阶段后再调整间隔')
    }
    if (index !== sorted.length - 1) {
      throw new Error('当前阶段之后还有阶段，暂不支持自动调整间隔')
    }

    const before = sorted.slice(0, index).map((item, orderIdx) => ({
      orderIdx,
      kind: item.kind,
      intervalDays: item.intervalDays,
      repeatCount: item.repeatCount,
      dose: item.dose,
      unit: item.unit,
    }))

    const used = remaining
    if (used > 0) {
      before.push({
        orderIdx: before.length,
        kind: phase.kind,
        intervalDays: phase.intervalDays,
        repeatCount: used,
        dose: phase.dose,
        unit: phase.unit,
      })
    }

    before.push({
      orderIdx: before.length,
      kind: 'maintenance',
      intervalDays: newIntervalDays,
      repeatCount: 0,
      dose: phase.dose,
      unit: phase.unit,
    })
    return before
  }

  throw new Error('找不到下一针所在的阶段，无法调整间隔')
}
