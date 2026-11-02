import type { InjectionSite, MedicationRoute } from '@/types'
import { SCHEMA_VERSION } from '@/db/schema'
import { resolveImportLogTime } from '@/import/schema'
import type {
  ImportEfficacyEvent,
  ImportInjection,
  ImportLineState,
  ImportOralLog,
  ImportPayload,
  ImportSymptom,
} from '@/import/schema'

/**
 * 换机快照（format: bioclock-transfer）的纯函数部分。
 *
 * 这里是纯数据转换，不碰 expo 原生模块，方便在 Node 里直接单测；
 * 读写文件的 `exportTransferFile` 在 `transferFile.ts` 里。
 */

export const TRANSFER_FORMAT = 'bioclock-transfer'
export const TRANSFER_VERSION = 1

export interface TransferMedication {
  id: string
  name: string
  genericName: string | null
  brandNames: string[]
  defaultDose: number | null
  unit: string
  color: string
  route: MedicationRoute
  diseaseIds: string[]
  catalogKey: string | null
  isBuiltin: boolean
  extra: Record<string, unknown>
}

export interface TransferPhase {
  orderIdx: number
  kind: string
  intervalDays: number
  repeatCount: number
  dose: number | null
  unit: string
  effectiveFrom: number | null
}

export interface TransferLine {
  id: string
  medicationId: string
  kind: string
  label: string
  isHost: boolean
  syncWithHost: boolean
  anchor: string
  windowDays: number
  endedAt: number | null
  phases: TransferPhase[]
  oral: {
    startDate: number
    durationDays: number | null
    frequency: string
    timesPerPeriod: number
    daysOfWeek: number[]
    remindTime: string
  } | null
}

export interface TransferTreatment {
  id: string
  name: string
  isActive: boolean
  createdAt: number
  lines: TransferLine[]
}

export interface TransferDose {
  lineId: string
  scheduledAt: number | null
  takenAt: number | null
  status: string
  dose: number | null
  unit: string | null
  site: string | null
  lotNumber: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface TransferSymptom {
  loggedAt: number
  severity: number
  painScore: number | null
  tags: string[]
  note: string | null
  temperature: number | null
  /** 关联的打卡在 doseLogs 里的下标 */
  doseIndex: number | null
}

export interface TransferEfficacy {
  lineId: string
  kind: string
  occurredAt: number
  dosesCount: number
  note: string | null
  createdAt: number
}

export interface TransferTag {
  name: string
  isBuiltin: boolean
  sortOrder: number
}

export interface TransferReminder {
  treatmentId: string
  offsets: number[]
  timeOfDay: string
  snoozeMinutes: number
  enabled: boolean
}

export interface TransferFile {
  format: typeof TRANSFER_FORMAT
  version: typeof TRANSFER_VERSION
  schemaVersion: number
  exportedAt: number
  app: string
  medications: TransferMedication[]
  treatments: TransferTreatment[]
  doseLogs: TransferDose[]
  symptoms: TransferSymptom[]
  efficacyEvents: TransferEfficacy[]
  symptomTags: TransferTag[]
  reminders: TransferReminder[]
  settings: Record<string, string>
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

/** 判断一个 JSON 文本是不是换机快照。 */
export function isTransferFile(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stripBom(text))
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { format?: unknown }).format === TRANSFER_FORMAT
    )
  } catch {
    return false
  }
}

function readTransferFile(text: string): TransferFile {
  const parsed = JSON.parse(stripBom(text)) as TransferFile
  if (parsed.format !== TRANSFER_FORMAT) throw new Error('不是 BioClock 的换机文件')
  if (parsed.version !== TRANSFER_VERSION) {
    throw new Error(`不支持的换机文件版本：${String(parsed.version)}`)
  }
  if (
    typeof parsed.schemaVersion !== 'number' ||
    !Number.isFinite(parsed.schemaVersion)
  ) {
    throw new Error('换机文件缺少数据库版本')
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `备份来自更新版本的 BioClock（数据库 v${parsed.schemaVersion}），请先升级 App 再导入`,
    )
  }

  const arrays: Array<[keyof TransferFile, string]> = [
    ['medications', '药物'],
    ['treatments', '治疗方案'],
    ['doseLogs', '打卡记录'],
    ['symptoms', '症状记录'],
    ['efficacyEvents', '疗效记录'],
    ['symptomTags', '症状标签'],
    ['reminders', '提醒规则'],
  ]
  for (const [field, label] of arrays) {
    if (!Array.isArray(parsed[field])) {
      throw new Error(`换机文件缺少${label}`)
    }
  }
  if (
    typeof parsed.settings !== 'object' ||
    parsed.settings === null ||
    Array.isArray(parsed.settings)
  ) {
    parsed.settings = {}
  }
  return parsed
}

/** 读取并校验换机快照。 */
export function parseTransferFile(text: string): TransferFile {
  return readTransferFile(text)
}

/**
 * 把换机快照转成现有的 v3 导入负载，交给同一个导入流程落库。
 * 方案结构本身在导入时按用药线重建（停用时间与疗效事件会保留）。
 */
export function transferToImportPayload(text: string): ImportPayload {
  const parsed = readTransferFile(text)

  const medicationById = new Map(parsed.medications.map((item) => [item.id, item]))
  const lineById = new Map<string, { label: string; kind: string; medicationId: string }>()
  for (const treatment of parsed.treatments) {
    for (const line of treatment.lines) {
      lineById.set(line.id, {
        label: line.label,
        kind: line.kind,
        medicationId: line.medicationId,
      })
    }
  }

  // 跳过/漏用可能没有 takenAt。落库时间与 import 的去重时间必须同源：
  // done 用实际时间，skipped/missed 用计划时间（没有计划时间才退回事件时间）。
  const eventTime = (dose: TransferDose): number =>
    dose.takenAt ?? dose.scheduledAt ?? dose.createdAt
  const storedTime = (dose: TransferDose): number =>
    resolveImportLogTime({
      status: dose.status as ImportInjection['status'],
      eventAt: eventTime(dose),
      scheduledAt: dose.scheduledAt,
    })

  const injections: ImportInjection[] = parsed.doseLogs
    .filter((dose) => lineById.get(dose.lineId)?.kind === 'injection')
    .map((dose) => {
      const line = lineById.get(dose.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      return {
        injectedAt: storedTime(dose),
        scheduledAt:
          dose.scheduledAt ?? (dose.status === 'done' ? null : eventTime(dose)),
        medicationName: medication?.name ?? line?.label ?? null,
        dose: dose.dose,
        unit: dose.unit,
        site: (dose.site ?? null) as InjectionSite | null,
        lotNumber: dose.lotNumber,
        note: dose.note,
        status: dose.status as ImportInjection['status'],
        lineLabel: line?.label ?? null,
      }
    })

  const oralLogs: ImportOralLog[] = parsed.doseLogs
    .filter((dose) => lineById.get(dose.lineId)?.kind === 'oral')
    .map((dose) => {
      const line = lineById.get(dose.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      return {
        takenAt: storedTime(dose),
        scheduledAt:
          dose.scheduledAt ?? (dose.status === 'done' ? null : eventTime(dose)),
        medicationName: medication?.name ?? line?.label ?? null,
        status: dose.status as ImportOralLog['status'],
        dose: dose.dose,
        unit: dose.unit,
        note: dose.note,
        lineLabel: line?.label ?? null,
      }
    })

  const lineStates: ImportLineState[] = parsed.treatments.flatMap((treatment) =>
    treatment.lines.map((line) => ({
      lineLabel: line.label,
      medicationName: medicationById.get(line.medicationId)?.name ?? line.label,
      kind: line.kind === 'oral' ? ('oral' as const) : ('injection' as const),
      endedAt: line.endedAt,
    })),
  )

  const efficacyEvents: ImportEfficacyEvent[] = parsed.efficacyEvents.map((event) => {
    const line = lineById.get(event.lineId)
    return {
      lineLabel: line?.label ?? null,
      medicationName: line
        ? medicationById.get(line.medicationId)?.name ?? line.label
        : null,
      kind: event.kind as ImportEfficacyEvent['kind'],
      occurredAt: event.occurredAt,
      note: event.note,
    }
  })

  const symptoms: ImportSymptom[] = parsed.symptoms.map((symptom) => ({
    loggedAt: symptom.loggedAt,
    severity: symptom.severity as ImportSymptom['severity'],
    painScore: symptom.painScore,
    tags: symptom.tags,
    temperature: symptom.temperature,
    note: symptom.note,
    injectionAt:
      symptom.doseIndex === null
        ? null
        : (() => {
            const linked = parsed.doseLogs[symptom.doseIndex]
            return linked ? storedTime(linked) : null
          })(),
  }))

  return {
    medications: parsed.medications.map((medication) => ({
      name: medication.name,
      genericName: medication.genericName,
      brandNames: medication.brandNames,
      route: medication.route,
      defaultDose: medication.defaultDose,
      unit: medication.unit,
      catalogKey: medication.catalogKey,
      extra: medication.extra,
    })),
    injections,
    oralLogs,
    symptoms,
    lineStates,
    efficacyEvents,
    symptomTags: parsed.symptomTags.map((tag) => tag.name),
    preserveEndedLines: true,
  }
}

/** 检查换机文件是否能被当前版本解析；返回统计用于确认弹窗。 */
export function summarizeTransfer(text: string): {
  doses: number
  symptoms: number
  efficacyEvents: number
  schemaVersion: number
  settings: Record<string, string>
  reminder: TransferReminder | null
} {
  const parsed = readTransferFile(text)
  const payload = transferToImportPayload(text)
  const activeTreatment = parsed.treatments.find((treatment) => treatment.isActive)
  const reminder =
    parsed.reminders.find((item) => item.treatmentId === activeTreatment?.id) ??
    parsed.reminders[0] ??
    null
  return {
    doses: payload.injections.length + payload.oralLogs.length,
    symptoms: payload.symptoms.length,
    efficacyEvents: payload.efficacyEvents.length,
    schemaVersion: parsed.schemaVersion,
    settings: parsed.settings ?? {},
    reminder,
  }
}
