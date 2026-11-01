import { File, Paths } from 'expo-file-system'
import { doseLogs, medications, treatments } from '@/db/repo'
import type { DoseLog, TreatmentLine } from '@/types'
import { buildSchedule } from '@/domain/schedule'
import type { SchedulePlan } from '@/domain/schedule'
import { SITE_LABELS } from '@/domain/rotation'

const CSV_HEADERS = [
  '注射日期时间',
  '药名',
  '通用名',
  '剂量',
  '单位',
  '部位',
  '批号',
  '备注',
  '计划时间',
  '偏差天数',
]

/**
 * 导出全部注射记录为 CSV（含 skipped / missed，只取注射线）。
 * 文件以 UTF-8 BOM 开头，Excel 打开中文不乱码。
 * 计划时间 / 偏差由 `buildSchedule` 把记录配到计划上得到。
 */
export async function exportCsv(): Promise<{ path: string; filename: string }> {
  const [allTreatments, allMedications, allLogs] = await Promise.all([
    treatments.list(),
    medications.list(),
    doseLogs.list(),
  ])

  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const lineById = new Map<string, TreatmentLine>()
  for (const treatment of allTreatments) {
    for (const line of treatment.lines) lineById.set(line.id, line)
  }

  const planByLogId = indexPlansByLog(allTreatments, allLogs)

  const rows = allLogs
    .filter((log) => lineById.get(log.lineId)?.kind === 'injection')
    .sort((a, b) => logTime(a) - logTime(b))

  const lines: string[][] = [CSV_HEADERS]
  for (const log of rows) {
    const line = lineById.get(log.lineId)
    const medication = line ? medicationById.get(line.medicationId) : undefined
    const plan = planByLogId.get(log.id)
    const isInfusion = medication?.route === 'iv'

    lines.push([
      formatLocalDateTime(logTime(log)),
      medication?.name ?? line?.label ?? '',
      medication?.genericName ?? '',
      log.dose === null ? '' : String(log.dose),
      log.unit || medication?.unit || '',
      isInfusion || !log.site ? '' : SITE_LABELS[log.site] ?? '',
      log.lotNumber ?? '',
      log.note ?? '',
      plan ? formatLocalDateTime(plan.plannedAt) : '',
      plan && plan.deviationDays !== undefined ? plan.deviationDays.toFixed(1) : '',
    ])
  }

  const content = `\uFEFF${lines.map((line) => line.map(escapeCsvField).join(',')).join('\r\n')}`
  const filename = `bioclock-${formatLocalDate(Date.now())}.csv`
  const file = new File(Paths.cache, filename)
  if (file.exists) file.delete()
  file.create()
  await file.write(content)

  return { path: file.uri, filename }
}

/** 每个 treatment 跑一次 buildSchedule，把 plan 按 doseLogId 建索引。 */
function indexPlansByLog(
  allTreatments: Array<{ lines: TreatmentLine[] }>,
  allLogs: DoseLog[],
): Map<string, SchedulePlan> {
  const now = Date.now()
  const result = new Map<string, SchedulePlan>()
  for (const treatment of allTreatments) {
    const plans = buildSchedule({ lines: treatment.lines, logs: allLogs, now })
    for (const plan of plans) {
      if (plan.doseLogId) result.set(plan.doseLogId, plan)
    }
  }
  return result
}

function logTime(log: DoseLog): number {
  return log.takenAt ?? log.scheduledAt ?? log.createdAt
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
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
