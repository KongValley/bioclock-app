import type { PhaseKind } from '@/types'

/**
 * 引导页「方案总览」用的阶段预览。
 *
 * 必须与 schedule.ts 的阶段推进口径一致：`repeatCount` 是这一阶段的总针数
 * （0 表示无限维持），而不是「首针之后再重复几次」。否则预览里的剂量和日期
 * 会与保存后首页/通知实际使用的排程不一致。
 */

export interface PreviewPhase {
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  dose: number | null
  unit: string
}

export interface PhasePreviewDose {
  index: number
  dayOffset: number
  kind: PhaseKind
  dose: number | null
  unit: string
}

function phaseAt(phases: PreviewPhase[], index: number): PreviewPhase | null {
  let remaining = index
  for (const phase of phases) {
    if (phase.repeatCount === 0) return phase
    if (remaining < phase.repeatCount) return phase
    remaining -= phase.repeatCount
  }
  return null
}

export function buildPhasePreview(
  phases: PreviewPhase[],
  max: number = 5,
): PhasePreviewDose[] {
  if (phases.length === 0 || max <= 0) return []

  const result: PhasePreviewDose[] = []
  let dayOffset = 0
  for (let index = 0; result.length < max && index < 1000; index += 1) {
    const phase = phaseAt(phases, index)
    if (!phase) break
    result.push({
      index,
      dayOffset,
      kind: phase.kind,
      dose: phase.dose,
      unit: phase.unit,
    })
    const interval = Number.isFinite(phase.intervalDays) && phase.intervalDays > 0
      ? phase.intervalDays
      : 1
    dayOffset += interval
  }
  return result
}
