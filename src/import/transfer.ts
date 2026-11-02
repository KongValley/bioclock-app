import {
  medications as medicationRepo,
  treatments as treatmentRepo,
  type TreatmentLineInput,
} from '@/db/repo'
import { findMedicationByName } from '@/domain/medication'
import { parseTransferFile } from '@/export/transferSchema'

/**
 * 全新设备导入换机文件时，先根据快照里的方案结构建出激活方案和用药线，
 * 后续打卡/症状仍交给正常的导入流程，避免“还没有治疗方案”而失败。
 *
 * 如果当前已经有激活方案，则不创建，直接按现有方案合并记录。
 */
export async function ensureTreatmentFromTransfer(text: string): Promise<boolean> {
  const active = await treatmentRepo.getActive()
  if (active) return false

  const transfer = parseTransferFile(text)
  const template = transfer.treatments.find((item) => item.isActive) ?? transfer.treatments[0]
  if (!template || template.lines.length === 0) return false

  let medications = await medicationRepo.list()
  const resolveMedicationId = async (medicationId: string): Promise<string | null> => {
    const source = transfer.medications.find((item) => item.id === medicationId)
    if (!source) return null

    const existing = findMedicationByName(medications, source.name)
    if (existing) return existing.id

    const created = await medicationRepo.create({
      name: source.name,
      genericName: source.genericName,
      brandNames: source.brandNames,
      defaultDose: source.defaultDose,
      unit: source.unit,
      color: source.color,
      route: source.route,
      diseaseIds: source.diseaseIds,
      catalogKey: source.catalogKey,
      isBuiltin: source.isBuiltin,
      extra: source.extra,
    })
    medications = [...medications, created]
    return created.id
  }

  const lines: TreatmentLineInput[] = []
  for (const line of template.lines) {
    const medicationId = await resolveMedicationId(line.medicationId)
    if (!medicationId) continue
    lines.push({
      medicationId,
      kind: line.kind === 'oral' ? 'oral' : 'injection',
      label: line.label,
      isHost: line.isHost,
      syncWithHost: line.syncWithHost,
      anchor: line.anchor === 'planned' ? 'planned' : 'actual',
      windowDays: line.windowDays,
      endedAt: line.endedAt,
      phases:
        line.kind === 'oral'
          ? []
          : line.phases.map((phase) => ({
              orderIdx: phase.orderIdx,
              kind: phase.kind === 'loading' ? 'loading' : 'maintenance',
              intervalDays: phase.intervalDays,
              repeatCount: phase.repeatCount,
              dose: phase.dose,
              unit: phase.unit,
              effectiveFrom: phase.effectiveFrom,
            })),
      oral:
        line.kind === 'oral' && line.oral
          ? {
              startDate: line.oral.startDate,
              durationDays: line.oral.durationDays,
              frequency:
                line.oral.frequency === 'weekly'
                  ? 'weekly'
                  : line.oral.frequency === 'custom'
                    ? 'custom'
                    : 'daily',
              timesPerPeriod: line.oral.timesPerPeriod,
              daysOfWeek: line.oral.daysOfWeek,
              remindTime: line.oral.remindTime,
            }
          : null,
    })
  }

  if (lines.length === 0) return false

  const created = await treatmentRepo.create({ name: template.name, lines })
  await treatmentRepo.setActive(created.id, true)
  return true
}
