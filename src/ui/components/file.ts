import { readAsStringAsync } from 'expo-file-system/legacy'

/**
 * Expo Go 里 expo-file-system 会拒绝读取 DocumentPicker 复制到缓存的文件
 * （Missing 'READ' permission），但 React Native 的 fetch 直接走 Uri 读取，
 * 不受这层权限校验影响；先试 fetch，失败再退回 expo-file-system。
 */

export async function readPickedBuffer(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri)
  if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）`)
  return await response.arrayBuffer()
}

export async function readPickedText(uri: string): Promise<string> {
  try {
    const response = await fetch(uri)
    if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）`)
    return await response.text()
  } catch (error) {
    try {
      return await readAsStringAsync(uri)
    } catch {
      throw error instanceof Error ? error : new Error('读取文件失败')
    }
  }
}
