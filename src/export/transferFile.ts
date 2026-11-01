import { File, Paths } from 'expo-file-system'
import {
  doseLogs,
  efficacyEvents,
  medications,
  reminderRules,
  settings as settingsRepo,
  symptoms,
  symptomTags,
  treatments,
} from '@/db/repo'
import type { DoseLog, TreatmentLine } from '@/types'
import { SCHEMA_VERSION } from '@/db/schema'
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  type TransferDose,
  type TransferFile,
  type TransferLine,
  type TransferReminder,
  type TransferTreatment,
} from './transferSchema'

/**
 * 换机快照的读写部分。
 *
 * 与可编辑的 v3 导入文件不同，这里保留完整快照：方案、用药线、阶段（含生效时间）、
 * 口服计划、提醒规则、设置、症状标签、打卡和疗效事件。
 * 只在两台设备之间搬运，不用于手工编辑。
 */

export interface ExportCounts {
  treatments: number
  lines: number
  doses: number
  symptoms: number
  efficacyEvents: number
}

function lineToTransfer(line: TreatmentLine): TransferLine {
  return {
    id: line.id,
    medicationId: line.medicationId,
    kind: line.kind,
    label: line.label,
    isHost: line.isHost,
    syncWithHost: line.syncWithHost,
    anchor: line.anchor,
    windowDays: line.windowDays,
    endedAt: line.endedAt,
    phases: [...line.phases]
      .sort((a, b) => a.orderIdx - b.orderIdx)
      .map((phase) => ({
        orderIdx: phase.orderIdx,
        kind: phase.kind,
        intervalDays: phase.intervalDays,
        repeatCount: phase.repeatCount,
        dose: phase.dose,
        unit: phase.unit,
        effectiveFrom: phase.effectiveFrom,
      })),
    oral: line.oral
      ? {
          startDate: line.oral.startDate,
          durationDays: line.oral.durationDays,
          frequency: line.oral.frequency,
          timesPerPeriod: line.oral.timesPerPeriod,
          daysOfWeek: line.oral.daysOfWeek,
          remindTime: line.oral.remindTime,
        }
      : null,
  }
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 生成换机快照，返回文件路径与统计。 */
export async function exportTransferFile(): Promise<{
  path: string
  filename: string
  counts: ExportCounts
}> {
  const [allTreatments, allMedications, allDoses, allSymptoms, allEvents, allTags, allSettings] =
    await Promise.all([
      treatments.list(),
      medications.list(),
      doseLogs.list(),
      symptoms.list(),
      efficacyEvents.list(),
      symptomTags.list(),
      settingsRepo.all(),
    ])

  const lineIds = new Set<string>()
  const transferTreatments: TransferTreatment[] = []
  for (const treatment of allTreatments) {
    for (const line of treatment.lines) lineIds.add(line.id)
    transferTreatments.push({
      id: treatment.id,
      name: treatment.name,
      isActive: treatment.isActive,
      createdAt: treatment.createdAt,
      lines: treatment.lines.map(lineToTransfer),
    })
  }

  const scopedDoses = allDoses.filter((dose) => lineIds.has(dose.lineId))
  const doseIndexById = new Map<string, number>()
  const transferDoses: TransferDose[] = scopedDoses.map((dose: DoseLog, index) => {
    doseIndexById.set(dose.id, index)
    return {
      lineId: dose.lineId,
      scheduledAt: dose.scheduledAt,
      takenAt: dose.takenAt,
      status: dose.status,
      dose: dose.dose,
      unit: dose.unit || null,
      site: dose.site,
      lotNumber: dose.lotNumber,
      note: dose.note,
      createdAt: dose.createdAt,
      updatedAt: dose.updatedAt,
    }
  })

  const reminders = await Promise.all(
    allTreatments.map(async (treatment) => {
      const rule = await reminderRules.getFor(treatment.id)
      return rule
        ? {
            treatmentId: treatment.id,
            offsets: rule.offsets,
            timeOfDay: rule.timeOfDay,
            snoozeMinutes: rule.snoozeMinutes,
            enabled: rule.enabled,
          }
        : null
    }),
  )

  const transferSettings = { ...allSettings }
  // 换机后不要让新设备直接继承应用锁，避免没有录入生物识别时被锁在门外。
  delete transferSettings.app_lock

  const transfer: TransferFile = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    app: 'BioClock',
    medications: allMedications.map((medication) => ({
      id: medication.id,
      name: medication.name,
      genericName: medication.genericName,
      brandNames: medication.brandNames,
      defaultDose: medication.defaultDose,
      unit: medication.unit,
      color: medication.color,
      route: medication.route,
      diseaseIds: medication.diseaseIds,
      catalogKey: medication.catalogKey,
      isBuiltin: medication.isBuiltin,
      extra: medication.extra,
    })),
    treatments: transferTreatments,
    doseLogs: transferDoses,
    symptoms: allSymptoms.map((symptom) => ({
      loggedAt: symptom.loggedAt,
      severity: symptom.severity,
      painScore: symptom.painScore,
      tags: symptom.tags,
      note: symptom.note,
      temperature: symptom.temperature,
      doseIndex:
        symptom.injectionId !== null ? doseIndexById.get(symptom.injectionId) ?? null : null,
    })),
    efficacyEvents: allEvents
      .filter((event) => lineIds.has(event.lineId))
      .map((event) => ({
        lineId: event.lineId,
        kind: event.kind,
        occurredAt: event.occurredAt,
        dosesCount: event.dosesCount,
        note: event.note,
        createdAt: event.createdAt,
      })),
    symptomTags: allTags.map((tag) => ({
      name: tag.name,
      isBuiltin: tag.isBuiltin,
      sortOrder: tag.sortOrder,
    })),
    reminders: reminders.filter((item): item is TransferReminder => item !== null),
    settings: transferSettings,
  }

  const filename = `bioclock-transfer-${formatLocalDate(Date.now())}.json`
  const file = new File(Paths.cache, filename)
  if (file.exists) file.delete()
  file.create()
  await file.write(JSON.stringify(transfer, null, 2))

  return {
    path: file.uri,
    filename,
    counts: {
      treatments: transferTreatments.length,
      lines: lineIds.size,
      doses: transferDoses.length,
      symptoms: allSymptoms.length,
      efficacyEvents: transfer.efficacyEvents.length,
    },
  }
}
