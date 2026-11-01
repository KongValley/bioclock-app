import { create } from 'zustand'
import { findDiseases, resolveDiseaseIds } from '@/data/diseases'
import {
  injections as injectionRepo,
  medications as medicationRepo,
  regimens as regimenRepo,
  reminderRules,
  settings as settingsRepo,
  symptoms as symptomRepo,
  symptomTags as symptomTagRepo,
} from '@/db/repo'
import { rescheduleAll } from '@/notify/scheduler'
import { importPayload, type ImportResult } from '@/import'
import type { ImportPayload } from '@/import/schema'
import type {
  AppSettings,
  Disease,
  Injection,
  Medication,
  Regimen,
  ReminderRule,
  SymptomLog,
  SymptomTag,
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

export interface AppStore {
  ready: boolean
  refreshing: boolean
  error: string | null
  regimen: Regimen | null
  medication: Medication | null
  medications: Medication[]
  disease: Disease | null
  diseases: Disease[]
  injections: Injection[]
  symptoms: SymptomLog[]
  symptomTags: SymptomTag[]
  reminder: ReminderRule | null
  settings: AppSettings
  reload(): Promise<void>
  addInjection(input: Omit<Injection, 'id' | 'createdAt' | 'updatedAt'>): Promise<MutationResult>
  updateInjection(
    id: string,
    patch: Partial<Omit<Injection, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<MutationResult>
  removeInjection(id: string): Promise<MutationResult>
  addSymptom(input: Omit<SymptomLog, 'id'>): Promise<MutationResult>
  updateSymptom(id: string, patch: Partial<Omit<SymptomLog, 'id'>>): Promise<MutationResult>
  removeSymptom(id: string): Promise<MutationResult>
  addSymptomTag(name: string): Promise<MutationResult>
  removeSymptomTag(id: string): Promise<MutationResult>
  importRecords(
    payload: ImportPayload,
  ): Promise<{ result: ImportResult; notifyWarning: string | null }>
  updateReminder(input: Omit<ReminderRule, 'id'> & { id?: string }): Promise<MutationResult>
  updateSettings(patch: Record<string, string>): Promise<MutationResult>
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

export const useAppStore = create<AppStore>((set) => ({
  ready: false,
  refreshing: false,
  error: null,
  regimen: null,
  medication: null,
  medications: [],
  disease: null,
  diseases: [],
  injections: [],
  symptoms: [],
  symptomTags: [],
  reminder: null,
  settings: {},

  reload: async () => {
    set((state) => ({ refreshing: state.ready, error: null }))
    try {
      const active = await regimenRepo.listActive()
      const [allSettings, allMedications, allSymptoms, allSymptomTags] = await Promise.all([
        settingsRepo.all(),
        medicationRepo.list(),
        symptomRepo.list(),
        symptomTagRepo.list(),
      ])
      const injectionList = await injectionRepo.list(active ? active.id : undefined)
      const reminder = active ? await reminderRules.getFor(active.id) : null
      const medication = active
        ? allMedications.find((item) => item.id === active.medicationId) ?? null
        : null
      const diseases = findDiseases(resolveDiseaseIds(allSettings))

      set({
        ready: true,
        refreshing: false,
        error: null,
        regimen: active,
        medication,
        medications: allMedications,
        disease: diseases[0] ?? null,
        diseases,
        injections: injectionList,
        symptoms: allSymptoms,
        symptomTags: allSymptomTags,
        reminder,
        settings: allSettings,
      })
    } catch (error) {
      set({ ready: true, refreshing: false, error: errorMessage(error) })
      throw error
    }
  },

  addInjection: async (input) => {
    await injectionRepo.create(input)
    return { notifyWarning: await afterWrite() }
  },

  updateInjection: async (id, patch) => {
    await injectionRepo.update(id, patch)
    return { notifyWarning: await afterWrite() }
  },

  removeInjection: async (id) => {
    await injectionRepo.remove(id)
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

  importRecords: async (payload) => {
    const result = await importPayload(payload)
    return { result, notifyWarning: await afterWrite() }
  },

  updateReminder: async (input) => {
    await reminderRules.upsert(input)
    return { notifyWarning: await afterWrite() }
  },

  updateSettings: async (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      await settingsRepo.set(key, value)
    }
    return { notifyWarning: await afterWrite() }
  },
}))
