import * as Sharing from 'expo-sharing'

export { exportCsv } from './csv'
export { exportPdf } from './pdf'
export { exportJson } from './json'
export { exportExcel } from './excel'
export { exportTransferFile } from './transferFile'
export {
  isTransferFile,
  parseTransferFile,
  summarizeTransfer,
  transferToImportPayload,
} from './transferSchema'

/** 调起系统分享面板。设备不支持时抛中文错误，由 UI 层提示。 */
export async function shareFile(path: string): Promise<void> {
  const available = await Sharing.isAvailableAsync()
  if (!available) {
    throw new Error('当前设备不支持系统分享，请从文件管理中导出')
  }

  const lowerPath = path.toLowerCase()
  const mimeType = lowerPath.endsWith('.csv')
    ? 'text/csv'
    : lowerPath.endsWith('.pdf')
      ? 'application/pdf'
      : lowerPath.endsWith('.json')
        ? 'application/json'
        : lowerPath.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : undefined

  await Sharing.shareAsync(path, {
    dialogTitle: '分享用药记录',
    ...(mimeType ? { mimeType } : {}),
  })
}
