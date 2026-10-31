import { File, Paths } from 'expo-file-system'
import { printToFileAsync } from 'expo-print'
import { injections, medications, regimens, settings, symptoms } from '@/db/repo'
import type { Injection, Medication, Regimen, SymptomLog } from '@/types'
import { buildSchedule } from '@/domain/schedule'
import { SITE_LABELS } from '@/domain/rotation'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_DAYS = 180
const DISCLAIMER =
  '本报告由患者自行记录生成，仅用于就诊沟通，不构成医疗诊断或用药建议。'

interface AdherenceSummary {
  total: number
  onTime: number
  early: number
  late: number
  avgDeviationDays: number
}

interface SymptomSummary {
  count: number
  avgSeverity: number
  avgPain: number | null
  mostCommonTag: string
}

/**
 * 生成 PDF 就诊报告。
 * HTML 内联 CSS，经 expo-print 渲染为 A4 PDF，写入应用缓存目录，不上传任何数据。
 */
export async function exportPdf(
  opts: { patientName?: string; rangeDays?: number } = {},
): Promise<{ path: string; filename: string }> {
  const rangeDays = resolveRangeDays(opts.rangeDays)
  const now = Date.now()
  const since = now - rangeDays * DAY_MS

  const [allInjections, allMedications, allSymptoms, allRegimens, appSettings] = await Promise.all([
    injections.list(),
    medications.list(),
    symptoms.list(),
    regimens.list(),
    settings.all(),
  ])

  const patientName = opts.patientName?.trim() || appSettings.patient_name?.trim() || ''
  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const rangeInjections = allInjections.filter(
    (injection) => injection.injectedAt >= since && injection.injectedAt <= now,
  )
  const rangeSymptoms = allSymptoms.filter(
    (symptom) => symptom.loggedAt >= since && symptom.loggedAt <= now,
  )

  const adherence = summarizeAdherence(allRegimens, allInjections, since, now)
  const symptomSummary = summarizeSymptoms(rangeSymptoms)
  const html = buildHtml({
    patientName,
    rangeDays,
    since,
    now,
    injections: rangeInjections,
    medicationById,
    adherence,
    symptomSummary,
  })

  const printed = await printToFileAsync({ html, width: 595, height: 842 })
  const filename = `bioclock-${formatLocalDate(now)}.pdf`
  const target = new File(Paths.cache, filename)
  if (target.exists) target.delete()
  await new File(printed.uri).move(target)

  return { path: target.uri, filename }
}

function resolveRangeDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RANGE_DAYS
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('统计范围必须是大于 0 的天数')
  }
  return Math.floor(value)
}

function summarizeAdherence(
  allRegimens: Regimen[],
  allInjections: Injection[],
  since: number,
  now: number,
): AdherenceSummary {
  let total = 0
  let onTime = 0
  let early = 0
  let late = 0
  let deviationSum = 0

  for (const regimen of allRegimens) {
    const regimenInjections = allInjections.filter(
      (injection) => injection.regimenId === regimen.id,
    )
    const plans = buildSchedule({ regimen, injections: regimenInjections, now })

    for (const plan of plans) {
      if (plan.status !== 'done' || plan.actualAt === undefined) continue
      if (plan.actualAt < since || plan.actualAt > now) continue

      const deviationDays =
        plan.deviationDays ?? roundOne((plan.actualAt - plan.plannedAt) / DAY_MS)
      total += 1
      deviationSum += deviationDays

      if (Math.abs(deviationDays) <= regimen.windowDays) {
        onTime += 1
      } else if (deviationDays < 0) {
        early += 1
      } else {
        late += 1
      }
    }
  }

  return {
    total,
    onTime,
    early,
    late,
    avgDeviationDays: total === 0 ? 0 : roundOne(deviationSum / total),
  }
}

function summarizeSymptoms(logs: SymptomLog[]): SymptomSummary {
  if (logs.length === 0) {
    return { count: 0, avgSeverity: 0, avgPain: null, mostCommonTag: '暂无记录' }
  }

  const severitySum = logs.reduce((sum, log) => sum + log.severity, 0)
  const painScores = logs
    .map((log) => log.painScore)
    .filter((score): score is number => score !== null)
  const painSum = painScores.reduce((sum, score) => sum + score, 0)
  const tagCounts = new Map<string, number>()
  for (const log of logs) {
    for (const tag of log.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  let mostCommonTag = '暂无记录'
  let maxCount = 0
  for (const [tag, count] of tagCounts) {
    if (count > maxCount) {
      mostCommonTag = tag
      maxCount = count
    }
  }

  return {
    count: logs.length,
    avgSeverity: roundOne(severitySum / logs.length),
    avgPain: painScores.length === 0 ? null : roundOne(painSum / painScores.length),
    mostCommonTag,
  }
}

function buildHtml(input: {
  patientName: string
  rangeDays: number
  since: number
  now: number
  injections: Injection[]
  medicationById: Map<string, Medication>
  adherence: AdherenceSummary
  symptomSummary: SymptomSummary
}): string {
  const {
    patientName,
    rangeDays,
    since,
    now,
    injections: reportInjections,
    medicationById,
    adherence,
    symptomSummary,
  } = input

  const injectionRows =
    reportInjections.length === 0
      ? '<tr><td class="empty" colspan="7">该时间范围内暂无注射记录</td></tr>'
      : reportInjections
          .map((injection) => {
            const medication = medicationById.get(injection.medicationId)
            const isInfusion = medication?.route === 'iv'
            const site = isInfusion
              ? '—'
              : (SITE_LABELS[injection.site] ?? '—')
            return `<tr>
              <td class="nowrap">${escapeHtml(formatLocalDateTime(injection.injectedAt))}</td>
              <td>${escapeHtml(medication?.name ?? '—')}</td>
              <td>${escapeHtml(medication?.genericName ?? '—')}</td>
              <td class="nowrap">${escapeHtml(formatDose(injection))}</td>
              <td>${escapeHtml(site)}</td>
              <td>${escapeHtml(injection.lotNumber ?? '—')}</td>
              <td class="note">${escapeHtml(injection.note ?? '—')}</td>
            </tr>`
          })
          .join('')

  const patientRow = patientName
    ? `<div class="meta-item"><span class="meta-label">患者姓名</span><span>${escapeHtml(patientName)}</span></div>`
    : ''
  const deviationLabel =
    adherence.total === 0
      ? '—'
      : `${adherence.avgDeviationDays > 0 ? '+' : ''}${adherence.avgDeviationDays.toFixed(1)} 天`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #1a202c;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
      "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
    font-size: 11px;
    line-height: 1.55;
  }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 1px; }
  h2 {
    margin: 22px 0 8px;
    padding-left: 8px;
    border-left: 3px solid #2b6cb0;
    font-size: 14px;
  }
  .generated { margin: 0; color: #718096; font-size: 10px; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    margin-top: 14px;
    padding: 10px 12px;
    background: #f7fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
  }
  .meta-item { display: flex; gap: 8px; }
  .meta-label { color: #718096; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td {
    padding: 6px 6px;
    border: 1px solid #cbd5e0;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }
  th { background: #edf2f7; font-weight: 600; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #fbfdff; }
  .nowrap { white-space: nowrap; }
  .note { white-space: pre-wrap; }
  .empty { padding: 18px; text-align: center; color: #718096; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; }
  .stat {
    flex: 1 1 90px;
    min-width: 90px;
    padding: 9px 10px;
    background: #f7fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
  }
  .stat-label { display: block; color: #718096; font-size: 10px; }
  .stat-value { display: block; margin-top: 2px; font-size: 15px; font-weight: 600; color: #2b6cb0; }
  .hint { margin: 7px 0 0; color: #718096; font-size: 9.5px; }
  footer {
    margin-top: 26px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    color: #4a5568;
    font-size: 10px;
    page-break-inside: avoid;
  }
</style>
</head>
<body>
  <header>
    <h1>用药记录</h1>
    <p class="generated">生成时间：${escapeHtml(formatLocalDateTime(now))}</p>
  </header>

  <div class="meta">
    ${patientRow}
    <div class="meta-item">
      <span class="meta-label">统计范围</span>
      <span>${escapeHtml(formatLocalDate(since))} 至 ${escapeHtml(formatLocalDate(now))}（近 ${rangeDays} 天）</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">注射记录</span>
      <span>${reportInjections.length} 条</span>
    </div>
  </div>

  <section>
    <h2>注射记录</h2>
    <table>
      <colgroup>
        <col style="width: 20%" />
        <col style="width: 14%" />
        <col style="width: 14%" />
        <col style="width: 11%" />
        <col style="width: 12%" />
        <col style="width: 12%" />
        <col style="width: 17%" />
      </colgroup>
      <thead>
        <tr>
          <th>日期时间</th>
          <th>药名</th>
          <th>通用名</th>
          <th>剂量</th>
          <th>部位</th>
          <th>批号</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>${injectionRows}</tbody>
    </table>
  </section>

  <section>
    <h2>症状摘要</h2>
    <div class="stats">
      <div class="stat"><span class="stat-label">记录次数</span><span class="stat-value">${symptomSummary.count}</span></div>
      <div class="stat"><span class="stat-label">平均严重度（1–5）</span><span class="stat-value">${symptomSummary.count === 0 ? '—' : symptomSummary.avgSeverity.toFixed(1)}</span></div>
      <div class="stat"><span class="stat-label">平均疼痛（NRS 0–10）</span><span class="stat-value">${symptomSummary.avgPain === null ? '—' : symptomSummary.avgPain.toFixed(1)}</span></div>
      <div class="stat"><span class="stat-label">最常见标签</span><span class="stat-value">${escapeHtml(symptomSummary.mostCommonTag)}</span></div>
    </div>
    <p class="hint">症状记录仅用于自我观察，不构成因果判断。</p>
  </section>

  <section>
    <h2>依从性统计</h2>
    <div class="stats">
      <div class="stat"><span class="stat-label">已记录</span><span class="stat-value">${adherence.total}</span></div>
      <div class="stat"><span class="stat-label">按时</span><span class="stat-value">${adherence.onTime}</span></div>
      <div class="stat"><span class="stat-label">提前</span><span class="stat-value">${adherence.early}</span></div>
      <div class="stat"><span class="stat-label">延迟</span><span class="stat-value">${adherence.late}</span></div>
      <div class="stat"><span class="stat-label">平均偏差</span><span class="stat-value">${deviationLabel}</span></div>
    </div>
    <p class="hint">按时指实际注射时间与计划时间的偏差不超过方案设定的窗口天数；偏差为负数表示提前。</p>
  </section>

  <footer>${DISCLAIMER}</footer>
</body>
</html>`
}

function formatDose(injection: Injection): string {
  if (injection.dose === null) return '—'
  return `${injection.dose} ${injection.unit}`.trim()
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
