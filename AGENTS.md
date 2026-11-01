# AGENTS.md

给在本仓库工作的 AI 编码代理（Codex / Claude Code / MiniMax Code / Cursor 等）的说明。
人类贡献者也可以按这份约定来。

## 1. 这是什么项目

BioClock：记录生物制剂注射、提醒下次注射、记录症状的个人健康工具。

- React Native + Expo SDK 58 + expo-router + TypeScript
- 数据**纯本地**（expo-sqlite），无账号、无服务器、无网络请求、无埋点
- 目标用户：银屑病 / 强直性脊柱炎 / 类风湿 / 炎症性肠病等需要长期自我注射的患者
- 病种支持多选合并（例如同时有克罗恩病和强直性脊柱炎）

## 2. 不可违反的红线

1. **不做医疗判断**。不写"建议停药/换药/调整剂量"、不根据症状推导诊断。所有方案参数由用户按医嘱录入，App 只做算术和提醒。
2. **不联网**。不要新增 HTTP 请求、云同步、账号、第三方分析 SDK。导入/导出都走本地文件。
3. **不收集隐私**。日志、崩溃上报、埋点一律不加；数据库文件（`*.db`）和导出的 CSV/PDF 不能提交进仓库。
4. **文案要克制**。涉及症状、依从性的页面保留"仅用于自我观察，不构成因果判断"这类提示。
5. **不要删用户数据**。v5 的整套表重建是用户已确认的一次性例外（见第 6 节），之后的结构变更只能加列/加表；清库逻辑必须保留内置药物并重新播种。任何破坏性操作要有二次确认。

## 3. 常用命令

```bash
npm install
npm start                 # Expo 开发服务器
npm run android           # 连真机/模拟器
npm run web               # 浏览器（expo-sqlite 能力受限）
npm run typecheck         # tsc --noEmit
npm test                  # vitest（纯函数 + 迁移测试）
npm run import-editor     # 重新生成 tools/import-editor/src/meta.{json,js}
npm run import-template   # 重新生成 Excel 导入模板 tools/import-editor/templates/*.xlsx
```

本机是 Windows + PowerShell 5.1。跑完改动至少执行 `npm run typecheck` 和 `npm test`。

## 4. 目录结构

```
app/                      expo-router 路由
  (tabs)/                 今天 / 记录 / 趋势 / 设置
  onboarding/             四步引导：病种(可多选) → 药物 → 方案 → 提醒
  modal/                  注射登记、口服打卡、症状登记（支持 ?id= 编辑）
src/
  data/                   病种、生物制剂目录与方案模板（只读）
  db/                     建表、迁移、播种、仓库层
  domain/                 排程（含口服）、部位轮换、依从性、疼痛分档、药名匹配（纯函数 + 单测）
  import/                 导入文件解析与落库
  notify/                 本地通知排程
  export/                 CSV / Excel / JSON / PDF 导出
  store/                  zustand 全局状态
  ui/                     主题、通用组件、图标
docs/                     设计方案、接口契约、导入格式
tools/import-editor/      补录数据并导出 JSON / Excel 的静态网页工具
```

路径别名：`@/*` → `src/*`。

## 5. 代码风格

- TypeScript strict，2 空格缩进，单引号，**不写分号**（沿用现有文件）。
- 组件优先用函数组件 + hooks；不要引入 UI 框架或状态库（已有 zustand）。
- 颜色、间距、圆角、字号一律走 `useTheme()` 的 token；**禁止硬编码颜色**（品牌色也在 `src/ui/theme.ts`）。
- 图标统一用 `src/ui/components/Icon.tsx`（Lucide 路径，24×24 网格），不要用 emoji 或字符符号。
- 可点击元素最小 44×44，图标按钮要有 `accessibilityLabel`；选中态用 `accessibilityState`。
- 用户可见文案集中放 `src/i18n/zh.ts`（表单类文案已在 `zh.form`），不要在组件里散落长句。
- 时间：
  - 数据库统一存 UTC 毫秒（`INTEGER`）
  - 导入/导出文件用**本地时间字符串** `YYYY-MM-DD HH:mm`，不要写 ISO 带 Z
  - UI 展示用 `src/ui/components/date.ts` 里的格式化函数

## 6. 数据层规则

当前是 **v6「治疗组合」模型**（`SCHEMA_VERSION = 6`），表结构见 `src/db/schema.ts`：

| 表 | 用途 |
| --- | --- |
| `medication` | 药物；`route` 为 `sc / iv / oral`，`brand_names`、`disease_ids`、`extra` 存 JSON 文本 |
| `treatment` | 治疗组合；同一时间只有一个 `is_active = 1` |
| `treatment_line` | 每条药一条；`kind` 为 `injection / oral`。注射线用 `is_host`、`sync_with_host`、`anchor`、`window_days`，口服线用 `oral_*` 列；`ended_at` 非空表示已停用 |
| `treatment_phase` | 仅注射线的阶段（`loading / maintenance`），按 `order_idx` 依次执行 |
| `efficacy_event` | 疗效下降 / 失效 / 不耐受等事件，`doses_count` 保存事件时的已完成次数快照 |
| `dose_log` | 注射与口服统一的打卡记录（`status` 为 `done / skipped / missed`） |
| `reminder_rule` | 每个治疗方案一条，外键改为 `treatment_id` |
| `symptom_log` / `symptom_tag` | 症状与可维护的标签；`symptom_log.dose_log_id` 关联打卡记录（对外类型仍叫 `injectionId`） |
| `app_setting` | 键值设置 |

`medication.brand_names` 是 JSON 字符串数组（仓库层转成 `string[]`），`medication.extra` 是 JSON 对象，
导入/导出原样保留，核心逻辑不读 `extra`。`catalog_key` 有部分唯一索引，内置药靠它认领。

### 迁移策略

- `v5` 是整套方案模型重建：`regimen / regimen_phase / injection` 已被删除，改为 `treatment / treatment_line / treatment_phase / dose_log`。
- `v6` 只做增量：`treatment_line.ended_at` + `efficacy_event`，v5 数据完整保留。
- 用户已确认开发阶段旧数据不必保留。`src/db/index.ts` 的 `buildMigrationSql()`：
  - `user_version = 0`：只执行 `CREATE_TABLES_SQL`；
  - `user_version = 1–4`：先执行 `DROP_ALL_TABLES_SQL`，再执行 `CREATE_TABLES_SQL`；
  - `user_version = 5`：执行 `MIGRATION_6_SQL`；
  - 不再有 `MIGRATION_2/3/4_SQL`。
- 重建后由 `openAndMigrate()` 重新播种内置药和症状标签。**这是唯一允许直接删旧表的例外**；
  v5 之后的结构变更恢复「只加列/加表」的增量迁移，不要再 DROP 用户数据。
- `DELETE_ALL_BUSINESS_DATA_SQL` 只删 v6 的业务表（含 `efficacy_event`），保留内置药并重新播种标签；`DROP_ALL_TABLES_SQL` 同时列出新旧表名，保证老库能清干净。

修改表结构时，以下文件必须一起改，缺一不可：

1. `src/db/schema.ts`
   - `SCHEMA_VERSION` +1
   - `CREATE_TABLES_SQL`（新建库用，必须包含新列/新表）
   - 新增对应的增量迁移（v5 之后的版本）
   - 更新 `DELETE_ALL_BUSINESS_DATA_SQL` / `DROP_ALL_TABLES_SQL`
2. `src/db/index.ts` 的 `buildMigrationSql()` / `migrate()`：按版本号分支，注意 `version === 0` 只建表、不能跑 ALTER
3. `src/db/repo.ts`：行类型（snake_case）、映射（camelCase）、输入校验、错误信息用中文
4. `src/types.ts`：对外类型
5. `src/domain/__tests__/migration.test.ts`：补迁移测试（用 `node:sqlite` 真跑 SQL）
6. `docs/contract.md`：结构变更说明

播种数据必须幂等：

- 内置药：`seedBuiltinMedications` 按 `catalog_key` 认领
- 症状标签：`seedBuiltinSymptomTags` 用 `app_setting.symptom_tags_seeded` 标记，**不要**用"表为空就播种"，否则用户删空后会被重新塞回来

仓库层主要入口：`medications`、`treatments`（`list / getActive / get / create / addLine / setActive / update / remove`）、
`doseLogs`（`list / listBetween / create / update / remove`）、`symptoms`、`symptomTags`、`reminderRules`、`settings`。

写操作统一顺序（见 `src/store/app.ts`）：

```
repo 写入 → useAppStore.reload() → rescheduleAll() → 返回 notifyWarning
```

通知排程失败不回滚数据，交给调用方 toast 提示。

## 7. 导入 / 导出

- 导入：支持 `.xlsx` / `.xls` / `.json`。当前格式 **v3**（v1/v2 仍兼容），见 `docs/import-format.md`。
- JSON v3 顶层：`{ format, version: 3, medications, injections, oralLogs, symptoms, lineStates, efficacyEvents }`；v1/v2 没有后两段。
- Excel 五张工作表：`注射记录`、`症状记录`、`药物`、`口服打卡`、`填写说明`（App 导出的 `.xlsx` 另有只读的 `用药线`）。
- 解析器 `src/import/schema.ts`、`src/import/spreadsheet.ts` 必须是纯函数（不碰 React Native），便于 vitest 直接测。
- Excel 用 `xlsx`（SheetJS）解析，别再引入第二个表格库；日期既支持文本也支持 Excel 序列号。
- 落库 `src/import/index.ts`：整个文件一个事务；包含打卡记录时必须已有激活的治疗方案；
  - 药物按药名 / 通用名 / 商品名 / 内置目录名称互认，命中已有药只补空字段并合并商品名；
  - 注射/口服记录按「药名 → 当前方案同药的用药线」解析，找不到线时**自动新建**（注射线用导入记录的中位间隔，口服线默认每天一次）；
  - 重复记录按「打卡时间 + 用药线」跳过；症状按「时间 + 严重程度 + 症状组合」跳过；
  - `previewImport` 用同一套逻辑只算数量，确认框显示将新建几条用药线；
  - 症状里的新标签自动补进 `symptom_tag`。
- **不要改格式字段名**。网页工具、示例文件、解析器、文档四处必须同步改，并补 `src/import/__tests__` 测试。
- 导出：CSV 只导出注射记录；Excel 导出 5 张表（含 `用药线`）；JSON 导出可直接再导入的 v3；PDF 报告用内联 HTML + expo-print。

## 8. 网页工具 `tools/import-editor`

- 纯静态、无框架、无构建、无 CDN，双击 `index.html` 就能用。
- 病种/药名/默认症状来自 `src/meta.js`，由 `npm run import-editor` 从 App 源码生成；**不要手改 `meta.json` / `meta.js`**。
- Excel 读写用本地 vendored 的 SheetJS（`src/vendor/xlsx.full.min.js`，Apache-2.0），不要改成 CDN。
- 时间输出必须是 `YYYY-MM-DD HH:mm`。
- 改完在浏览器里实际点一遍：添加/编辑/删除、下载、导入已有 JSON、深浅色。
- GitHub Pages 部署从仓库根目录的 `tools/import-editor` 构建（见 workflow）。

## 9. 测试与验证

必做：

```bash
npm run typecheck
npm test
npx expo export --platform android --output-dir .expo-verify   # 验证 Metro/Hermes 能打包
```

说明：

- 纯业务逻辑（排程、轮换、依从性、疼痛分档、导入解析）必须有 vitest 单测。
- 涉及建库/迁移的改动必须跑 `migration.test.ts`（依赖 Node 22+ 的 `node:sqlite`）。
- `npx expo export --platform web` 目前会因 expo-sqlite 的 wasm 资源报错，这是已知问题，用 android 打包验证。
- UI 改动建议在模拟器/真机过一遍主路径：登记注射、编辑记录、切换深浅色、导入导出。

### MuMu 模拟器（本机）

- adb：`G:\Program Files\Netease\MuMu\nx_device\12.0\shell\adb.exe`
- **优先用 `emulator-5556`**（启动后自动出现，不用手动 connect）；
  桥接模式也可以 `adb connect 192.168.31.105:5555`，NAT 模式是 `127.0.0.1:16384`
- Expo Go 可以直接侧载（不用 Google Play）：
  `https://github.com/expo/expo-go-releases/releases/download/Expo-Go-58.0.5/Expo-Go-58.0.5.apk`
- 宿主机服务在模拟器里用 `10.0.2.2:<port>`（NAT）或局域网 IP（桥接）访问
- MuMu 多屏会把 App 放到独立 display（常见是 2 或 4），要显式指定：
  `adb shell input -d 2 tap ...`，`adb shell screencap -p -d <SurfaceFlinger id>`
  （`adb shell dumpsys SurfaceFlinger --display-id` 查 id）
- RN 的 `uiautomator dump` 经常给出 `[0,0][0,0]` 的假 bounds，别依赖它定位，使用截图坐标
- `adb shell input text` 只支持 ASCII；中文测试内容用英文代替，或先用输入法粘贴
- **不要 `adb root`**，会让 adb 掉线；用
  `MuMuManager.exe sh -v 1 "<命令>"` 以 root 执行 shell
- 桥接模式触发的"ARP 攻击拦截"是 MuMu 虚拟网卡广播导致的误报
- Expo Go 里 `expo-file-system` 读不了 DocumentPicker 的缓存文件，用 `fetch(uri)` 读，
  见 `app/(tabs)/settings.tsx::readPickedText`；`.json` 在系统"打开方式"里没有 BioClock 是正常的

## 10. 提交与发布

- 提交信息用 Conventional Commits + scope：`feat(symptom): ...`、`fix(db): ...`、`docs(import): ...`、`chore: ...`
- 标题用英文、祈使句；正文可以中文，写清动机和影响。
- 一个提交只做一件事；生成物（`meta.json` / `meta.js`）变更要跟脚本一起提交。
- 不提交：`node_modules/`、`.expo/`、`dist/`、`*.db*`、`coverage/`、`.expo-verify/`、导出的 CSV/PDF。
- 远端：`origin` → `https://github.com/KongValley/bioclock-app`，主分支 `main`。

## 11. 改完自检清单

- [ ] 没有新增网络请求/分析 SDK/硬编码颜色/emoji 图标
- [ ] 文案在 `zh.ts`，医疗免责声明没被删
- [ ] 表结构改动配了迁移、测试、清库 SQL、文档
- [ ] 写操作走 store 的 `afterWrite`（刷新 + 重排通知）
- [ ] `npm run typecheck`、`npm test`、android 打包都通过
- [ ] 涉及 UI 的，模拟器截图确认过主路径和深色模式
- [ ] 提交信息符合规范，没有把数据库/导出文件带进 git

## 12. 文档索引

- `docs/design.md`：产品定位、信息架构、排程策略
- `docs/contract.md`：模块接口与数据模型契约（含 v3、v5 变更；v5 已取代 v3 的 regimen 部分）
- `docs/import-format.md`：导入文件格式（v3，兼容 v1/v2）与导入行为
- `tools/import-editor/README.md`：网页工具的结构与修改提示
