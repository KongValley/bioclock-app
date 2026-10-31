/**
 * 本地通知文案。
 *
 * 只描述「到时间了、该做什么」，不出现诊断性表述、剂量调整或用药建议。
 * 文案中的 offsetDays 表示距注射日的天数：0 = 当天，1 = 前一天，2 = 前两天。
 */

export const NOTIFY_PREP_HINT = '提前 30 分钟从冰箱取出，回温后再注射'

export function buildReminderContent(input: {
  medicationName: string
  dose: number | null
  unit: string
  offsetDays: number
  isSameDayEvening?: boolean
  route: 'sc' | 'iv'
}): { title: string; body: string } {
  const medicationName = input.medicationName.trim() || '本次用药'
  const doseLabel = formatDose(input.dose, input.unit)
  const daysAhead = Math.abs(Math.trunc(input.offsetDays))

  if (input.route === 'iv') {
    return buildInfusionContent(medicationName, doseLabel, daysAhead, input.isSameDayEvening === true)
  }

  return buildInjectionContent(medicationName, doseLabel, daysAhead, input.isSameDayEvening === true)
}

function buildInjectionContent(
  medicationName: string,
  doseLabel: string,
  daysAhead: number,
  isSameDayEvening: boolean,
): { title: string; body: string } {
  if (daysAhead >= 2) {
    return {
      title: `还有 ${daysAhead} 天该注射了`,
      body: `${withDose(medicationName, doseLabel)}，可以开始安排时间了。`,
    }
  }

  if (daysAhead === 1) {
    return {
      title: '明天该注射了',
      body: `${withDose(medicationName, doseLabel)}，别忘了提前把冷藏药取出来回温。`,
    }
  }

  if (isSameDayEvening) {
    return {
      title: '今天还没登记注射',
      body: `如果今天已经完成 ${medicationName} 注射，记得回来登记一下。`,
    }
  }

  return {
    title: '今天该注射了',
    body: `${withDose(medicationName, doseLabel)}。${NOTIFY_PREP_HINT}`,
  }
}

function buildInfusionContent(
  medicationName: string,
  doseLabel: string,
  daysAhead: number,
  isSameDayEvening: boolean,
): { title: string; body: string } {
  if (daysAhead >= 2) {
    return {
      title: `还有 ${daysAhead} 天该去医院输注了`,
      body: `${withDose(medicationName, doseLabel)}，请提前安排好时间。`,
    }
  }

  if (daysAhead === 1) {
    return {
      title: '明天该去医院输注了',
      body: `${withDose(medicationName, doseLabel)}，请提前确认就诊安排。`,
    }
  }

  if (isSameDayEvening) {
    return {
      title: '今天还没登记输注',
      body: `如果今天已经在医院完成 ${medicationName} 输注，记得回来登记一下。`,
    }
  }

  return {
    title: '今天该去医院输注了',
    body: `${withDose(medicationName, doseLabel)}，请按预约时间前往医院。`,
  }
}

function withDose(medicationName: string, doseLabel: string): string {
  return doseLabel ? `${medicationName} ${doseLabel}` : medicationName
}

function formatDose(dose: number | null, unit: string): string {
  if (dose === null || !Number.isFinite(dose)) return ''
  return `${dose}${unit}`.trim()
}
