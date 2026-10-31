import type { Disease } from '@/types'

/**
 * 疾病目录。
 *
 * 用途：让用户在首次配置时先选病种，再看到该病种下常见的生物制剂，
 * 减少「我不记得药名」的输入成本。
 *
 * 重要：本目录只是**录入辅助**，不是诊疗建议。
 * 适应症、剂量、给药间隔一律以医生处方和药品说明书为准。
 */
export const DISEASES: Disease[] = [
  {
    id: 'crohn',
    name: '克罗恩病',
    aliases: ['CD', 'Crohn', '克罗恩'],
    group: 'ibd',
    summary: '炎症性肠病，可累及消化道任何部位，常需长期生物制剂维持缓解。',
  },
  {
    id: 'uc',
    name: '溃疡性结肠炎',
    aliases: ['UC', '溃结'],
    group: 'ibd',
    summary: '炎症性肠病，主要累及结肠黏膜，生物制剂多用于中重度或激素依赖者。',
  },
  {
    id: 'psoriasis',
    name: '银屑病',
    aliases: ['牛皮癣', 'PsO', '斑块状银屑病'],
    group: 'skin',
    summary: '慢性免疫介导的皮肤病，中重度患者常用 IL-17 / IL-23 抑制剂。',
  },
  {
    id: 'psa',
    name: '银屑病关节炎',
    aliases: ['PsA'],
    group: 'joint',
    summary: '银屑病合并关节受累，用药需同时兼顾皮损与关节。',
  },
  {
    id: 'as',
    name: '强直性脊柱炎',
    aliases: ['AS', '中轴型脊柱关节炎', 'axSpA', '强直'],
    group: 'joint',
    summary: '主要累及骶髂关节和脊柱的慢性炎症，TNF 抑制剂与 IL-17 抑制剂为常用选择。',
  },
  {
    id: 'ra',
    name: '类风湿关节炎',
    aliases: ['RA', '类风湿'],
    group: 'joint',
    summary: '对称性多关节滑膜炎，生物制剂通常在甲氨蝶呤基础上联合使用。',
  },
  {
    id: 'ad',
    name: '特应性皮炎',
    aliases: ['AD', '湿疹', '特应性湿疹'],
    group: 'skin',
    summary: '慢性瘙痒性皮肤病，中重度患者可用 IL-4Rα 靶向生物制剂。',
  },
  {
    id: 'csu',
    name: '慢性自发性荨麻疹',
    aliases: ['CSU', '慢性荨麻疹'],
    group: 'skin',
    summary: '抗组胺药控制不佳的风团/血管性水肿，可用抗 IgE 治疗。',
  },
  {
    id: 'sle',
    name: '系统性红斑狼疮',
    aliases: ['SLE', '狼疮'],
    group: 'other',
    summary: '多系统自身免疫病，生物制剂多用于常规治疗控制不佳的活动期患者。',
  },
  {
    id: 'hs',
    name: '化脓性汗腺炎',
    aliases: ['HS', '反向性痤疮'],
    group: 'skin',
    summary: '顶泌汗腺区域的慢性复发性炎症，中重度患者可用 TNF 或 IL-17 抑制剂。',
  },
  {
    id: 'asthma_eos',
    name: '重度嗜酸性哮喘',
    aliases: ['哮喘', '嗜酸粒细胞性哮喘', 'eos asthma'],
    group: 'other',
    summary: '规范吸入治疗仍反复发作的重度哮喘，可按表型选择靶向生物制剂。',
  },
  {
    id: 'uveitis',
    name: '非感染性葡萄膜炎',
    aliases: ['葡萄膜炎', 'uveitis'],
    group: 'other',
    summary: '眼内炎症，反复发作或激素依赖者可用 TNF 抑制剂控制。',
  },
]

export const DISEASE_GROUPS: Array<{ id: Disease['group']; name: string }> = [
  { id: 'ibd', name: '炎症性肠病' },
  { id: 'skin', name: '皮肤疾病' },
  { id: 'joint', name: '关节与脊柱' },
  { id: 'other', name: '其他免疫介导疾病' },
]

export const DISEASE_DISCLAIMER =
  '药名与方案仅用于快速录入，不构成用药建议。适应症、剂量和间隔请以医生处方及药品说明书为准。'

export function findDisease(id: string | null | undefined): Disease | undefined {
  if (!id) return undefined
  return DISEASES.find((item) => item.id === id)
}

export function diseasesByGroup(group: Disease['group']): Disease[] {
  return DISEASES.filter((item) => item.group === group)
}
