import type { InjectionSite } from '@/types'

/** 部位轮换只需要「位点 + 时间」，与具体记录模型解耦。 */
export interface SiteHistoryEntry {
  site: InjectionSite
  injectedAt: number
}

/** 8 个皮下注射位点的中文标签 */
export const SITE_LABELS: Record<InjectionSite, string> = {
  abdomen_ul: '腹部左上',
  abdomen_ur: '腹部右上',
  abdomen_ll: '腹部左下',
  abdomen_lr: '腹部右下',
  thigh_l: '左大腿',
  thigh_r: '右大腿',
  arm_l: '左上臂',
  arm_r: '右上臂',
}

/** 固定顺序：腹部优先，其次大腿、上臂 */
export const ALL_SITES: InjectionSite[] = [
  'abdomen_ul',
  'abdomen_ur',
  'abdomen_ll',
  'abdomen_lr',
  'thigh_l',
  'thigh_r',
  'arm_l',
  'arm_r',
]

type Side = 'l' | 'r'

const SITE_SIDE: Record<InjectionSite, Side> = {
  abdomen_ul: 'l',
  abdomen_ur: 'r',
  abdomen_ll: 'l',
  abdomen_lr: 'r',
  thigh_l: 'l',
  thigh_r: 'r',
  arm_l: 'l',
  arm_r: 'r',
}

const ABDOMEN_SITES: InjectionSite[] = [
  'abdomen_ul',
  'abdomen_ur',
  'abdomen_ll',
  'abdomen_lr',
]

/** 统计每个位点的历史使用次数 */
export function siteUsage(injections: SiteHistoryEntry[]): Record<InjectionSite, number> {
  const usage: Record<InjectionSite, number> = {
    abdomen_ul: 0,
    abdomen_ur: 0,
    abdomen_ll: 0,
    abdomen_lr: 0,
    thigh_l: 0,
    thigh_r: 0,
    arm_l: 0,
    arm_r: 0,
  }

  for (const injection of injections) usage[injection.site] += 1

  return usage
}

/**
 * 推荐下一次注射位点。
 * 1. 排除最近 2 次用过的位点
 * 2. 选历史使用次数最少的
 * 3. 同分时优先与最近一次不同侧
 * 4. 仍同分时（默认）腹部优先
 */
export function recommendSite(
  injections: SiteHistoryEntry[],
  opts?: { preferAbdomen?: boolean },
): InjectionSite {
  if (injections.length === 0) return 'abdomen_ul'

  const preferAbdomen = opts?.preferAbdomen ?? true
  const sorted = [...injections].sort((a, b) => a.injectedAt - b.injectedAt)
  const lastSide = SITE_SIDE[sorted[sorted.length - 1].site]

  const recentSites = new Set(sorted.slice(-2).map((injection) => injection.site))
  let candidates = ALL_SITES.filter((site) => !recentSites.has(site))
  if (candidates.length === 0) candidates = [...ALL_SITES]

  const usage = siteUsage(injections)
  const minUsage = Math.min(...candidates.map((site) => usage[site]))
  candidates = candidates.filter((site) => usage[site] === minUsage)

  const oppositeSide = candidates.filter((site) => SITE_SIDE[site] !== lastSide)
  if (oppositeSide.length > 0) candidates = oppositeSide

  if (preferAbdomen) {
    const abdomen = candidates.filter((site) => ABDOMEN_SITES.includes(site))
    if (abdomen.length > 0) candidates = abdomen
  }

  // ALL_SITES 固定顺序保证结果确定；理论上 candidates 不会为空。
  return candidates[0] ?? 'abdomen_ul'
}
