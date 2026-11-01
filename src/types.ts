export type RegimenAnchor = 'actual' | 'planned'
export type PhaseKind = 'loading' | 'maintenance'
export type WindowStatus = 'early' | 'on_time' | 'late'

export type InjectionSite =
  | 'abdomen_ul' | 'abdomen_ur' | 'abdomen_ll' | 'abdomen_lr'
  | 'thigh_l' | 'thigh_r' | 'arm_l' | 'arm_r'

/** 给药途径：皮下（可自行注射）/ 静脉输注（需到医院）/ 口服 */
export type MedicationRoute = 'sc' | 'iv' | 'oral'

export type DiseaseGroup = 'ibd' | 'skin' | 'joint' | 'other'

export interface Disease {
  id: string
  name: string
  aliases: string[]
  group: DiseaseGroup
  summary: string
}

export interface Medication {
  id: string
  name: string
  genericName: string | null
  brandNames: string[]
  defaultDose: number | null
  unit: string
  color: string
  route: MedicationRoute
  diseaseIds: string[]
  /** 内置目录药品的稳定标识；用户自建药为 null */
  catalogKey: string | null
  isBuiltin: boolean
  /** 预留的扩展字段（导入/导出会原样保留，核心逻辑不读取）。 */
  extra: Record<string, unknown>
  createdAt: number
}

/** 方案模板里的单个阶段（未入库，仅用于预填） */
export interface RegimenPhaseTemplate {
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  dose: number | null
  unit: string
}

export interface RegimenTemplate {
  name: string
  anchor: RegimenAnchor
  windowDays: number
  phases: RegimenPhaseTemplate[]
}

export interface CatalogDrug {
  key: string
  name: string
  genericName: string
  brandNames: string[]
  route: MedicationRoute
  defaultDose: number | null
  unit: string
  color: string
  note?: string
}

export interface DiseaseDrug {
  diseaseId: string
  drugKey: string
  firstLine: boolean
  doseNote?: string
  regimen: RegimenTemplate
}

export interface RegimenPhase {
  id: string
  regimenId: string
  orderIdx: number
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  dose: number | null
  unit: string
}

export interface Regimen {
  id: string
  medicationId: string
  name: string
  anchor: RegimenAnchor
  windowDays: number
  isActive: boolean
  createdAt: number
  phases: RegimenPhase[]
}

export interface Injection {
  id: string
  regimenId: string
  medicationId: string
  injectedAt: number
  dose: number | null
  unit: string
  site: InjectionSite
  lotNumber: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface SymptomLog {
  id: string
  loggedAt: number
  severity: 1 | 2 | 3 | 4 | 5
  /** 临床疼痛评分 NRS 0–10，0 表示无痛；未填写为 null。 */
  painScore: number | null
  tags: string[]
  note: string | null
  temperature: number | null
  injectionId: string | null
}

/** 症状标签：内置一批常用项，用户可自行增删。 */
export interface SymptomTag {
  id: string
  name: string
  isBuiltin: boolean
  sortOrder: number
  createdAt: number
}

export interface ReminderRule {
  id: string
  regimenId: string
  offsets: number[]        // 相对注射日提前的天数，如 [-2, -1, 0]
  timeOfDay: string        // 'HH:mm'
  snoozeMinutes: number
  enabled: boolean
}

export type AppSettings = Record<string, string>

// ---------------------------------------------------------------------------
// v5：治疗方案模型（treatment / treatment_line / treatment_phase / dose_log）
// 上面的 Regimen / Injection 等是 v4 及之前的旧类型，等待统一清理，暂不删除。
// ---------------------------------------------------------------------------

export type LineKind = 'injection' | 'oral'
export type OralFrequency = 'daily' | 'weekly' | 'custom'
/** 打卡状态：已用 / 跳过 / 漏用 */
export type DoseStatus = 'done' | 'skipped' | 'missed'

/** 疗效事件类型：下降 / 失效 / 不耐受 / 抗药抗体 / 其他 */
export type EfficacyKind = 'reduced' | 'failed' | 'intolerance' | 'antibody' | 'other'

export interface TreatmentPhase {
  id: string
  lineId: string
  orderIdx: number
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  dose: number | null
  unit: string
  /** 间隔调整的生效时间；null 表示从第一阶段起按顺序执行 */
  effectiveFrom: number | null
}

/** 口服计划：注射线的 `oral` 为 null */
export interface OralPlan {
  /** 首次服药时间（UTC 毫秒） */
  startDate: number
  /** 疗程天数；null 表示长期服用 */
  durationDays: number | null
  frequency: OralFrequency
  /** 仅 weekly 使用：每周 N 次，按周均匀分布 */
  timesPerPeriod: number
  /** 仅 custom 使用：固定周几，0 = 周日 … 6 = 周六 */
  daysOfWeek: number[]
  /** 提醒时间 'HH:mm' */
  remindTime: string
}

export interface TreatmentLine {
  id: string
  treatmentId: string
  medicationId: string
  kind: LineKind
  label: string
  /** 主药：排程锚点跟随这条线的实际注射时间 */
  isHost: boolean
  /** 注射线是否跟随主药时间一起打 */
  syncWithHost: boolean
  anchor: RegimenAnchor
  windowDays: number
  /** 停用时间；null 表示仍在使用。停用后不再生成未来计划，历史保留。 */
  endedAt: number | null
  /** 仅注射线有意义，口服线为空数组 */
  phases: TreatmentPhase[]
  /** 仅口服线有意义，注射线为 null */
  oral: OralPlan | null
}

/**
 * 疗效事件：记录某个用药线在某一时点疗效下降 / 失效等。
 * `dosesCount` 是事件发生时该线已完成的用药次数快照。
 */
export interface EfficacyEvent {
  id: string
  lineId: string
  kind: EfficacyKind
  occurredAt: number
  dosesCount: number
  note: string | null
  createdAt: number
}

export interface Treatment {
  id: string
  name: string
  isActive: boolean
  createdAt: number
  lines: TreatmentLine[]
}

/** 打卡记录：注射与口服共用一个表 */
export interface DoseLog {
  id: string
  lineId: string
  scheduledAt: number | null
  takenAt: number | null
  status: DoseStatus
  dose: number | null
  unit: string
  site: InjectionSite | null
  lotNumber: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

/** 每个治疗方案一条提醒规则（v5 起用 treatmentId 取代 regimenId） */
export interface ReminderRuleV5 {
  id: string
  treatmentId: string
  offsets: number[]        // 相对计划注射日提前的天数，如 [-2, -1, 0]
  timeOfDay: string        // 'HH:mm'
  snoozeMinutes: number
  enabled: boolean
}
