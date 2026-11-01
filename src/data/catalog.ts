import type {
  CatalogDrug,
  DiseaseDrug,
  PhaseKind,
  RegimenPhaseTemplate,
  RegimenTemplate,
} from '@/types'

/**
 * 生物制剂目录 + 病种映射。
 *
 * ⚠️ 内容说明
 * - 药名、常规剂量与给药间隔整理自国内常见说明书与临床指南，**仅用于减少录入成本**。
 * - 实际适应症、剂量（尤其按体重计算）、诱导期长短，一律以医生处方为准。
 * - 新药、罕见病、临床试验用药：请用「自定义药物」录入。
 * - 这里只收录皮下注射 / 静脉输注的生物制剂，不含口服小分子（如托法替布、乌帕替尼）。
 */

const ph = (
  kind: PhaseKind,
  intervalDays: number,
  repeatCount: number,
  dose: number | null,
  unit = 'mg',
): RegimenPhaseTemplate => ({ kind, intervalDays, repeatCount, dose, unit })

const regimen = (
  name: string,
  phases: RegimenPhaseTemplate[],
  windowDays = 2,
): RegimenTemplate => ({ name, anchor: 'actual', windowDays, phases })

// ---------------------------------------------------------------------------
// 药品
// ---------------------------------------------------------------------------

export const CATALOG_DRUGS: CatalogDrug[] = [
  // TNF-α 抑制剂
  {
    key: 'adalimumab',
    name: '阿达木单抗',
    genericName: '阿达木单抗',
    brandNames: [
      '修美乐',
      '格乐立',
      '安健宁',
      '苏立信',
      '汉达远',
      '君迈康',
      '安佳润',
      '泰博维',
    ],
    route: 'sc',
    defaultDose: 40,
    unit: 'mg',
    color: '#2B6CB0',
  },
  {
    key: 'infliximab',
    name: '英夫利西单抗',
    genericName: '英夫利西单抗',
    brandNames: ['类克', '类停', '安佰特', '佳佑健'],
    route: 'iv',
    defaultDose: 5,
    unit: 'mg/kg',
    color: '#2C5282',
    note: '静脉输注，需在医院完成；剂量按体重计算。原研为类克，国内另有类停、安佰特、佳佑健等生物类似药',
  },
  {
    key: 'etanercept',
    name: '依那西普',
    genericName: '依那西普',
    brandNames: ['恩利'],
    route: 'sc',
    defaultDose: 50,
    unit: 'mg',
    color: '#C53030',
    note: '原研药。国产的益赛普、强克、安佰诺是受体-抗体融合蛋白，见另一条目',
  },
  {
    key: 'tnfr_fc',
    name: '重组人Ⅱ型 TNF 受体-抗体融合蛋白',
    genericName: '重组人Ⅱ型肿瘤坏死因子受体-抗体融合蛋白',
    brandNames: ['益赛普', '强克', '安佰诺'],
    route: 'sc',
    defaultDose: 25,
    unit: 'mg',
    color: '#9B2C2C',
    note: '与依那西普作用机制同类（TNF 受体-抗体融合蛋白），但通用名不同；剂量与间隔以处方为准',
  },
  {
    key: 'golimumab',
    name: '戈利木单抗',
    genericName: '戈利木单抗',
    brandNames: ['欣普尼'],
    route: 'sc',
    defaultDose: 50,
    unit: 'mg',
    color: '#B7791F',
  },
  {
    key: 'certolizumab',
    name: '赛妥珠单抗',
    genericName: '聚乙二醇化赛妥珠单抗',
    brandNames: ['希敏佳'],
    route: 'sc',
    defaultDose: 200,
    unit: 'mg',
    color: '#975A16',
  },
  // IL-12/23 与 IL-23
  {
    key: 'ustekinumab',
    name: '乌司奴单抗',
    genericName: '乌司奴单抗',
    brandNames: ['喜达诺'],
    route: 'sc',
    defaultDose: 90,
    unit: 'mg',
    color: '#6B46C1',
    note: '部分适应症需先静脉诱导，再皮下维持',
  },
  {
    key: 'risankizumab',
    name: '瑞莎珠单抗',
    genericName: '瑞莎珠单抗',
    brandNames: ['Skyrizi'],
    route: 'sc',
    defaultDose: 150,
    unit: 'mg',
    color: '#553C9A',
    note: '克罗恩病为静脉诱导后皮下维持；国内可及性请咨询医生',
  },
  {
    key: 'guselkumab',
    name: '古塞奇尤单抗',
    genericName: '古塞奇尤单抗',
    brandNames: ['特诺雅'],
    route: 'sc',
    defaultDose: 100,
    unit: 'mg',
    color: '#44337A',
  },
  // IL-17
  {
    key: 'secukinumab',
    name: '司库奇尤单抗',
    genericName: '司库奇尤单抗',
    brandNames: ['可善挺'],
    route: 'sc',
    defaultDose: 300,
    unit: 'mg',
    color: '#2F855A',
  },
  {
    key: 'ixekizumab',
    name: '依奇珠单抗',
    genericName: '依奇珠单抗',
    brandNames: ['拓咨'],
    route: 'sc',
    defaultDose: 80,
    unit: 'mg',
    color: '#276749',
  },
  // 肠道选择性
  {
    key: 'vedolizumab',
    name: '维得利珠单抗',
    genericName: '维得利珠单抗',
    brandNames: ['安吉优'],
    route: 'iv',
    defaultDose: 300,
    unit: 'mg',
    color: '#2C7A7B',
    note: '静脉输注，需在医院完成',
  },
  // IL-4Rα
  {
    key: 'dupilumab',
    name: '度普利尤单抗',
    genericName: '度普利尤单抗',
    brandNames: ['达必妥'],
    route: 'sc',
    defaultDose: 300,
    unit: 'mg',
    color: '#DD6B20',
  },
  {
    key: 'stapokibart',
    name: '司普奇拜单抗',
    genericName: '司普奇拜单抗',
    brandNames: ['康悦达'],
    route: 'sc',
    defaultDose: 300,
    unit: 'mg',
    color: '#C05621',
    note: '国产 IL-4Rα 单抗',
  },
  // IgE / 嗜酸粒细胞
  {
    key: 'omalizumab',
    name: '奥马珠单抗',
    genericName: '奥马珠单抗',
    brandNames: ['茁乐'],
    route: 'sc',
    defaultDose: 300,
    unit: 'mg',
    color: '#0987A0',
    note: '哮喘适应症的剂量按体重与 IgE 水平确定',
  },
  {
    key: 'mepolizumab',
    name: '美泊利单抗',
    genericName: '美泊利单抗',
    brandNames: ['新可来'],
    route: 'sc',
    defaultDose: 100,
    unit: 'mg',
    color: '#0F766E',
  },
  {
    key: 'benralizumab',
    name: '本瑞利珠单抗',
    genericName: '本瑞利珠单抗',
    brandNames: ['Fasenra'],
    route: 'sc',
    defaultDose: 30,
    unit: 'mg',
    color: '#285E61',
  },
  // 其他靶点
  {
    key: 'tocilizumab',
    name: '托珠单抗',
    genericName: '托珠单抗',
    brandNames: ['雅美罗', '安佰欣'],
    route: 'iv',
    defaultDose: 8,
    unit: 'mg/kg',
    color: '#744210',
    note: '静脉 8mg/kg 每 4 周；也有皮下 162mg 每周方案',
  },
  {
    key: 'abatacept',
    name: '阿巴西普',
    genericName: '阿巴西普',
    brandNames: ['恩瑞舒'],
    route: 'sc',
    defaultDose: 125,
    unit: 'mg',
    color: '#6B21A8',
  },
  {
    key: 'rituximab',
    name: '利妥昔单抗',
    genericName: '利妥昔单抗',
    brandNames: ['美罗华', '汉利康'],
    route: 'iv',
    defaultDose: 1000,
    unit: 'mg',
    color: '#4A5568',
    note: '静脉输注，通常在医院完成；间隔由医生决定',
  },
  {
    key: 'belimumab',
    name: '贝利尤单抗',
    genericName: '贝利尤单抗',
    brandNames: ['倍力腾'],
    route: 'sc',
    defaultDose: 200,
    unit: 'mg',
    color: '#3182CE',
  },
  {
    key: 'telitacicept',
    name: '泰它西普',
    genericName: '泰它西普',
    brandNames: ['泰爱'],
    route: 'sc',
    defaultDose: 160,
    unit: 'mg',
    color: '#805AD5',
  },
]

export const DRUGS_BY_KEY: Record<string, CatalogDrug> = Object.fromEntries(
  CATALOG_DRUGS.map((drug) => [drug.key, drug]),
)

// ---------------------------------------------------------------------------
// 病种 → 药品（含方案模板）
// ---------------------------------------------------------------------------

export const DISEASE_DRUGS: DiseaseDrug[] = [
  // ======================= 克罗恩病 =======================
  {
    diseaseId: 'crohn',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '第 0 周 160mg，第 2 周 80mg，第 4 周起 40mg 每 2 周',
    regimen: regimen('克罗恩病诱导 + 维持', [
      ph('loading', 14, 1, 160),
      ph('loading', 14, 1, 80),
      ph('maintenance', 14, 0, 40),
    ]),
  },
  {
    diseaseId: 'crohn',
    drugKey: 'infliximab',
    firstLine: true,
    doseNote: '第 0、2、6 周诱导，之后每 8 周；剂量按体重 5mg/kg',
    regimen: regimen(
      '克罗恩病 0/2/6 周诱导 + 每 8 周维持',
      [ph('loading', 28, 2, 5, 'mg/kg'), ph('maintenance', 56, 0, 5, 'mg/kg')],
      3,
    ),
  },
  {
    diseaseId: 'crohn',
    drugKey: 'ustekinumab',
    firstLine: true,
    doseNote:
      '静脉诱导按体重：≤55kg 260mg，55–85kg 390mg，>85kg 520mg；第 8 周起皮下 90mg 每 8 周',
    regimen: regimen(
      '克罗恩病静脉诱导 + 皮下维持',
      [ph('loading', 56, 1, 390), ph('maintenance', 56, 0, 90)],
      3,
    ),
  },
  {
    diseaseId: 'crohn',
    drugKey: 'vedolizumab',
    firstLine: true,
    doseNote: '第 0、2、6 周各 300mg，之后每 8 周',
    regimen: regimen(
      '维得利珠单抗 0/2/6 周诱导',
      [ph('loading', 28, 2, 300), ph('maintenance', 56, 0, 300)],
      3,
    ),
  },
  {
    diseaseId: 'crohn',
    drugKey: 'risankizumab',
    firstLine: false,
    doseNote: '静脉 600mg 第 0、4、8 周，之后皮下 180mg 每 8 周',
    regimen: regimen(
      '瑞莎珠单抗静脉诱导 + 皮下维持',
      [ph('loading', 28, 2, 600), ph('maintenance', 56, 0, 180)],
      3,
    ),
  },

  // ======================= 溃疡性结肠炎 =======================
  {
    diseaseId: 'uc',
    drugKey: 'infliximab',
    firstLine: true,
    doseNote: '第 0、2、6 周诱导，之后每 8 周；剂量按体重 5mg/kg',
    regimen: regimen(
      '溃疡性结肠炎 0/2/6 周诱导',
      [ph('loading', 28, 2, 5, 'mg/kg'), ph('maintenance', 56, 0, 5, 'mg/kg')],
      3,
    ),
  },
  {
    diseaseId: 'uc',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '第 0 周 160mg，第 2 周 80mg，第 4 周起 40mg 每 2 周',
    regimen: regimen('溃疡性结肠炎诱导 + 维持', [
      ph('loading', 14, 1, 160),
      ph('loading', 14, 1, 80),
      ph('maintenance', 14, 0, 40),
    ]),
  },
  {
    diseaseId: 'uc',
    drugKey: 'vedolizumab',
    firstLine: true,
    doseNote: '第 0、2、6 周各 300mg，之后每 8 周',
    regimen: regimen(
      '维得利珠单抗 0/2/6 周诱导',
      [ph('loading', 28, 2, 300), ph('maintenance', 56, 0, 300)],
      3,
    ),
  },
  {
    diseaseId: 'uc',
    drugKey: 'ustekinumab',
    firstLine: true,
    doseNote: '静脉诱导 130mg（或按体重 6mg/kg），第 8 周起皮下 90mg 每 8 周',
    regimen: regimen(
      '乌司奴单抗静脉诱导 + 皮下维持',
      [ph('loading', 56, 1, 130), ph('maintenance', 56, 0, 90)],
      3,
    ),
  },
  {
    diseaseId: 'uc',
    drugKey: 'golimumab',
    firstLine: false,
    doseNote: '第 0 周 200mg，第 2 周 100mg，之后 50mg 每 4 周',
    regimen: regimen('戈利木单抗诱导 + 维持', [
      ph('loading', 14, 1, 200),
      ph('loading', 14, 1, 100),
      ph('maintenance', 28, 0, 50),
    ]),
  },

  // ======================= 银屑病 =======================
  {
    diseaseId: 'psoriasis',
    drugKey: 'secukinumab',
    firstLine: true,
    doseNote: '第 0–4 周每周 300mg，第 5 周起每 4 周 300mg',
    regimen: regimen('司库奇尤单抗 5 周诱导 + 每 4 周', [
      ph('loading', 7, 4, 300),
      ph('maintenance', 28, 0, 300),
    ]),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'ixekizumab',
    firstLine: true,
    doseNote: '第 0 周 160mg，第 2–12 周每 2 周 80mg，之后每 4 周 80mg',
    regimen: regimen('依奇珠单抗诱导 + 每 4 周', [
      ph('loading', 14, 1, 160),
      ph('loading', 14, 5, 80),
      ph('maintenance', 28, 0, 80),
    ]),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '首剂 80mg，第 2 周起 40mg 每 2 周',
    regimen: regimen('阿达木单抗 首剂 80mg + 每 2 周', [
      ph('loading', 14, 1, 80),
      ph('maintenance', 14, 0, 40),
    ]),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'ustekinumab',
    firstLine: true,
    doseNote: '第 0、4 周各一次，之后每 12 周；体重 >100kg 可用 90mg',
    regimen: regimen(
      '乌司奴单抗 0/4 周 + 每 12 周',
      [ph('loading', 28, 1, 45), ph('maintenance', 84, 0, 45)],
      5,
    ),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'guselkumab',
    firstLine: false,
    doseNote: '第 0、4 周各 100mg，之后每 8 周',
    regimen: regimen(
      '古塞奇尤单抗 0/4 周 + 每 8 周',
      [ph('loading', 28, 1, 100), ph('maintenance', 56, 0, 100)],
      3,
    ),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'risankizumab',
    firstLine: false,
    doseNote: '第 0、4 周各 150mg，之后每 12 周',
    regimen: regimen(
      '瑞莎珠单抗 0/4 周 + 每 12 周',
      [ph('loading', 28, 1, 150), ph('maintenance', 84, 0, 150)],
      5,
    ),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'etanercept',
    firstLine: false,
    doseNote: '50mg 每周一次（或 25mg 每周两次）',
    regimen: regimen('依那西普 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'psoriasis',
    drugKey: 'tnfr_fc',
    firstLine: false,
    doseNote: '50mg 每周一次，或 25mg 每周两次（总量相同）',
    regimen: regimen('受体-抗体融合蛋白 每周一次', [ph('maintenance', 7, 0, 50)]),
  },

  // ======================= 银屑病关节炎 =======================
  {
    diseaseId: 'psa',
    drugKey: 'secukinumab',
    firstLine: true,
    doseNote: '第 0–4 周每周 300mg，之后每 4 周 300mg',
    regimen: regimen('司库奇尤单抗 5 周诱导 + 每 4 周', [
      ph('loading', 7, 4, 300),
      ph('maintenance', 28, 0, 300),
    ]),
  },
  {
    diseaseId: 'psa',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '40mg 每 2 周',
    regimen: regimen('阿达木单抗 每 2 周', [ph('maintenance', 14, 0, 40)]),
  },
  {
    diseaseId: 'psa',
    drugKey: 'etanercept',
    firstLine: true,
    doseNote: '50mg 每周一次',
    regimen: regimen('依那西普 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'psa',
    drugKey: 'tnfr_fc',
    firstLine: false,
    doseNote: '50mg 每周一次，或 25mg 每周两次（总量相同）',
    regimen: regimen('受体-抗体融合蛋白 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'psa',
    drugKey: 'ixekizumab',
    firstLine: false,
    doseNote: '第 0 周 160mg，之后 80mg 每 4 周',
    regimen: regimen('依奇珠单抗 首剂 160mg + 每 4 周', [
      ph('loading', 28, 1, 160),
      ph('maintenance', 28, 0, 80),
    ]),
  },
  {
    diseaseId: 'psa',
    drugKey: 'ustekinumab',
    firstLine: false,
    doseNote: '第 0、4 周各一次，之后每 12 周',
    regimen: regimen(
      '乌司奴单抗 0/4 周 + 每 12 周',
      [ph('loading', 28, 1, 45), ph('maintenance', 84, 0, 45)],
      5,
    ),
  },
  {
    diseaseId: 'psa',
    drugKey: 'guselkumab',
    firstLine: false,
    doseNote: '第 0、4 周各 100mg，之后每 8 周',
    regimen: regimen(
      '古塞奇尤单抗 0/4 周 + 每 8 周',
      [ph('loading', 28, 1, 100), ph('maintenance', 56, 0, 100)],
      3,
    ),
  },
  {
    diseaseId: 'psa',
    drugKey: 'golimumab',
    firstLine: false,
    doseNote: '50mg 每 4 周',
    regimen: regimen('戈利木单抗 每 4 周', [ph('maintenance', 28, 0, 50)]),
  },
  {
    diseaseId: 'psa',
    drugKey: 'certolizumab',
    firstLine: false,
    doseNote: '第 0、2、4 周各 400mg，之后 200mg 每 2 周',
    regimen: regimen('赛妥珠单抗 诱导 + 每 2 周', [
      ph('loading', 14, 2, 400),
      ph('maintenance', 14, 0, 200),
    ]),
  },

  // ======================= 强直性脊柱炎 =======================
  {
    diseaseId: 'as',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '40mg 每 2 周',
    regimen: regimen('阿达木单抗 每 2 周', [ph('maintenance', 14, 0, 40)]),
  },
  {
    diseaseId: 'as',
    drugKey: 'etanercept',
    firstLine: true,
    doseNote: '50mg 每周一次',
    regimen: regimen('依那西普 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'as',
    drugKey: 'tnfr_fc',
    firstLine: false,
    doseNote: '50mg 每周一次，或 25mg 每周两次（总量相同）',
    regimen: regimen('受体-抗体融合蛋白 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'as',
    drugKey: 'secukinumab',
    firstLine: true,
    doseNote: '第 0–4 周每周 150mg，之后每 4 周 150mg；部分患者用 300mg',
    regimen: regimen('司库奇尤单抗 5 周诱导 + 每 4 周', [
      ph('loading', 7, 4, 150),
      ph('maintenance', 28, 0, 150),
    ]),
  },
  {
    diseaseId: 'as',
    drugKey: 'ixekizumab',
    firstLine: false,
    doseNote: '首剂 80mg（部分方案 160mg），之后 80mg 每 4 周',
    regimen: regimen('依奇珠单抗 每 4 周', [
      ph('loading', 28, 1, 80),
      ph('maintenance', 28, 0, 80),
    ]),
  },
  {
    diseaseId: 'as',
    drugKey: 'golimumab',
    firstLine: false,
    doseNote: '50mg 每 4 周',
    regimen: regimen('戈利木单抗 每 4 周', [ph('maintenance', 28, 0, 50)]),
  },
  {
    diseaseId: 'as',
    drugKey: 'certolizumab',
    firstLine: false,
    doseNote: '第 0、2、4 周各 400mg，之后 200mg 每 2 周',
    regimen: regimen('赛妥珠单抗 诱导 + 每 2 周', [
      ph('loading', 14, 2, 400),
      ph('maintenance', 14, 0, 200),
    ]),
  },
  {
    diseaseId: 'as',
    drugKey: 'infliximab',
    firstLine: false,
    doseNote: '第 0、2、6 周诱导，之后每 6–8 周；剂量按体重 5mg/kg',
    regimen: regimen(
      '英夫利西单抗 0/2/6 周诱导',
      [ph('loading', 28, 2, 5, 'mg/kg'), ph('maintenance', 56, 0, 5, 'mg/kg')],
      3,
    ),
  },

  // ======================= 类风湿关节炎 =======================
  {
    diseaseId: 'ra',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '40mg 每 2 周，通常联合甲氨蝶呤',
    regimen: regimen('阿达木单抗 每 2 周', [ph('maintenance', 14, 0, 40)]),
  },
  {
    diseaseId: 'ra',
    drugKey: 'etanercept',
    firstLine: true,
    doseNote: '50mg 每周一次（或 25mg 每周两次）',
    regimen: regimen('依那西普 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'ra',
    drugKey: 'tnfr_fc',
    firstLine: false,
    doseNote: '50mg 每周一次，或 25mg 每周两次（总量相同）',
    regimen: regimen('受体-抗体融合蛋白 每周一次', [ph('maintenance', 7, 0, 50)]),
  },
  {
    diseaseId: 'ra',
    drugKey: 'tocilizumab',
    firstLine: true,
    doseNote: '静脉 8mg/kg 每 4 周；或皮下 162mg 每周一次',
    regimen: regimen(
      '托珠单抗 每 4 周',
      [ph('maintenance', 28, 0, 8, 'mg/kg')],
      3,
    ),
  },
  {
    diseaseId: 'ra',
    drugKey: 'golimumab',
    firstLine: false,
    doseNote: '50mg 每 4 周',
    regimen: regimen('戈利木单抗 每 4 周', [ph('maintenance', 28, 0, 50)]),
  },
  {
    diseaseId: 'ra',
    drugKey: 'certolizumab',
    firstLine: false,
    doseNote: '第 0、2、4 周各 400mg，之后 200mg 每 2 周',
    regimen: regimen('赛妥珠单抗 诱导 + 每 2 周', [
      ph('loading', 14, 2, 400),
      ph('maintenance', 14, 0, 200),
    ]),
  },
  {
    diseaseId: 'ra',
    drugKey: 'abatacept',
    firstLine: false,
    doseNote: '皮下 125mg 每周一次；静脉方案按体重计算',
    regimen: regimen('阿巴西普 每周一次', [ph('maintenance', 7, 0, 125)]),
  },
  {
    diseaseId: 'ra',
    drugKey: 'rituximab',
    firstLine: false,
    doseNote: '第 1 天与第 15 天各 1000mg，之后 6–12 个月按医嘱重复；需联合甲氨蝶呤',
    regimen: regimen(
      '利妥昔单抗 两剂诱导',
      [ph('loading', 14, 1, 1000), ph('maintenance', 168, 0, 1000)],
      7,
    ),
  },
  {
    diseaseId: 'ra',
    drugKey: 'infliximab',
    firstLine: false,
    doseNote: '第 0、2、6 周诱导，之后每 8 周；剂量按体重 3mg/kg',
    regimen: regimen(
      '英夫利西单抗 0/2/6 周诱导',
      [ph('loading', 28, 2, 3, 'mg/kg'), ph('maintenance', 56, 0, 3, 'mg/kg')],
      3,
    ),
  },

  // ======================= 特应性皮炎 =======================
  {
    diseaseId: 'ad',
    drugKey: 'dupilumab',
    firstLine: true,
    doseNote: '首剂 600mg，之后 300mg 每 2 周',
    regimen: regimen('度普利尤单抗 首剂 600mg + 每 2 周', [
      ph('loading', 14, 1, 600),
      ph('maintenance', 14, 0, 300),
    ]),
  },
  {
    diseaseId: 'ad',
    drugKey: 'stapokibart',
    firstLine: true,
    doseNote: '首剂 600mg，之后 300mg 每 2 周',
    regimen: regimen('司普奇拜单抗 首剂 600mg + 每 2 周', [
      ph('loading', 14, 1, 600),
      ph('maintenance', 14, 0, 300),
    ]),
  },

  // ======================= 慢性自发性荨麻疹 =======================
  {
    diseaseId: 'csu',
    drugKey: 'omalizumab',
    firstLine: true,
    doseNote: '300mg 每 4 周',
    regimen: regimen('奥马珠单抗 每 4 周', [ph('maintenance', 28, 0, 300)]),
  },
  {
    diseaseId: 'csu',
    drugKey: 'dupilumab',
    firstLine: false,
    doseNote: '300mg 每 2 周；国内该适应症获批较晚，以处方为准',
    regimen: regimen('度普利尤单抗 每 2 周', [ph('maintenance', 14, 0, 300)]),
  },

  // ======================= 系统性红斑狼疮 =======================
  {
    diseaseId: 'sle',
    drugKey: 'belimumab',
    firstLine: true,
    doseNote: '皮下 200mg 每周一次；或静脉 10mg/kg 每 4 周',
    regimen: regimen('贝利尤单抗 每周一次', [ph('maintenance', 7, 0, 200)]),
  },
  {
    diseaseId: 'sle',
    drugKey: 'telitacicept',
    firstLine: true,
    doseNote: '160mg 每周一次',
    regimen: regimen('泰它西普 每周一次', [ph('maintenance', 7, 0, 160)]),
  },

  // ======================= 化脓性汗腺炎 =======================
  {
    diseaseId: 'hs',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '第 0 周 160mg，第 2 周 80mg，第 4 周起 40mg 每周',
    regimen: regimen('阿达木单抗 诱导 + 每周', [
      ph('loading', 14, 1, 160),
      ph('loading', 14, 1, 80),
      ph('maintenance', 7, 0, 40),
    ]),
  },
  {
    diseaseId: 'hs',
    drugKey: 'secukinumab',
    firstLine: false,
    doseNote: '300mg 每 4 周',
    regimen: regimen('司库奇尤单抗 每 4 周', [ph('maintenance', 28, 0, 300)]),
  },

  // ======================= 重度嗜酸性哮喘 =======================
  {
    diseaseId: 'asthma_eos',
    drugKey: 'omalizumab',
    firstLine: true,
    doseNote: '剂量按体重与 IgE 水平确定，通常每 2 或 4 周一次',
    regimen: regimen('奥马珠单抗 每 4 周', [ph('maintenance', 28, 0, 300)], 5),
  },
  {
    diseaseId: 'asthma_eos',
    drugKey: 'mepolizumab',
    firstLine: true,
    doseNote: '100mg 每 4 周',
    regimen: regimen('美泊利单抗 每 4 周', [ph('maintenance', 28, 0, 100)], 5),
  },
  {
    diseaseId: 'asthma_eos',
    drugKey: 'benralizumab',
    firstLine: false,
    doseNote: '前 3 次每 4 周 30mg，之后每 8 周 30mg',
    regimen: regimen('本瑞利珠单抗 诱导 + 每 8 周', [
      ph('loading', 28, 3, 30),
      ph('maintenance', 56, 0, 30),
    ], 5),
  },
  {
    diseaseId: 'asthma_eos',
    drugKey: 'dupilumab',
    firstLine: false,
    doseNote: '300mg 每 2 周（部分患者首剂 600mg）',
    regimen: regimen('度普利尤单抗 每 2 周', [ph('maintenance', 14, 0, 300)], 5),
  },

  // ======================= 非感染性葡萄膜炎 =======================
  {
    diseaseId: 'uveitis',
    drugKey: 'adalimumab',
    firstLine: true,
    doseNote: '首剂 80mg，之后 40mg 每 2 周',
    regimen: regimen('阿达木单抗 首剂 80mg + 每 2 周', [
      ph('loading', 14, 1, 80),
      ph('maintenance', 14, 0, 40),
    ]),
  },
  {
    diseaseId: 'uveitis',
    drugKey: 'infliximab',
    firstLine: false,
    doseNote: '第 0、2、6 周诱导，之后每 8 周；剂量按体重 5mg/kg',
    regimen: regimen(
      '英夫利西单抗 0/2/6 周诱导',
      [ph('loading', 28, 2, 5, 'mg/kg'), ph('maintenance', 56, 0, 5, 'mg/kg')],
      3,
    ),
  },
]

/** 某病种的可选药品，一线在前。 */
export function drugsForDisease(diseaseId: string): Array<{ drug: CatalogDrug; entry: DiseaseDrug }> {
  return DISEASE_DRUGS.filter((entry) => entry.diseaseId === diseaseId)
    .map((entry) => ({ drug: DRUGS_BY_KEY[entry.drugKey], entry }))
    .filter((item): item is { drug: CatalogDrug; entry: DiseaseDrug } => Boolean(item.drug))
    .sort((a, b) => Number(b.entry.firstLine) - Number(a.entry.firstLine))
}

/**
 * 多个病种的可选药品并集。
 * 同一种药被多个病种收录时只保留一条；只要在任一病种里是一线，就按一线排前面。
 */
export function drugsForDiseases(
  diseaseIds: string[],
): Array<{ drug: CatalogDrug; entry: DiseaseDrug }> {
  const wanted = new Set(diseaseIds.filter((id) => id !== ''))
  if (wanted.size === 0) return []

  const byDrug = new Map<string, { drug: CatalogDrug; entry: DiseaseDrug }>()
  for (const diseaseId of diseaseIds) {
    if (!wanted.has(diseaseId)) continue
    for (const entry of DISEASE_DRUGS) {
      if (entry.diseaseId !== diseaseId) continue
      const drug = DRUGS_BY_KEY[entry.drugKey]
      if (!drug) continue
      const existing = byDrug.get(drug.key)
      if (!existing || (!existing.entry.firstLine && entry.firstLine)) {
        byDrug.set(drug.key, { drug, entry })
      }
    }
  }

  return Array.from(byDrug.values()).sort(
    (a, b) => Number(b.entry.firstLine) - Number(a.entry.firstLine),
  )
}

/** 某药品覆盖的病种 id 列表，写入 medication.disease_ids。 */
export function diseaseIdsForDrug(drugKey: string): string[] {
  return Array.from(
    new Set(DISEASE_DRUGS.filter((entry) => entry.drugKey === drugKey).map((e) => e.diseaseId)),
  )
}

/** 多病种下某种药对应的方案模板（取第一个命中的病种）。 */
export function regimenForDiseases(diseaseIds: string[], drugKey: string): DiseaseDrug | undefined {
  return DISEASE_DRUGS.find(
    (entry) => diseaseIds.includes(entry.diseaseId) && entry.drugKey === drugKey,
  )
}

export function regimenFor(diseaseId: string, drugKey: string): DiseaseDrug | undefined {
  return DISEASE_DRUGS.find((e) => e.diseaseId === diseaseId && e.drugKey === drugKey)
}
