import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseImportJson } from '../schema'

const samplePath = fileURLToPath(
  new URL('../../../tools/import-editor/sample-import.json', import.meta.url),
)

describe('导入工具的示例文件', () => {
  it('示例 JSON 能被 App 的解析器接受', () => {
    const payload = parseImportJson(readFileSync(samplePath, 'utf8'))
    expect(payload.injections).toHaveLength(2)
    expect(payload.symptoms).toHaveLength(1)
    expect(payload.injections[0].medicationName).toBe('阿达木单抗')
    expect(payload.symptoms[0].tags).toContain('发热')
    expect(payload.symptoms[0].injectionAt).toBe(
      parseImportJson(readFileSync(samplePath, 'utf8')).injections[1].injectedAt,
    )
  })
})
