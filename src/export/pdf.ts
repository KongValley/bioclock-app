import { File, Paths } from 'expo-file-system'
import { printToFileAsync } from 'expo-print'
import { doseLogs, medications, settings, symptoms, treatments } from '@/db/repo'
import type { DoseLog, LineKind, Medication, SymptomLog, TreatmentLine } from '@/types'
import { computeAdherence } from '@/domain/adherence'
import type { AdherenceStats } from '@/domain/adherence'
import { SITE_LABELS } from '@/domain/rotation'
import { zh } from '@/i18n/zh'
import { readPickedBuffer } from '@/ui/components/file'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_DAYS = 180
const DISCLAIMER =
  '本报告由患者自行记录生成，仅用于就诊沟通，不构成医疗诊断或用药建议。'

interface LineSummary {
  label: string
  kind: LineKind
  /** 注射线：已完成针数；口服线：已完成打卡数 */
  done: number
  /** 注射线才有 */
  onTime: number | null
  missed: number
  /** 注射线才有 */
  avgDeviationDays: number | null
  /** 完成率 0–1 */
  rate: number
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

  const [allTreatments, allMedications, allSymptoms, allLogs, appSettings] = await Promise.all([
    treatments.list(),
    medications.list(),
    symptoms.list(),
    doseLogs.list(),
    settings.all(),
  ])

  const patientName = opts.patientName?.trim() || appSettings.patient_name?.trim() || ''
  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication]))
  const lineById = new Map<string, TreatmentLine>()
  for (const treatment of allTreatments) {
    for (const line of treatment.lines) lineById.set(line.id, line)
  }

  const reportLogs = allLogs
    .filter((log) => lineById.get(log.lineId)?.kind === 'injection')
    .filter((log) => {
      const time = logTime(log)
      return time >= since && time <= now
    })
    .sort((a, b) => logTime(a) - logTime(b))

  const rangeSymptoms = allSymptoms.filter(
    (symptom) => symptom.loggedAt >= since && symptom.loggedAt <= now,
  )

  const { stats, rows } = summarizeAdherence(allTreatments, allLogs, lineById, now)
  const symptomSummary = summarizeSymptoms(rangeSymptoms)
  const html = buildHtml({
    patientName,
    rangeDays,
    since,
    now,
    logs: reportLogs,
    lineById,
    medicationById,
    adherence: stats,
    lineSummaries: rows,
    symptomSummary,
  })

  const printed = await printToFileAsync({ html, width: 595, height: 842 })
  // expo-print 的临时目录在 Expo Go 的 File 权限范围外，用本地 URI 读取后再写入。
  const bytes = await readPickedBuffer(printed.uri)
  const filename = `bioclock-${formatLocalDate(now)}.pdf`
  const target = new File(Paths.cache, filename)
  if (target.exists) target.delete()
  target.create({ overwrite: true })
  target.write(new Uint8Array(bytes))

  return { path: target.uri, filename }
}

function resolveRangeDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RANGE_DAYS
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('统计范围必须是大于 0 的天数')
  }
  return Math.floor(value)
}

function logTime(log: DoseLog): number {
  return log.takenAt ?? log.scheduledAt ?? log.createdAt
}

function summarizeAdherence(
  allTreatments: Array<{ lines: TreatmentLine[] }>,
  allLogs: DoseLog[],
  lineById: Map<string, TreatmentLine>,
  now: number,
): { stats: AdherenceStats; rows: LineSummary[] } {
  const lines = allTreatments.flatMap((treatment) => treatment.lines)
  const stats = computeAdherence(lines, allLogs, now)

  const rows: LineSummary[] = stats.byLine.map((entry) => {
    const label = lineById.get(entry.lineId)?.label ?? entry.lineId
    if (entry.kind === 'oral') {
      return {
        label,
        kind: 'oral',
        done: entry.total,
        onTime: null,
        missed: entry.missed,
        avgDeviationDays: null,
        rate: entry.rate,
      }
    }
    const denominator = entry.total + entry.missed
    return {
      label,
      kind: 'injection',
      done: entry.total,
      onTime: entry.onTime,
      missed: entry.missed,
      avgDeviationDays: entry.avgDeviationDays,
      rate: denominator > 0 ? round2(entry.total / denominator) : 0,
    }
  })

  return { stats, rows }
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
    avgSeverity: round1(severitySum / logs.length),
    avgPain: painScores.length === 0 ? null : round1(painSum / painScores.length),
    mostCommonTag,
  }
}

function buildHtml(input: {
  patientName: string
  rangeDays: number
  since: number
  now: number
  logs: DoseLog[]
  lineById: Map<string, TreatmentLine>
  medicationById: Map<string, Medication>
  adherence: AdherenceStats
  lineSummaries: LineSummary[]
  symptomSummary: SymptomSummary
}): string {
  const {
    patientName,
    rangeDays,
    since,
    now,
    logs: reportLogs,
    lineById,
    medicationById,
    adherence,
    lineSummaries,
    symptomSummary,
  } = input

  const injectionRows =
    reportLogs.length === 0
      ? '<tr><td class="empty" colspan="8">该时间范围内暂无注射记录</td></tr>'
      : reportLogs
          .map((log) => {
            const line = lineById.get(log.lineId)
            const medication = line ? medicationById.get(line.medicationId) : undefined
            const isInfusion = medication?.route === 'iv'
            const site = isInfusion ? '—' : log.site ? SITE_LABELS[log.site] ?? '—' : '—'
            return `<tr>
              <td class="nowrap">${escapeHtml(formatLocalDateTime(logTime(log)))}</td>
              <td>${zh.doseStatus[log.status]}</td>
              <td>${escapeHtml(medication?.name ?? line?.label ?? '—')}</td>
              <td>${escapeHtml(medication?.genericName ?? '—')}</td>
              <td class="nowrap">${escapeHtml(formatDose(log, medication))}</td>
              <td>${escapeHtml(site)}</td>
              <td>${escapeHtml(log.lotNumber ?? '—')}</td>
              <td class="note">${escapeHtml(log.note ?? '—')}</td>
            </tr>`
          })
          .join('')

  const lineRows =
    lineSummaries.length === 0
      ? '<tr><td class="empty" colspan="7">暂无用药线</td></tr>'
      : lineSummaries
          .map((row) => {
            const kindLabel = row.kind === 'oral' ? '口服' : '注射'
            const onTime = row.kind === 'injection' ? String(row.onTime ?? 0) : '—'
            const deviation =
              row.avgDeviationDays === null
                ? '—'
                : `${row.avgDeviationDays > 0 ? '+' : ''}${row.avgDeviationDays.toFixed(1)} 天`
            return `<tr>
              <td>${escapeHtml(row.label)}</td>
              <td class="nowrap">${kindLabel}</td>
              <td>${row.done}</td>
              <td>${onTime}</td>
              <td>${row.missed}</td>
              <td class="nowrap">${deviation}</td>
              <td>${Math.round(row.rate * 100)}%</td>
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
      <span>${reportLogs.length} 条</span>
    </div>
  </div>

  <section>
    <h2>注射记录</h2>
    <table>
      <colgroup>
        <col style="width: 19%" />
        <col style="width: 7%" />
        <col style="width: 13%" />
        <col style="width: 13%" />
        <col style="width: 11%" />
        <col style="width: 10%" />
        <col style="width: 10%" />
        <col style="width: 17%" />
      </colgroup>
      <thead>
        <tr>
          <th>日期时间</th>
          <th>${zh.report.status}</th>
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
    <h2>${zh.report.adherenceAllHistory}</h2>
    <div class="stats">
      <div class="stat"><span class="stat-label">已记录</span><span class="stat-value">${adherence.total}</span></div>
      <div class="stat"><span class="stat-label">按时</span><span class="stat-value">${adherence.onTime}</span></div>
      <div class="stat"><span class="stat-label">提前</span><span class="stat-value">${adherence.early}</span></div>
      <div class="stat"><span class="stat-label">延迟</span><span class="stat-value">${adherence.late}</span></div>
      <div class="stat"><span class="stat-label">平均偏差</span><span class="stat-value">${deviationLabel}</span></div>
      <div class="stat"><span class="stat-label">整体完成率</span><span class="stat-value">${Math.round(adherence.rate * 100)}%</span></div>
    </div>
    <table style="margin-top: 12px;">
      <colgroup>
        <col style="width: 26%" />
        <col style="width: 10%" />
        <col style="width: 12%" />
        <col style="width: 10%" />
        <col style="width: 10%" />
        <col style="width: 16%" />
        <col style="width: 16%" />
      </colgroup>
      <thead>
        <tr>
          <th>用药线</th>
          <th>方式</th>
          <th>已完成</th>
          <th>按时</th>
          <th>漏用</th>
          <th>平均偏差</th>
          <th>完成率</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>
    <p class="hint">按时指实际注射时间与计划时间的偏差不超过方案设定的窗口天数；偏差为负数表示提前。口服线按打卡完成率统计。</p>
  </section>

  <footer>${DISCLAIMER}</footer>
</body>
</html>`
}

function formatDose(log: DoseLog, medication: Medication | undefined): string {
  if (log.dose === null) return '—'
  const unit = log.unit || medication?.unit || ''
  return `${log.dose} ${unit}`.trim()
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
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
