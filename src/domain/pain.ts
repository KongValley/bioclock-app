/**
 * 临床疼痛评分（NRS, Numeric Rating Scale）。
 *
 * 0–10 整数，0 为无痛、10 为能想象的最剧烈疼痛，是临床上最常用的
 * 单维疼痛强度量表。分档只用于展示与配色，不构成任何医学判断。
 */
export type PainBand = 'none' | 'mild' | 'moderate' | 'severe'

export const PAIN_MIN = 0
export const PAIN_MAX = 10

export function painBand(score: number): PainBand {
  if (score <= 0) return 'none'
  if (score <= 3) return 'mild'
  if (score <= 6) return 'moderate'
  return 'severe'
}

export const PAIN_BAND_VALUES: PainBand[] = ['none', 'mild', 'moderate', 'severe']
