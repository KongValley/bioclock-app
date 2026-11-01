import { getDatabase } from '@/db'
import {
  doseLogs as doseLogRepo,
  efficacyEvents as efficacyEventRepo,
  medications as medicationRepo,
  symptoms as symptomRepo,
  symptomTags as symptomTagRepo,
  treatments as treatmentRepo,
  type DoseLogInput,
  type TreatmentLineInput,
} from '@/db/repo'
import type { DoseLog, Medication, SymptomLog, TreatmentLine } from '@/types'
import { findMedicationByName, normalizeMedicationName } from '@/domain/medication'
import type { ImportInjection, ImportMedication, ImportOralLog, ImportPayload } from './schema'

/**
 * 把解析好的导入数据写进数据库（v2）。
 *
 * - 先合并药物：能按名字/别名匹配到已有药就只补空字段并合并商品名；匹配不到就建自定义药。
 * - 注射/口服记录会对应到当前治疗方案里“同一种药”的用药线；
 *   如果这个药还没有线，会自动补一条（注射线按导入记录的中位间隔，口服线默认每天一次），
 *   并在确认框里提前告诉用户会新建几条线。
 * - 症状里的新标签会自动补进症状标签表。
 * - 整个文件在一个事务里写入；`previewImport` 用同样的逻辑只算数量、不写库。
 */
export interface ImportResult {
  /** 新写入的注射记录数 */
  injections: number
  /** 新写入的口服打卡数 */
  oralLogs: number
  /** 新写入的症状记录数 */
  symptoms: number
  /** 重复记录跳过的条数 */
  skipped: number
  /** 找不到对应用药线而跳过的条数 */
  skippedNoLine: number
  /** 新建的症状标签数 */
  tags: number
  /** 新建的自定义药物数 */
  medicationsCreated: number
  /** 自动新建的用药线数 */
  linesCreated: number
  /** 恢复的疗效事件数 */
  efficacyEvents: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const IMPORT_MEDICATION_COLORS = [
  '#2B6CB0',
  '#2C5282',
  '#C53030',
  '#2F855A',
  '#6B46C1',
  '#B7791F',
  '#4A5568',
]

type MedicationPatch = Partial<
  Pick<Medication, 'genericName' | 'brandNames' | 'defaultDose' | 'unit'>
>

interface PendingDoseLog {
  input: DoseLogInput
  time: number
  /** 现有线用 `existing:<id>`；新线用 `new:<kind>:<medicationId>` */
  lineKey: string
}

interface PendingLine {
  key: string
  kind: 'injection' | 'oral'
  medicationId: string
  input: TreatmentLineInput
}

function minuteKey(timestamp: number): number {
  return Math.floor(timestamp / 60_000)
}

function logTimeOf(log: DoseLog): number {
  return log.takenAt ?? log.scheduledAt ?? log.createdAt
}

function symptomKey(row: Pick<SymptomLog, 'loggedAt' | 'severity' | 'tags'>): string {
  return `${minuteKey(row.loggedAt)}|${row.severity}|${[...row.tags].sort().join('|')}`
}

function pickColor(index: number): string {
  return IMPORT_MEDICATION_COLORS[index % IMPORT_MEDICATION_COLORS.length]
}

function medicationCreateInput(
  entry: ImportMedication,
  index: number,
): Omit<Medication, 'id' | 'createdAt'> {
  return {
    name: entry.name,
    genericName: entry.genericName,
    brandNames: entry.brandNames,
    defaultDose: entry.defaultDose,
    unit: entry.unit && entry.unit.trim() !== '' ? entry.unit : 'mg',
    color: pickColor(index),
    route: entry.route,
    diseaseIds: [],
    catalogKey: entry.catalogKey,
    isBuiltin: false,
    extra: entry.extra,
  }
}

/** 命中已有药时只补空字段并合并商品名，不覆盖用户已有值。 */
function buildMergePatch(existing: Medication, entry: ImportMedication): MedicationPatch {
  const patch: MedicationPatch = {}
  if (!existing.isBuiltin) {
    if (!existing.genericName && entry.genericName) patch.genericName = entry.genericName
    const mergedBrands = mergeNames(existing.brandNames, entry.brandNames)
    if (mergedBrands.length !== existing.brandNames.length) patch.brandNames = mergedBrands
  }
  if (existing.defaultDose === null && entry.defaultDose !== null) {
    patch.defaultDose = entry.defaultDose
  }
  if (existing.unit.trim() === '' && entry.unit && entry.unit.trim() !== '') {
    patch.unit = entry.unit
  }
  return patch
}

function mergeNames(current: string[], incoming: string[]): string[] {
  const result = [...current]
  for (const name of incoming) {
    if (!result.includes(name)) result.push(name)
  }
  return result
}

function findById(medications: Medication[], id: string): Medication | null {
  return medications.find((medication) => medication.id === id) ?? null
}

function dayStart(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 用同一药物的导入记录推算注射间隔（中位数），推算不出来就按 28 天。 */
function inferInterval(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const days = (sorted[index] - sorted[index - 1]) / DAY_MS
    if (days >= 0.5 && days <= 365) gaps.push(days)
  }
  if (gaps.length === 0) return 28
  gaps.sort((a, b) => a - b)
  return Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]))
}

async function executeImport(payload: ImportPayload, dryRun: boolean): Promise<ImportResult> {
  const hasDoseRecords = payload.injections.length > 0 || payload.oralLogs.length > 0
  const [allMedications, allTreatments, allLogs, allSymptoms, allTags] = await Promise.all([
    medicationRepo.list(),
    treatmentRepo.list(),
    doseLogRepo.list(),
    symptomRepo.list(),
    symptomTagRepo.list(),
  ])

  const active = allTreatments.find((treatment) => treatment.isActive) ?? null
  if (hasDoseRecords && !active) {
    throw new Error('还没有治疗方案：请先完成设置（病种 / 药物 / 方案），再导入注射或口服记录')
  }

  // ---- 合并药物 ----
  let workingMedications = [...allMedications]
  const medicationPatches: Array<{ id: string; patch: MedicationPatch }> = []
  const medicationCreates: Array<Omit<Medication, 'id' | 'createdAt'>> = []
  const pendingMedicationIndex = new Map<string, number>()

  for (const entry of payload.medications) {
    const existing = findMedicationByName(workingMedications, entry.name)
    if (existing) {
      if (existing.id.startsWith('__import_')) {
        // 同一种药在文件里出现多次：把补丁合并进待创建的那条，避免 update 一个不存在的 id。
        const index = pendingMedicationIndex.get(existing.id)
        if (index !== undefined) {
          const current = medicationCreates[index]
          const merged: Omit<Medication, 'id' | 'createdAt'> = {
            ...current,
            genericName: current.genericName ?? entry.genericName,
            brandNames: mergeNames(current.brandNames, entry.brandNames),
            defaultDose: current.defaultDose ?? entry.defaultDose,
            unit: current.unit || entry.unit || 'mg',
            extra: { ...current.extra, ...entry.extra },
          }
          medicationCreates[index] = merged
          workingMedications = workingMedications.map((medication) =>
            medication.id === existing.id
              ? { ...medication, ...merged, id: existing.id, createdAt: 0 }
              : medication,
          )
        }
        continue
      }
      const patch = buildMergePatch(existing, entry)
      if (Object.keys(patch).length > 0) {
        medicationPatches.push({ id: existing.id, patch })
        workingMedications = workingMedications.map((medication) =>
          medication.id === existing.id ? { ...medication, ...patch } : medication,
        )
      }
    } else {
      const input = medicationCreateInput(entry, medicationCreates.length)
      medicationCreates.push(input)
      const placeholderId = `__import_${medicationCreates.length}`
      pendingMedicationIndex.set(placeholderId, medicationCreates.length - 1)
      workingMedications = [
        ...workingMedications,
        { ...input, id: placeholderId, createdAt: 0 },
      ]
    }
  }

  // ---- 用药线 ----
  // 普通补录不往已停用的线里写新记录；换机恢复需要保留已停用线的历史，所以按 payload 标记放行。
  const existingLines = active
    ? active.lines.filter(
        (line) => payload.preserveEndedLines === true || line.endedAt === null,
      )
    : []
  const existingInjectionLines = existingLines.filter((line) => line.kind === 'injection')
  const existingOralLines = existingLines.filter((line) => line.kind === 'oral')

  const lineByMedication = new Map<string, TreatmentLine>()
  for (const line of existingLines) {
    lineByMedication.set(`${line.kind}:${line.medicationId}`, line)
  }

  const pendingLines: PendingLine[] = []
  const pendingLineByKey = new Map<string, PendingLine>()

  const hasHost = (): boolean =>
    existingInjectionLines.some((line) => line.isHost) ||
    pendingLines.some((line) => line.kind === 'injection' && line.input.isHost === true)

  const injectionTimesFor = (medicationId: string): number[] =>
    payload.injections
      .filter((row) => {
        if (!row.medicationName) return false
        return findMedicationByName(workingMedications, row.medicationName)?.id === medicationId
      })
      .map((row) => row.injectedAt)

  const oralTimesFor = (medicationId: string): number[] =>
    payload.oralLogs
      .filter((row) => {
        if (!row.medicationName) return false
        return findMedicationByName(workingMedications, row.medicationName)?.id === medicationId
      })
      .map((row) => row.takenAt)

  const ensureLine = (
    kind: 'injection' | 'oral',
    medication: Medication,
    sample: ImportInjection | ImportOralLog,
  ): { line: TreatmentLine | null; key: string } => {
    const key = `${kind}:${medication.id}`
    const existing = lineByMedication.get(key)
    if (existing) return { line: existing, key: `existing:${existing.id}` }

    const pending = pendingLineByKey.get(key)
    if (pending) return { line: null, key: pending.key }

    let input: TreatmentLineInput
    if (kind === 'injection') {
      const times = injectionTimesFor(medication.id)
      const interval = inferInterval(times)
      const latest = [...payload.injections]
        .filter((row) => {
          if (!row.medicationName) return false
          return findMedicationByName(workingMedications, row.medicationName)?.id === medication.id
        })
        .sort((a, b) => b.injectedAt - a.injectedAt)[0]
      const isHost = !hasHost()
      input = {
        medicationId: medication.id,
        kind: 'injection',
        label: medication.name,
        isHost,
        syncWithHost: false,
        anchor: 'actual',
        windowDays: 2,
        phases: [
          {
            orderIdx: 0,
            kind: 'maintenance',
            intervalDays: interval,
            repeatCount: 0,
            dose: latest?.dose ?? medication.defaultDose,
            unit: latest?.unit ?? medication.unit,
            effectiveFrom: null,
          },
        ],
        oral: null,
      }
    } else {
      const earliest = [...oralTimesFor(medication.id)].sort((a, b) => a - b)[0] ?? Date.now()
      input = {
        medicationId: medication.id,
        kind: 'oral',
        label: medication.name,
        isHost: false,
        syncWithHost: false,
        anchor: 'actual',
        windowDays: 2,
        phases: [],
        oral: {
          startDate: dayStart(earliest),
          durationDays: null,
          frequency: 'daily',
          timesPerPeriod: 1,
          daysOfWeek: [],
          remindTime: '09:00',
        },
      }
    }

    const created: PendingLine = { key: `new:${kind}:${medication.id}`, kind, medicationId: medication.id, input }
    pendingLines.push(created)
    pendingLineByKey.set(key, created)
    return { line: null, key: created.key }
  }

  const resolveLine = (
    kind: 'injection' | 'oral',
    row: ImportInjection | ImportOralLog,
  ): { lineKey: string | null; medication: Medication | null } => {
    const lines = kind === 'injection' ? existingInjectionLines : existingOralLines
    if (row.lineLabel) {
      const byLabel = lines.find((line) => line.label === row.lineLabel)
      if (byLabel) {
        return { lineKey: `existing:${byLabel.id}`, medication: findById(workingMedications, byLabel.medicationId) }
      }
    }

    if (row.medicationName) {
      const medication = findMedicationByName(workingMedications, row.medicationName)
      if (!medication) return { lineKey: null, medication: null }
      const ensured = ensureLine(kind, medication, row)
      return { lineKey: ensured.key, medication }
    }

    const host =
      kind === 'injection'
        ? lines.find((line) => line.isHost) ?? lines[0] ?? null
        : lines[0] ?? null
    return host
      ? { lineKey: `existing:${host.id}`, medication: findById(workingMedications, host.medicationId) }
      : { lineKey: null, medication: null }
  }

  // ---- 记录去重 ----
  // 导出文件只保留到分钟，这里统一按分钟比较，避免同一份备份再次导入时翻倍。
  const existingLogKeys = new Set(allLogs.map((log) => `${minuteKey(logTimeOf(log))}|${log.lineId}`))
  const existingLogIdByTime = new Map<number, string>()
  for (const log of allLogs) {
    if (log.takenAt !== null) existingLogIdByTime.set(minuteKey(log.takenAt), log.id)
  }

  const pendingLogs: PendingDoseLog[] = []
  let injections = 0
  let oralLogs = 0
  let skipped = 0
  let skippedNoLine = 0

  for (const row of payload.injections) {
    const resolved = resolveLine('injection', row)
    if (!resolved.lineKey) {
      skippedNoLine += 1
      continue
    }
    const key = `${minuteKey(row.injectedAt)}|${
      resolved.lineKey.startsWith('existing:') ? resolved.lineKey.slice('existing:'.length) : resolved.lineKey
    }`
    if (existingLogKeys.has(key)) {
      skipped += 1
      continue
    }
    existingLogKeys.add(key)

    pendingLogs.push({
      time: row.injectedAt,
      lineKey: resolved.lineKey,
      input: {
        lineId: resolved.lineKey,
        scheduledAt: null,
        takenAt: row.injectedAt,
        status: row.status,
        dose: row.dose,
        unit: row.unit ?? resolved.medication?.unit ?? 'mg',
        site: row.site,
        lotNumber: row.lotNumber,
        note: row.note,
      },
    })
    injections += 1
  }

  for (const row of payload.oralLogs) {
    const resolved = resolveLine('oral', row)
    if (!resolved.lineKey) {
      skippedNoLine += 1
      continue
    }
    const key = `${minuteKey(row.takenAt)}|${
      resolved.lineKey.startsWith('existing:') ? resolved.lineKey.slice('existing:'.length) : resolved.lineKey
    }`
    if (existingLogKeys.has(key)) {
      skipped += 1
      continue
    }
    existingLogKeys.add(key)

    pendingLogs.push({
      time: row.takenAt,
      lineKey: resolved.lineKey,
      input: {
        lineId: resolved.lineKey,
        scheduledAt: null,
        takenAt: row.takenAt,
        status: row.status,
        dose: row.dose,
        unit: row.unit ?? resolved.medication?.unit ?? null,
        site: null,
        lotNumber: null,
        note: row.note,
      },
    })
    oralLogs += 1
  }

  // ---- 症状 ----
  const existingSymptomKeys = new Set(allSymptoms.map(symptomKey))
  const pendingSymptoms: ImportPayload['symptoms'] = []
  for (const row of payload.symptoms) {
    const key = symptomKey(row)
    if (existingSymptomKeys.has(key)) {
      skipped += 1
      continue
    }
    existingSymptomKeys.add(key)
    pendingSymptoms.push(row)
  }

  // ---- 症状标签 ----
  const tagSet = new Set(allTags.map((tag) => tag.name.toLowerCase()))
  let tags = 0
  let efficacyApplied = 0
  for (const row of payload.symptoms) {
    for (const tag of row.tags) {
      const normalized = tag.toLowerCase()
      if (tagSet.has(normalized)) continue
      tagSet.add(normalized)
      tags += 1
    }
  }

  if (!dryRun) {
    const db = await getDatabase()
    const logIdByTime = new Map<number, string>()
    const lineIdByKey = new Map<string, string>()
    for (const line of existingLines) lineIdByKey.set(`existing:${line.id}`, line.id)

    await db.withTransactionAsync(async () => {
      for (const input of medicationCreates) {
        await medicationRepo.create(input)
      }
      // 先把新药的占位 id 换成真实 id，再建线、写记录。
      const createdMedications = await medicationRepo.list()
      const createdMedicationByName = new Map(
        createdMedications.map((medication) => [
          normalizeMedicationName(medication.name),
          medication.id,
        ]),
      )
      const resolveMedicationId = (medicationId: string): string => {
        if (!medicationId.startsWith('__import_')) return medicationId
        const index = pendingMedicationIndex.get(medicationId)
        if (index === undefined) return medicationId
        const name = medicationCreates[index]?.name ?? ''
        return createdMedicationByName.get(normalizeMedicationName(name)) ?? medicationId
      }
      for (const entry of medicationPatches) {
        await medicationRepo.update(entry.id, entry.patch)
      }

      if (pendingLines.length > 0 && active) {
        for (const pending of pendingLines) {
          const created = await treatmentRepo.addLine(active.id, {
            ...pending.input,
            medicationId: resolveMedicationId(pending.input.medicationId),
          })
          lineIdByKey.set(pending.key, created.id)
        }
      }

      for (const pending of pendingLogs) {
        const lineId = lineIdByKey.get(pending.lineKey)
        if (!lineId) throw new Error('导入时找不到对应的用药线')
        const created: DoseLog = await doseLogRepo.create({ ...pending.input, lineId })
        logIdByTime.set(minuteKey(pending.time), created.id)
      }

      for (const row of pendingSymptoms) {
        const injectionId =
          row.injectionAt === null
            ? null
            : logIdByTime.get(minuteKey(row.injectionAt)) ??
              existingLogIdByTime.get(minuteKey(row.injectionAt)) ??
              null
        await symptomRepo.create({
          loggedAt: row.loggedAt,
          severity: row.severity,
          painScore: row.painScore,
          tags: row.tags,
          temperature: row.temperature,
          note: row.note,
          injectionId,
        })
      }
    })

    for (const row of payload.symptoms) {
      for (const tag of row.tags) {
        await symptomTagRepo.ensure(tag)
      }
    }

    if (payload.lineStates.length > 0 || payload.efficacyEvents.length > 0) {
      const updatedActive = await treatmentRepo.getActive()
      if (updatedActive) {
        const meds = await medicationRepo.list()
        const medNameById = new Map(meds.map((med) => [med.id, med.name]))
        const findLine = (lineLabel: string | null, medName: string | null, kind: 'injection' | 'oral') => {
          const candidates = updatedActive.lines.filter((line) => line.kind === kind)
          return (
            candidates.find((line) => lineLabel !== null && line.label === lineLabel) ??
            candidates.find(
              (line) =>
                medName !== null && medNameById.get(line.medicationId) === medName,
            ) ??
            null
          )
        }

        const db = await getDatabase()
        for (const state of payload.lineStates) {
          const line = findLine(state.lineLabel, state.medicationName, state.kind)
          if (!line) continue
          if ((line.endedAt ?? null) !== state.endedAt) {
            await db.runAsync(
              'UPDATE treatment_line SET ended_at = ? WHERE id = ?',
              state.endedAt,
              line.id,
            )
          }
        }

        if (payload.efficacyEvents.length > 0) {
          const existing = await efficacyEventRepo.list()
          const seen = new Set(
            existing.map((event) => `${event.lineId}|${event.kind}|${minuteKey(event.occurredAt)}`),
          )
          for (const event of payload.efficacyEvents) {
            const line =
              findLine(event.lineLabel, event.medicationName, 'injection') ??
              findLine(event.lineLabel, event.medicationName, 'oral')
            if (!line) continue
            const key = `${line.id}|${event.kind}|${minuteKey(event.occurredAt)}`
            if (seen.has(key)) continue
            await efficacyEventRepo.create({
              lineId: line.id,
              kind: event.kind,
              occurredAt: event.occurredAt,
              note: event.note,
              stopLine: false,
            })
            seen.add(key)
            efficacyApplied += 1
          }
        }
      }
    }
  }

  return {
    injections,
    oralLogs,
    symptoms: pendingSymptoms.length,
    skipped,
    skippedNoLine,
    tags,
    medicationsCreated: medicationCreates.length,
    linesCreated: pendingLines.length,
    efficacyEvents: dryRun ? payload.efficacyEvents.length : efficacyApplied,
  }
}

export async function importPayload(payload: ImportPayload): Promise<ImportResult> {
  return executeImport(payload, false)
}

/** 只计算导入会产生的数量，不写库；供确认弹窗预览。 */
export async function previewImport(payload: ImportPayload): Promise<ImportResult> {
  return executeImport(payload, true)
}
