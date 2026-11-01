// 生成 Excel 导入模板：npm run import-editor 之外单独运行。
// 用法：node tools/import-editor/scripts/make-template.mjs
// 表头和网页工具「下载空白模板」保持一致，改动时两处一起改。
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

const oral = XLSX.utils.aoa_to_sheet([
  ['记录时间', '药物', '状态', '剂量', '单位', '备注'],
  ['2026-03-16 08:30', '甲氨蝶呤', '完成', 10, 'mg', '示例行，可删除'],
])
oral['!cols'] = [18, 16, 10, 8, 8, 28].map((wch) => ({ wch }))
XLSX.utils.book_append_sheet(workbook, oral, '口服打卡')

const symptom = XLSX.utils.aoa_to_sheet([
  ['记录时间', '严重程度', '疼痛评分', '症状', '体温(℃)', '备注', '关联注射时间'],
  ['2026-03-30 20:30', 4, 6, '发热、乏力', 37.8, '示例行，可删除', '2026-03-15 09:00'],
])
symptom['!cols'] = [18, 10, 10, 24, 10, 28, 18].map((wch) => ({ wch }))
XLSX.utils.book_append_sheet(workbook, symptom, '症状记录')

const medication = XLSX.utils.aoa_to_sheet([
  ['药名', '通用名', '商品名', '给药途径', '默认剂量', '单位', '目录标识'],
  ['甲氨蝶呤', '甲氨蝶呤', '', '口服', 10, 'mg', ''],
  ['阿达木单抗', '阿达木单抗', '修美乐、格乐立', '皮下注射', 40, 'mg', 'adalimumab'],
])
medication['!cols'] = [16, 16, 24, 12, 10, 8, 14].map((wch) => ({ wch }))
XLSX.utils.book_append_sheet(workbook, medication, '药物')

const help = XLSX.utils.aoa_to_sheet([
  ['填写说明'],
  ['1. 时间格式：2026-03-15 09:00（本地时间，不要写时区）'],
  ['2. 注射记录：注射时间、药物必填；部位可写中文（腹部左上）或留空'],
  ['3. 口服打卡：记录时间、药物必填；状态写 完成 / 跳过 / 漏服，留空按「完成」算'],
  ['4. 症状记录：记录时间必填；严重程度 1–5；疼痛评分 0–10；症状用顿号或逗号分隔'],
  ['5. 关联注射时间可选，要和某条注射记录的注射时间完全一致'],
  ['6. 药物：目录里没有的药（国产仿制药、口服药等）在这里加一行，药名必填；'],
  ['   给药途径写 皮下注射 / 静脉输注 / 口服；目录标识留空表示自定义药物'],
  ['7. 不要修改表头名称；示例行可以删除或直接覆盖；用不到的整张表可以直接删掉'],
  ['8. 填好后保存为 .xlsx，在 App 的 设置 → 导入数据 里选择该文件'],
])
help['!cols'] = [{ wch: 80 }]
XLSX.utils.book_append_sheet(workbook, help, '填写说明')

XLSX.writeFile(workbook, out)
console.log(`模板已生成：${out}`)
