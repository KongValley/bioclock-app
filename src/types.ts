export type RegimenAnchor = 'actual' | 'planned'
export type PhaseKind = 'loading' | 'maintenance'
export type WindowStatus = 'early' | 'on_time' | 'late'

export type InjectionSite =
  | 'abdomen_ul' | 'abdomen_ur' | 'abdomen_ll' | 'abdomen_lr'
  | 'thigh_l' | 'thigh_r' | 'arm_l' | 'arm_r'

/** 给药途径：皮下（可自行注射）/ 静脉输注（需到医院） */
export type MedicationRoute = 'sc' | 'iv'

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
  defaultDose: number | null
  unit: string
  color: string
  route: MedicationRoute
  diseaseIds: string[]
  /** 内置目录药品的稳定标识；用户自建药为 null */
  catalogKey: string | null
  isBuiltin: boolean
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
  tags: string[]
  note: string | null
  temperature: number | null
  injectionId: string | null
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
