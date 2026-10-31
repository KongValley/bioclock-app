import { File, Paths } from 'expo-file-system'
import { injections, medications, regimens } from '@/db/repo'
import type { Injection, Regimen } from '@/types'
import { buildSchedule } from '@/domain/schedule'
import { SITE_LABELS } from '@/domain/rotation'

const DAY_MS = 24 * 60 * 60 * 1000

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

interface PlanMatch {
  actualAt: number
  plannedAt: number
  deviationDays: number
}

/**
 * 导出全部注射记录为 CSV。
 * 文件以 UTF-8 BOM 开头，Excel 打开中文不乱码。
 */
export async function exportCsv(): Promise<{ path: string; filename: string }> {
  const [allInjections, allMedications, allRegimens] = await Promise.all([
    injections.list(),
    medications.list(),
    regimens.list(),
  ])

  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const pendingPlans = indexDonePlans(allRegimens, allInjections)

  const lines: string[][] = [CSV_HEADERS]
  for (const injection of allInjections) {
    const medication = medicationById.get(injection.medicationId)
    const plan = takePlanMatch(pendingPlans, injection)

    lines.push([
      formatLocalDateTime(injection.injectedAt),
      medication?.name ?? '',
      medication?.genericName ?? '',
      injection.dose === null ? '' : String(injection.dose),
      injection.unit,
      SITE_LABELS[injection.site] ?? '',
      injection.lotNumber ?? '',
      injection.note ?? '',
      plan ? formatLocalDateTime(plan.plannedAt) : '',
      plan ? plan.deviationDays.toFixed(1) : '',
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

/**
 * 每个方案的计划与实际记录一一对应。
 * 契约中 buildSchedule 会返回历史全部 + 未来 2 针，这里只取已完成的部分。
 */
function indexDonePlans(
  allRegimens: Regimen[],
  allInjections: Injection[],
): Map<string, PlanMatch[]> {
  const injectionsByRegimen = new Map<string, Injection[]>()
  for (const injection of allInjections) {
    const list = injectionsByRegimen.get(injection.regimenId)
    if (list) {
      list.push(injection)
    } else {
      injectionsByRegimen.set(injection.regimenId, [injection])
    }
  }

  const result = new Map<string, PlanMatch[]>()
  const now = Date.now()

  for (const regimen of allRegimens) {
    const regimenInjections = injectionsByRegimen.get(regimen.id) ?? []
    const plans = buildSchedule({ regimen, injections: regimenInjections, now })
      .filter((plan) => plan.status === 'done' && plan.actualAt !== undefined)
      .map((plan) => {
        const actualAt = plan.actualAt ?? plan.plannedAt
        return {
          actualAt,
          plannedAt: plan.plannedAt,
          deviationDays:
            plan.deviationDays ?? roundOne((actualAt - plan.plannedAt) / DAY_MS),
        }
      })
      .sort((a, b) => a.plannedAt - b.plannedAt)
    result.set(regimen.id, plans)
  }

  return result
}

function takePlanMatch(
  pendingPlans: Map<string, PlanMatch[]>,
  injection: Injection,
): PlanMatch | null {
  const plans = pendingPlans.get(injection.regimenId)
  if (!plans || plans.length === 0) return null

  const position = plans.findIndex((plan) => plan.actualAt === injection.injectedAt)
  if (position < 0) return null

  const [match] = plans.splice(position, 1)
  return match
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10
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
