import { create } from 'zustand'
import { findDiseases, resolveDiseaseIds } from '@/data/diseases'
import {
  doseLogs as doseLogRepo,
  efficacyEvents as efficacyEventRepo,
  medications as medicationRepo,
  reminderRules,
  settings as settingsRepo,
  symptoms as symptomRepo,
  symptomTags as symptomTagRepo,
  treatments as treatmentRepo,
  type DoseLogInput,
  type EfficacyEventInput,
  type ReminderRuleInput,
  type TreatmentLineInput,
  type TreatmentPatch,
} from '@/db/repo'
import { rescheduleAll } from '@/notify/scheduler'
import { buildInjectionPlans, selectNextPlan } from '@/domain/schedule'
import { buildIntervalChangePhases } from '@/domain/interval'
import { importPayload, type ImportResult } from '@/import'
import type { ImportPayload } from '@/import/schema'
import type {
  AppSettings,
  Disease,
  DoseLog,
  EfficacyEvent,
  Medication,
  ReminderRuleV5,
  SymptomLog,
  SymptomTag,
  Treatment,
} from '@/types'

/**
 * 全局应用状态。
 *
 * 所有写操作都遵循同一顺序：写入仓库 → 重新读取 → 重新排程通知。
 * 通知排程失败不回滚数据，而是通过 `notifyWarning` 交给调用方 toast 提示。
 */

export interface MutationResult {
  /** 非空表示数据已写入，但刷新或通知排程出了问题，需要提示用户。 */
  notifyWarning: string | null
}

export interface ImportOutcome {
  result: ImportResult
  notifyWarning: string | null
}

/** 保存治疗方案时传入的用药条目：编辑已有条目时带 `id`。 */
export type TreatmentLineDraft = TreatmentLineInput & { id?: string }

export interface SaveTreatmentInput {
  /** 不传表示新建；传了表示编辑已有方案。 */
  id?: string
  name: string
  lines: TreatmentLineDraft[]
}

export interface AppStore {
  ready: boolean
  refreshing: boolean
  error: string | null
  /** 当前激活的治疗方案（含所有用药线 / 阶段 / 口服计划） */
  treatment: Treatment | null
  /** 全部治疗方案 */
  treatments: Treatment[]
  /** 全部用药记录（注射 + 口服） */
  doseLogs: DoseLog[]
  /** 全部疗效事件（疗效下降 / 失效等） */
  efficacyEvents: EfficacyEvent[]
  medications: Medication[]
  symptoms: SymptomLog[]
  symptomTags: SymptomTag[]
  reminder: ReminderRuleV5 | null
  settings: AppSettings
  diseases: Disease[]
  disease: Disease | null
  reload(): Promise<void>
  addDoseLog(input: DoseLogInput): Promise<MutationResult>
  updateDoseLog(id: string, patch: Partial<DoseLogInput>): Promise<MutationResult>
  removeDoseLog(id: string): Promise<MutationResult>
  addEfficacyEvent(input: EfficacyEventInput): Promise<MutationResult>
  removeEfficacyEvent(id: string): Promise<MutationResult>
  setLineEnded(lineId: string, endedAt: number | null): Promise<MutationResult>
  changeInjectionInterval(lineId: string, intervalDays: number): Promise<MutationResult>
  saveTreatment(input: SaveTreatmentInput): Promise<MutationResult>
  setActiveTreatment(id: string, active: boolean): Promise<MutationResult>
  updateReminder(input: ReminderRuleInput): Promise<MutationResult>
  addMedication(input: Omit<Medication, 'id' | 'createdAt'>): Promise<MutationResult>
  updateMedication(
    id: string,
    patch: Partial<
      Pick<
        Medication,
        'name' | 'genericName' | 'brandNames' | 'defaultDose' | 'unit' | 'route' | 'extra'
      >
    >,
  ): Promise<MutationResult>
  removeMedication(id: string): Promise<MutationResult>
  addSymptom(input: Omit<SymptomLog, 'id'>): Promise<MutationResult>
  updateSymptom(id: string, patch: Partial<Omit<SymptomLog, 'id'>>): Promise<MutationResult>
  removeSymptom(id: string): Promise<MutationResult>
  addSymptomTag(name: string): Promise<MutationResult>
  removeSymptomTag(id: string): Promise<MutationResult>
  updateSettings(patch: Record<string, string>): Promise<MutationResult>
  importRecords(payload: ImportPayload): Promise<ImportOutcome>
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '操作失败，请稍后再试'
}

async function rescheduleOrWarning(): Promise<string | null> {
  try {
    await rescheduleAll()
    return null
  } catch (error) {
    return `提醒更新失败：${errorMessage(error)}`
  }
}

async function afterWrite(): Promise<string | null> {
  const warnings: string[] = []
  try {
    await useAppStore.getState().reload()
  } catch (error) {
    warnings.push(`数据刷新失败：${errorMessage(error)}`)
  }
  const scheduleWarning = await rescheduleOrWarning()
  if (scheduleWarning) warnings.push(scheduleWarning)
  return warnings.length > 0 ? warnings.join('；') : null
}

/** 把「编辑治疗方案」的入参映射成仓库的 patch 形状（阶段类型比仓库声明更宽松）。 */
function toLinePatch(line: TreatmentLineDraft): NonNullable<TreatmentPatch['lines']>[number] {
  const patch = {
    id: line.id ?? '',
    medicationId: line.medicationId,
    label: line.label,
    isHost: line.isHost,
    syncWithHost: line.syncWithHost,
    anchor: line.anchor,
    windowDays: line.windowDays,
    phases: line.phases,
    oral: line.oral,
  }
  // phases 的入参是「去掉 id / lineId」的阶段模板，运行时由仓库补 id；类型声明更严，
  // 这里集中做一次断言，避免在调用点散落 any。
  return patch as unknown as NonNullable<TreatmentPatch['lines']>[number]
}

export const useAppStore = create<AppStore>((set) => ({
  ready: false,
  refreshing: false,
  error: null,
  treatment: null,
  treatments: [],
  doseLogs: [],
  efficacyEvents: [],
  medications: [],
  symptoms: [],
  symptomTags: [],
  reminder: null,
  settings: {},
  diseases: [],
  disease: null,

  reload: async () => {
    set((state) => ({ refreshing: state.ready, error: null }))
    try {
      const [
        active,
        allTreatments,
        allSettings,
        allMedications,
        allSymptoms,
        allSymptomTags,
        allDoseLogs,
        allEfficacyEvents,
      ] = await Promise.all([
        treatmentRepo.getActive(),
        treatmentRepo.list(),
        settingsRepo.all(),
        medicationRepo.list(),
        symptomRepo.list(),
        symptomTagRepo.list(),
        doseLogRepo.list(),
        efficacyEventRepo.list(),
      ])
      const reminder = active ? await reminderRules.getFor(active.id) : null
      const diseases = findDiseases(resolveDiseaseIds(allSettings))

      set({
        ready: true,
        refreshing: false,
        error: null,
        treatment: active,
        treatments: allTreatments,
        doseLogs: allDoseLogs,
        efficacyEvents: allEfficacyEvents,
        medications: allMedications,
        symptoms: allSymptoms,
        symptomTags: allSymptomTags,
        reminder,
        settings: allSettings,
        diseases,
        disease: diseases[0] ?? null,
      })
    } catch (error) {
      set({ ready: true, refreshing: false, error: errorMessage(error) })
      throw error
    }
  },

  addDoseLog: async (input) => {
    await doseLogRepo.create(input)
    return { notifyWarning: await afterWrite() }
  },

  updateDoseLog: async (id, patch) => {
    const repoPatch: Partial<DoseLogInput> = { ...patch }
    delete repoPatch.lineId
    await doseLogRepo.update(
      id,
      repoPatch as Partial<Omit<DoseLog, 'id' | 'lineId' | 'createdAt'>>,
    )
    return { notifyWarning: await afterWrite() }
  },

  removeDoseLog: async (id) => {
    await doseLogRepo.remove(id)
    return { notifyWarning: await afterWrite() }
  },

  addEfficacyEvent: async (input) => {
    await efficacyEventRepo.create(input)
    return { notifyWarning: await afterWrite() }
  },

  removeEfficacyEvent: async (id) => {
    await efficacyEventRepo.remove(id)
    return { notifyWarning: await afterWrite() }
  },

  setLineEnded: async (lineId, endedAt) => {
    await treatmentRepo.setLineEnded(lineId, endedAt)
    return { notifyWarning: await afterWrite() }
  },

  changeInjectionInterval: async (lineId, intervalDays) => {
    const treatment = await treatmentRepo.getActive()
    if (!treatment) throw new Error('还没有治疗方案')
    const line = treatment.lines.find((item) => item.id === lineId)
    if (!line || line.kind !== 'injection') throw new Error('找不到要调整的注射线')
    if (line.endedAt !== null) throw new Error('这条用药线已停用，请先恢复')

    const logs = await doseLogRepo.list(lineId)
    const now = Date.now()
    const plans = buildInjectionPlans({ line, logs, now, futureDoseCount: 4 })
    const next = selectNextPlan(plans, now)
    if (!next) throw new Error('这条用药线没有可调整的下一针')

    const phases = buildIntervalChangePhases(line.phases, next.index, intervalDays)
    await treatmentRepo.update(line.treatmentId, {
      lines: [{ id: line.id, phases }],
    })
    return { notifyWarning: await afterWrite() }
  },

  saveTreatment: async (input) => {
    if (input.id === undefined) {
      await treatmentRepo.create({ name: input.name, lines: input.lines })
    } else {
      const current = await treatmentRepo.get(input.id)
      if (!current) throw new Error('治疗方案不存在')
      const linePatches = input.lines
        .filter(
          (line): line is TreatmentLineDraft & { id: string } =>
            typeof line.id === 'string' && line.id !== '',
        )
        .map(toLinePatch)
      const keptIds = new Set(
        input.lines
          .map((line) => line.id)
          .filter((id): id is string => typeof id === 'string' && id !== ''),
      )
      const removeLines = current.lines
        .filter((line) => !keptIds.has(line.id))
        .map((line) => line.id)
      const addLines = input.lines.filter(
        (line): line is TreatmentLineDraft => line.id === undefined,
      )
      await treatmentRepo.update(input.id, {
        name: input.name,
        lines: linePatches,
        removeLines,
        addLines,
      })
    }
    return { notifyWarning: await afterWrite() }
  },

  setActiveTreatment: async (id, active) => {
    await treatmentRepo.setActive(id, active)
    return { notifyWarning: await afterWrite() }
  },

  updateReminder: async (input) => {
    await reminderRules.upsert(input)
    return { notifyWarning: await afterWrite() }
  },

  addMedication: async (input) => {
    await medicationRepo.create(input)
    return { notifyWarning: await afterWrite() }
  },

  updateMedication: async (id, patch) => {
    await medicationRepo.update(id, patch)
    return { notifyWarning: await afterWrite() }
  },

  removeMedication: async (id) => {
    await medicationRepo.remove(id)
    return { notifyWarning: await afterWrite() }
  },

  addSymptom: async (input) => {
    await symptomRepo.create(input)
    return { notifyWarning: await afterWrite() }
  },

  updateSymptom: async (id, patch) => {
    await symptomRepo.update(id, patch)
    return { notifyWarning: await afterWrite() }
  },

  removeSymptom: async (id) => {
    await symptomRepo.remove(id)
    return { notifyWarning: await afterWrite() }
  },

  addSymptomTag: async (name) => {
    await symptomTagRepo.create(name)
    return { notifyWarning: await afterWrite() }
  },

  removeSymptomTag: async (id) => {
    await symptomTagRepo.remove(id)
    return { notifyWarning: await afterWrite() }
  },

  updateSettings: async (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      await settingsRepo.set(key, value)
    }
    return { notifyWarning: await afterWrite() }
  },

  importRecords: async (payload) => {
    const result = await importPayload(payload)
    return { result, notifyWarning: await afterWrite() }
  },
}))
