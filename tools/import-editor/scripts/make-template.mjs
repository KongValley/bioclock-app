// 生成 Excel 导入模板：npm run import-editor 之外单独运行。
// 用法：node tools/import-editor/scripts/make-template.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'templates', 'bioclock-import-template.xlsx')
fs.mkdirSync(path.dirname(out), { recursive: true })

const workbook = XLSX.utils.book_new()

const injection = XLSX.utils.aoa_to_sheet([
  ['注射时间', '药物', '剂量', '单位', '部位', '批号', '备注'],
  ['2026-03-15 09:00', '阿达木单抗', 40, 'mg', '腹部左上', 'AB12345', '示例行，可删除'],
])
injection['!cols'] = [18, 16, 8, 8, 12, 12, 28].map((wch) => ({ wch }))
XLSX.utils.book_append_sheet(workbook, injection, '注射记录')

const symptom = XLSX.utils.aoa_to_sheet([
  ['记录时间', '严重程度', '疼痛评分', '症状', '体温(℃)', '备注', '关联注射时间'],
  ['2026-03-30 20:30', 4, 6, '发热、乏力', 37.8, '示例行，可删除', '2026-03-15 09:00'],
])
symptom['!cols'] = [18, 10, 10, 24, 10, 28, 18].map((wch) => ({ wch }))
XLSX.utils.book_append_sheet(workbook, symptom, '症状记录')

const help = XLSX.utils.aoa_to_sheet([
  ['填写说明'],
  ['1. 时间格式：2026-03-15 09:00（本地时间，不要写时区）'],
  ['2. 注射记录：注射时间、药物必填；部位可写中文（腹部左上）或留空'],
  ['3. 症状记录：记录时间必填；严重程度 1–5；疼痛评分 0–10；症状用顿号或逗号分隔'],
  ['4. 关联注射时间可选，要和某条注射记录的注射时间完全一致'],
  ['5. 不要修改表头名称；示例行可以删除或直接覆盖'],
  ['6. 填好后保存为 .xlsx，在 App 的 设置 → 导入数据 里选择该文件'],
])
help['!cols'] = [{ wch: 80 }]
XLSX.utils.book_append_sheet(workbook, help, '填写说明')

XLSX.writeFile(workbook, out)
console.log(`模板已生成：${out}`)
