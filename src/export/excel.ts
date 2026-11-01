import * as XLSX from 'xlsx'
import { File, Paths } from 'expo-file-system'
import { doseLogs, medications, symptoms, treatments } from '@/db/repo'
import type {
  DoseLog,
  DoseStatus,
  LineKind,
  MedicationRoute,
  OralFrequency,
  TreatmentLine,
} from '@/types'
import { SITE_LABELS } from '@/domain/rotation'

/**
 * 用已安装的 SheetJS 导出一个工作簿，包含 5 个工作表：
 * 注射记录 / 症状记录 / 药物 / 口服打卡 / 用药线。
 * 文件写入应用缓存目录，不上传任何数据。
 */

const ROUTE_LABELS: Record<MedicationRoute, string> = {
  sc: '皮下注射',
  iv: '静脉输注',
  oral: '口服',
}

const STATUS_LABELS: Record<DoseStatus, string> = {
  done: '已用',
  skipped: '跳过',
  missed: '漏用',
}

const KIND_LABELS: Record<LineKind, string> = {
  injection: '注射',
  oral: '口服',
}

export async function exportExcel(): Promise<{ path: string; filename: string }> {
  const [allTreatments, allMedications, allSymptoms, allLogs] = await Promise.all([
    treatments.list(),
    medications.list(),
    symptoms.list(),
    doseLogs.list(),
  ])

  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const lineById = new Map<string, TreatmentLine>()
  for (const treatment of allTreatments) {
    for (const line of treatment.lines) lineById.set(line.id, line)
  }

  const scopedLogs = allLogs.filter((log) => lineById.has(log.lineId))
  const sortedLogs = [...scopedLogs].sort((a, b) => logTime(a) - logTime(b))
  const injectionLogs = sortedLogs.filter(
    (log) => lineById.get(log.lineId)?.kind === 'injection',
  )
  const oralLogs = sortedLogs.filter((log) => lineById.get(log.lineId)?.kind === 'oral')
  const logById = new Map(scopedLogs.map((log) => [log.id, log]))

  const injectionSheet: unknown[][] = [
    ['注射时间', '药物', '剂量', '单位', '部位', '批号', '备注', '状态', '用药线'],
    ...injectionLogs.map((log) => {
      const line = lineById.get(log.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      const isInfusion = medication?.route === 'iv'
      return [
        formatLocalDateTime(logTime(log)),
        medication?.name ?? line?.label ?? '',
        log.dose,
        log.unit || medication?.unit || '',
        isInfusion ? '' : log.site ? SITE_LABELS[log.site] ?? '' : '',
        log.lotNumber ?? '',
        log.note ?? '',
        STATUS_LABELS[log.status],
        line?.label ?? '',
      ]
    }),
  ]

  const symptomSheet: unknown[][] = [
    ['记录时间', '严重程度', '疼痛评分', '症状', '体温', '备注', '关联注射时间'],
    ...allSymptoms.map((symptom) => {
      const linked = symptom.injectionId ? logById.get(symptom.injectionId) : undefined
      return [
        formatLocalDateTime(symptom.loggedAt),
        symptom.severity,
        symptom.painScore,
        symptom.tags.join('、'),
        symptom.temperature,
        symptom.note ?? '',
        linked ? formatLocalDateTime(logTime(linked)) : '',
      ]
    }),
  ]

  const medicationSheet: unknown[][] = [
    ['药名', '通用名', '商品名', '给药途径', '默认剂量', '单位', '目录标识'],
    ...allMedications.map((medication) => [
      medication.name,
      medication.genericName ?? '',
      medication.brandNames.join('、'),
      ROUTE_LABELS[medication.route],
      medication.defaultDose,
      medication.unit,
      medication.catalogKey ?? '',
    ]),
  ]

  const oralSheet: unknown[][] = [
    ['记录时间', '药物', '状态', '剂量', '单位', '备注', '用药线'],
    ...oralLogs.map((log) => {
      const line = lineById.get(log.lineId)
      const medication = line ? medicationById.get(line.medicationId) : undefined
      return [
        formatLocalDateTime(logTime(log)),
        medication?.name ?? line?.label ?? '',
        STATUS_LABELS[log.status],
        log.dose,
        log.unit || '',
        log.note ?? '',
        line?.label ?? '',
      ]
    }),
  ]

  const lineSheet: unknown[][] = [
    ['方案', '用药线', '药物', '方式', '锚点', '窗口天数', '口服计划'],
    ...allTreatments.flatMap((treatment) =>
      treatment.lines.map((line) => {
        const medication = medicationById.get(line.medicationId)
        return [
          treatment.name,
          line.label,
          medication?.name ?? '',
          KIND_LABELS[line.kind],
          line.anchor,
          line.windowDays,
          describeOral(line),
        ]
      }),
    ),
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(injectionSheet), '注射记录')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(symptomSheet), '症状记录')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(medicationSheet), '药物')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(oralSheet), '口服打卡')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(lineSheet), '用药线')

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const filename = `bioclock-${formatLocalDate(Date.now())}.xlsx`
  const file = new File(Paths.cache, filename)
  if (file.exists) file.delete()
  file.create()
  await file.write(bytes)

  return { path: file.uri, filename }
}

function describeOral(line: TreatmentLine): string {
  if (line.kind !== 'oral' || !line.oral) return ''
  const oral = line.oral
  const frequency =
    oral.frequency === 'daily'
      ? '每天'
      : oral.frequency === 'weekly'
        ? `每周 ${oral.timesPerPeriod} 次`
        : `每周 ${oral.daysOfWeek.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}`
  const duration = oral.durationDays === null ? '长期' : `${oral.durationDays} 天`
  return `${frequency} ${oral.remindTime}（${duration}）`
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
