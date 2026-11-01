import { File, Paths } from 'expo-file-system'
import { doseLogs, efficacyEvents as efficacyEventRepo, medications, symptoms, treatments } from '@/db/repo'
import type { DoseLog, TreatmentLine } from '@/types'
import { SITE_LABELS } from '@/domain/rotation'

/**
 * 导出可再次导入的 v3 JSON（format: bioclock-import）。
 *
 * 结构：
 * {
 *   "format": "bioclock-import",
 *   "version": 3,
 *   "exportedAt": "YYYY-MM-DD HH:mm",
 *   "medications": [...],
 *   "injections": [...],
 *   "symptoms": [...],
 *   "oralLogs": [...],
 *   "lineStates": [...],
 *   "efficacyEvents": [...]
 * }
 *
 * 时间一律写成本地时间字符串，不带时区；导出后可以直接用「导入数据」还原。
 */

const IMPORT_FORMAT = 'bioclock-import'
const IMPORT_VERSION = 3

export async function exportJson(): Promise<{ path: string; filename: string }> {
  const [allTreatments, allMedications, allSymptoms, allLogs, allEfficacyEvents] =
    await Promise.all([
      treatments.list(),
      medications.list(),
      symptoms.list(),
      doseLogs.list(),
      efficacyEventRepo.list(),
    ])

  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const lineById = new Map<string, TreatmentLine>()
  for (const treatment of allTreatments) {
    for (const line of treatment.lines) lineById.set(line.id, line)
  }
  const scopedLogs = allLogs.filter((log) => lineById.has(log.lineId))
  const logById = new Map(scopedLogs.map((log) => [log.id, log]))

  const medicationsPayload = allMedications.map((medication) => ({
    name: medication.name,
    genericName: medication.genericName,
    brandNames: medication.brandNames,
    route: medication.route,
    defaultDose: medication.defaultDose,
    unit: medication.unit,
    catalogKey: medication.catalogKey,
    extra: medication.extra,
  }))

  const sortedLogs = [...scopedLogs].sort((a, b) => logTime(a) - logTime(b))

  const injections = sortedLogs
    .filter((log) => lineById.get(log.lineId)?.kind === 'injection')
    .map((log) => {
      const line = lineById.get(log.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      return {
        injectedAt: formatLocalDateTime(logTime(log)),
        medication: medication?.name ?? line?.label ?? '',
        dose: log.dose,
        unit: log.unit || medication?.unit || null,
        site: log.site ? SITE_LABELS[log.site] : undefined,
        lotNumber: log.lotNumber,
        note: log.note,
        status: log.status,
        lineLabel: line?.label ?? null,
      }
    })

  const oralLogs = sortedLogs
    .filter((log) => lineById.get(log.lineId)?.kind === 'oral')
    .map((log) => {
      const line = lineById.get(log.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      return {
        takenAt: formatLocalDateTime(logTime(log)),
        medication: medication?.name ?? line?.label ?? '',
        status: log.status,
        dose: log.dose,
        unit: log.unit || null,
        note: log.note,
        lineLabel: line?.label ?? null,
      }
    })

  const symptomsPayload = [...allSymptoms]
    .sort((a, b) => a.loggedAt - b.loggedAt)
    .map((symptom) => {
      const linked = symptom.injectionId ? logById.get(symptom.injectionId) : undefined
      return {
        loggedAt: formatLocalDateTime(symptom.loggedAt),
        severity: symptom.severity,
        painScore: symptom.painScore,
        tags: symptom.tags,
        temperature: symptom.temperature,
        note: symptom.note,
        injectionAt: linked ? formatLocalDateTime(logTime(linked)) : null,
      }
    })

  const lineStates = [...lineById.values()].map((line) => {
    const medication = medicationById.get(line.medicationId)
    return {
      lineLabel: line.label,
      medication: medication?.name ?? line.label,
      kind: line.kind,
      endedAt: line.endedAt === null ? null : formatLocalDateTime(line.endedAt),
    }
  })

  const efficacyEventsPayload = allEfficacyEvents
    .filter((event) => lineById.has(event.lineId))
    .map((event) => {
      const line = lineById.get(event.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      return {
        lineLabel: line?.label ?? null,
        medication: medication?.name ?? line?.label ?? '',
        kind: event.kind,
        occurredAt: formatLocalDateTime(event.occurredAt),
        note: event.note,
      }
    })

  const payload = {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    exportedAt: formatLocalDateTime(Date.now()),
    medications: medicationsPayload,
    injections,
    symptoms: symptomsPayload,
    oralLogs,
    lineStates,
    efficacyEvents: efficacyEventsPayload,
  }

  const filename = `bioclock-${formatLocalDate(Date.now())}.json`
  const file = new File(Paths.cache, filename)
  if (file.exists) file.delete()
  file.create()
  await file.write(JSON.stringify(payload, null, 2))

  return { path: file.uri, filename }
}

function logTime(log: DoseLog): number {
  return log.takenAt ?? log.scheduledAt ?? log.createdAt
}

function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${formatLocalDate(timestamp)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}
