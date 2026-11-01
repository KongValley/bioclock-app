# BioClock 导入编辑器

一个纯静态网页工具：把纸质/记忆里的注射、口服打卡和症状补录成 BioClock 可以导入的 JSON / Excel。
不需要登录、不联网、不上传数据，所有内容只存在浏览器 localStorage。

## 打开方式

**直接双击 `index.html`** 即可（`src/meta.js` 就是为了让 `file://` 也能读到病种/药物数据）。

在线版：https://kongvalley.github.io/bioclock-app/ （推送到 `main` 后由 GitHub Actions 自动发布，
见 `.github/workflows/import-editor.yml`）。

如果浏览器限制本地文件，也可以在仓库根目录起一个静态服务：

```bash
npx serve tools/import-editor
# 或
python -m http.server 4173 --directory tools/import-editor
```

## 流程

1. 选择病种（可多选，克罗恩病 + 强直性脊柱炎会合并药物列表）。
2. 目录里没有的药（国产仿制药、口服药等）在「我的药物」里加一条，导出时会随文件带给 App。
3. 在「注射记录 / 症状记录 / 口服打卡」里逐条填写，点「添加」；也可以直接「下载空白模板」，在 Excel 里填。
4. 点「下载 Excel」或「下载 JSON」，把文件传到手机。
5. App 里：设置 → 导入数据 → 选择文件 → 确认。

App 会按「时间 + 用药线」跳过重复记录，症状按「时间 + 严重程度 + 症状」去重，重复导入同一个文件不会翻倍。

## Excel

- 「下载空白模板」生成带表头、示例行和「填写说明」的 `.xlsx`。
- 「下载 Excel」导出当前编辑器里的内容，共四张数据表（`注射记录` / `口服打卡` / `症状记录` / `药物`）+ 一张 `填写说明`。
- 药物表里 `目录标识` 留空表示自定义药物；目录里有的药会带上 `catalogKey`。
- Excel 的列定义见 [`docs/import-format.md`](../../docs/import-format.md#excel-格式推荐)。
- 模板文件也直接放在 [`templates/bioclock-import-template.xlsx`](./templates/bioclock-import-template.xlsx)，用 `npm run import-template` 重新生成。

## 字段与格式

导出文件格式（同时也是 App 的导入格式）见仓库 [`docs/import-format.md`](../../docs/import-format.md)。
当前是 **v3**：`{ format, version: 3, medications, injections, oralLogs, symptoms, lineStates, efficacyEvents }`，App 仍接受 v1/v2 文件。
工具会原样保留导入文件里的 `lineStates` / `efficacyEvents`，即使页面不编辑它们。

## 修改这个工具

```
tools/import-editor/
  index.html              页面结构
  src/styles.css          样式（跟随系统深浅色）
  src/app.js              全部交互逻辑（原生 JS，无框架）
  src/meta.js             由脚本生成，勿手改
  src/meta.json           同上，给需要 fetch 的场景
  src/vendor/xlsx.full.min.js   SheetJS，离线读写 Excel（Apache-2.0）
  scripts/generate-meta.mjs     从 App 目录数据生成 meta
  scripts/make-template.mjs     生成 Excel 模板
  templates/               Excel 导入模板
  sample-import.json      示例文件
```

病种、药名、默认症状标签都来自 App 源码，不在这里手写。App 目录更新后，在仓库根目录执行：

```bash
npm run import-editor
```

这个脚本用 `@babel/core` 把 `src/data/diseases.ts`、`src/data/catalog.ts`、`src/domain/rotation.ts`、`src/i18n/zh.ts`
转成运行时能 import 的 CommonJS，再导出 `meta.json` / `meta.js`。

用 MiniMax Code 改这个工具时，注意：

- 导出的 JSON 必须保持 `format: "bioclock-import"`、`version: 3`（同时能读 v1/v2），字段名和 `docs/import-format.md` 一致。
- 时间统一写本地时间字符串 `YYYY-MM-DD HH:mm`，不要写 ISO + Z。
- 不要引入构建步骤或外部 CDN，保持双击可用。
