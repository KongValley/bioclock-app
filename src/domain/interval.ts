import type { TreatmentPhase } from '@/types'

export type PhaseDraft = Omit<TreatmentPhase, 'id' | 'lineId'>

function assertInterval(intervalDays: number): void {
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    throw new Error('注射间隔必须是 1 到 365 之间的整数天')
  }
}

/**
 * 从 effectiveFrom 起追加一个新的维持阶段。
 *
 * 旧阶段保持原样（不截断 repeatCount），这样之后补录 effectiveFrom 之前的历史记录时，
 * 仍会落在旧阶段、按旧间隔计算；effectiveFrom 之后的计划才会使用新间隔。
 */
export function buildIntervalChangePhases(
  phases: TreatmentPhase[],
  newIntervalDays: number,
  effectiveFrom: number,
): PhaseDraft[] {
  assertInterval(newIntervalDays)
  if (!Number.isFinite(effectiveFrom) || effectiveFrom <= 0) {
    throw new Error('新间隔的生效时间不合法')
  }

  const sorted = [...phases].sort((a, b) => a.orderIdx - b.orderIdx)
  if (sorted.length === 0) throw new Error('这条用药线还没有阶段')
  if (sorted.some((phase) => phase.kind !== 'maintenance' && phase.effectiveFrom !== null)) {
    throw new Error('负荷阶段不能设置生效时间')
  }

  const last = sorted[sorted.length - 1]
  if (last.kind !== 'maintenance') {
    throw new Error('当前还在负荷阶段，请等进入维持阶段后再调整间隔')
  }

  // 新阶段会取代同一时间及之后的所有生效阶段。只按 effectiveFrom 完全相等去重
  // 会留下更晚的旧阶段，排程在走到新阶段后又会跳回旧生效日，凭空多出一针。
  const kept = sorted.filter(
    (phase) => phase.effectiveFrom === null || phase.effectiveFrom < effectiveFrom,
  )
  const base = kept.length > 0 ? kept[kept.length - 1] : sorted[0]
  return [
    ...kept.map((phase, orderIdx) => ({
      orderIdx,
      kind: phase.kind,
      intervalDays: phase.intervalDays,
      repeatCount: phase.repeatCount,
      dose: phase.dose,
      unit: phase.unit,
      effectiveFrom: phase.effectiveFrom,
    })),
    {
      orderIdx: kept.length,
      kind: 'maintenance',
      intervalDays: newIntervalDays,
      repeatCount: 0,
      dose: base.dose,
      unit: base.unit,
      effectiveFrom,
    },
  ]
}
