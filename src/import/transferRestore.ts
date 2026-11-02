import { summarizeTransfer, transferToImportPayload } from '@/export/transferSchema'
import { useAppStore } from '@/store/app'
import { ensureTreatmentFromTransfer } from './transfer'
import type { ImportResult } from './index'

export interface TransferRestoreOutcome {
  result: ImportResult
  notifyWarning: string | null
}

/**
 * 从换机快照完整恢复：先按快照建出激活方案（新设备上尚无方案时），
 * 再复用 v3 导入流程写打卡/症状/疗效，最后恢复设置与提醒。
 *
 * 新设备必须先完成这一步，再标记 onboarded_at；否则引导页会先建一个
 * 空方案，后续换机恢复就只能合并记录、拿不回阶段结构。
 */
export async function restoreTransferBackup(text: string): Promise<TransferRestoreOutcome> {
  const summary = summarizeTransfer(text)
  await ensureTreatmentFromTransfer(text)

  const { result, notifyWarning } = await useAppStore
    .getState()
    .importRecords(transferToImportPayload(text))

  const warnings: string[] = []
  if (notifyWarning) warnings.push(notifyWarning)

  const safeSettings = { ...summary.settings }
  delete safeSettings.app_lock
  if (!safeSettings.onboarded_at) safeSettings.onboarded_at = String(Date.now())
  const settingsResult = await useAppStore.getState().updateSettings(safeSettings)
  if (settingsResult.notifyWarning) warnings.push(settingsResult.notifyWarning)

  const active = useAppStore.getState().treatment
  if (active && summary.reminder) {
    const reminderResult = await useAppStore.getState().updateReminder({
      treatmentId: active.id,
      offsets: summary.reminder.offsets,
      timeOfDay: summary.reminder.timeOfDay,
      snoozeMinutes: summary.reminder.snoozeMinutes,
      enabled: summary.reminder.enabled,
    })
    if (reminderResult.notifyWarning) warnings.push(reminderResult.notifyWarning)
  }

  return {
    result,
    notifyWarning: warnings.length > 0 ? warnings.join('；') : null,
  }
}
