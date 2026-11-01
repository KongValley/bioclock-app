# 实现契约 v1

所有子代理必须严格按本文件的类型与函数签名实现。**不得擅自改名、改参数、改返回值**。
如有冲突，以本文件为准；确实需要变更时，写在完成报告里，不要静默改动。

## 决策（已定，不再讨论）

| 项 | 决定 |
| --- | --- |
| 锚点 | 默认 `actual`（实际注射时间为锚），方案可切换 |
| 多药 | DB 支持多药多方案；UI 首版只展示"当前激活方案" |
| 语言 | 简体中文硬编码，字符串集中放 `src/i18n/zh.ts` |
| 预置药 | 修美乐/阿达木单抗、可善挺/司库奇尤单抗、拓咨/依奇珠单抗、喜达诺/乌司奴单抗、恩利/依那西普 |
| 数据层 | **纯 expo-sqlite + 手写 SQL**（不用 Drizzle，少一层构建风险） |
| 时间 | 全部存 UTC 毫秒 number，展示时转本地 |
| 包管理 | npm |

## 目录归属（避免并行冲突）

| 子代理 | 独占目录/文件 |
| --- | --- |
| A 骨架 | `package.json` `app.json` `tsconfig.json` `.gitignore` `src/db/**` `src/types.ts` `src/i18n/zh.ts` `src/ui/theme.ts` `app/_layout.tsx` `vitest.config.ts` |
| B 逻辑 | `src/domain/**` `src/domain/__tests__/**` |
| C 通知导出 | `src/notify/**` `src/export/**` |
| D 界面 | `app/(tabs)/**` `app/onboarding/**` `app/modal/**` `src/ui/components/**` `src/store/**` |

**任何子代理都不要修改别人的目录。** 需要公共能力就 import 契约里的东西。

## src/types.ts

```ts
export type RegimenAnchor = 'actual' | 'planned'
export type PhaseKind = 'loading' | 'maintenance'
export type WindowStatus = 'early' | 'on_time' | 'late'

export type InjectionSite =
  | 'abdomen_ul' | 'abdomen_ur' | 'abdomen_ll' | 'abdomen_lr'
  | 'thigh_l' | 'thigh_r' | 'arm_l' | 'arm_r'

export interface Medication {
  id: string
  name: string
  genericName: string | null
  defaultDose: number | null
  unit: string
  color: string
  isBuiltin: boolean
  createdAt: number
}

export interface RegimenPhase {
  id: string
  regimenId: string
  orderIdx: number
  kind: PhaseKind
  intervalDays: number
  repeatCount: number
  dose: number | null
  unit: string
}

export interface Regimen {
  id: string
  medicationId: string
  name: string
  anchor: RegimenAnchor
  windowDays: number
  isActive: boolean
  createdAt: number
  phases: RegimenPhase[]
}

export interface Injection {
  id: string
  regimenId: string
  medicationId: string
  injectedAt: number
  dose: number | null
  unit: string
  site: InjectionSite
  lotNumber: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface SymptomLog {
  id: string
  loggedAt: number
  severity: 1 | 2 | 3 | 4 | 5
  tags: string[]
  note: string | null
  temperature: number | null
  injectionId: string | null
}

export interface ReminderRule {
  id: string
  regimenId: string
  offsets: number[]        // 相对注射日提前的天数，如 [-2, -1, 0]
  timeOfDay: string        // 'HH:mm'
  snoozeMinutes: number
  enabled: boolean
}

export type AppSettings = Record<string, string>
```

## 数据层 API（A 提供）

```ts
// src/db/index.ts
export async function initDatabase(): Promise<void>   // 建表 + 幂等迁移 + 播种内置药
export async function resetDatabase(): Promise<void>  // 清空全部业务数据

// src/db/repo.ts
export const medications: {
  list(): Promise<Medication[]>
  get(id: string): Promise<Medication | null>
  create(input: Omit<Medication, 'id' | 'createdAt'>): Promise<Medication>
  remove(id: string): Promise<void>
}
export const regimens: {
  list(): Promise<Regimen[]>
  listActive(): Promise<Regimen | null>
  get(id: string): Promise<Regimen | null>
  create(input: { medicationId: string; name: string; anchor: RegimenAnchor;
    windowDays: number; phases: Array<Omit<RegimenPhase, 'id' | 'regimenId'>> }): Promise<Regimen>
  setActive(id: string, active: boolean): Promise<void>
  remove(id: string): Promise<void>
}
export const injections: {
  list(regimenId?: string): Promise<Injection[]>   // 按 injectedAt 升序
  create(input: Omit<Injection, 'id' | 'createdAt' | 'updatedAt'>): Promise<Injection>
  update(id: string, patch: Partial<Omit<Injection, 'id' | 'createdAt'>>): Promise<Injection>
  remove(id: string): Promise<void>
}
export const symptoms: {
  list(): Promise<SymptomLog[]>                     // 按 loggedAt 升序
  create(input: Omit<SymptomLog, 'id'>): Promise<SymptomLog>
  remove(id: string): Promise<void>
}
export const reminderRules: {
  getFor(regimenId: string): Promise<ReminderRule | null>
  upsert(input: Omit<ReminderRule, 'id'> & { id?: string }): Promise<ReminderRule>
}
export const settings: {
  all(): Promise<AppSettings>
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}
```

所有 id 用 `crypto.randomUUID()`（`expo-crypto` 提供 fallback，优先用 `Crypto.randomUUID()`）。

## 排程引擎（B 提供，纯函数）

```ts
// src/domain/schedule.ts
export type DoseStatus = 'done' | 'due' | 'upcoming' | 'overdue'

export interface DosePlan {
  index: number            // 第几针，从 0 开始
  phaseId: string
  phaseKind: PhaseKind
  plannedAt: number
  dose: number | null
  unit: string
  status: DoseStatus
  actualAt?: number
  deviationDays?: number   // 实际 - 计划，单位天（保留一位小数）
  windowStatus?: WindowStatus
}

export interface ScheduleInput {
  regimen: Regimen
  injections: Injection[]   // 已按 injectedAt 升序
  now: number
}

export function buildSchedule(input: ScheduleInput): DosePlan[]
export function nextDose(input: ScheduleInput): DosePlan | null
export function classifyWindow(plannedAt: number, actualAt: number, windowDays: number): WindowStatus
export function totalPlannedDoses(phases: RegimenPhase[]): number  // 有限方案返回有限数，无限维持阶段返回 Infinity
```

规则：
- 首针无实际记录时，计划时间 = `regimen.createdAt`。
- `anchor: 'actual'`：第 n 针计划 = 上一针实际时间 + 当前阶段 intervalDays。
- `anchor: 'planned'`：第 n 针计划 = 上一针计划 + intervalDays（不因迟到顺延）。
- 阶段推进：按顺序消耗 `repeatCount` 次，再进入下一阶段；`repeatCount: 0` 表示无限重复（维持阶段）。
- 状态：有实际记录 → `done`；无记录且 `plannedAt < now - 1天` → `overdue`；`|plannedAt - now| <= 1天` → `due`；否则 `upcoming`。
- 返回计划覆盖"历史全部 + 未来 2 针"，避免无限 schedule 爆掉。

```ts
// src/domain/rotation.ts
export const SITE_LABELS: Record<InjectionSite, string>
export const ALL_SITES: InjectionSite[]
export function siteUsage(injections: Injection[]): Record<InjectionSite, number>
export function recommendSite(injections: Injection[], opts?: { preferAbdomen?: boolean }): InjectionSite
```
规则：排除最近 2 次用过；优先历史使用次数最少；同分优先与最近一次不同侧；`preferAbdomen` 默认 true。

```ts
// src/domain/adherence.ts
export interface AdherenceStats {
  total: number; onTime: number; early: number; late: number
  avgDeviationDays: number; currentStreak: number
}
export function computeAdherence(injections: Injection[], regimen: Regimen, now: number): AdherenceStats
```

## 通知与导出（C 提供）

```ts
// src/notify/scheduler.ts
export async function ensurePermissions(): Promise<{ granted: boolean; exactAlarm: boolean }>
export async function rescheduleAll(): Promise<{ scheduled: number }>  // 清空后按未来 8 周重排
export async function cancelAll(): Promise<void>
export const NOTIFY_PREP_HINT = '...'

// src/export/csv.ts
export async function exportCsv(): Promise<{ path: string; filename: string }>
// src/export/pdf.ts
export async function exportPdf(opts?: { patientName?: string; rangeDays?: number }): Promise<{ path: string; filename: string }>
// src/export/index.ts 汇总再导出
```

## UI（D 提供）

```ts
// src/store/app.ts  (zustand)
export function useAppStore(): {
  ready: boolean
  regimen: Regimen | null
  injections: Injection[]
  symptoms: SymptomLog[]
  reminder: ReminderRule | null
  settings: AppSettings
  reload(): Promise<void>
  addInjection(input: ...): Promise<void>   // 写完自动 rescheduleAll()
  ...
}
```

## 错误处理

所有 repo/domain 函数遇到非法输入**抛错**，错误信息用中文，UI 层负责 catch 并 toast。
不要静默吞异常。

---

# 补充 v2：疾病目录与给药途径

已由主代理实现，**只读，不要修改**。B/C/D 直接 import。

## 类型（已在 src/types.ts）

```ts
export type MedicationRoute = 'sc' | 'iv'   // 皮下 / 静脉输注
export type DiseaseGroup = 'ibd' | 'skin' | 'joint' | 'other'

export interface Disease {
  id: string; name: string; aliases: string[]; group: DiseaseGroup; summary: string
}

export interface RegimenPhaseTemplate {
  kind: PhaseKind; intervalDays: number; repeatCount: number
  dose: number | null; unit: string
}
export interface RegimenTemplate {
  name: string; anchor: RegimenAnchor; windowDays: number; phases: RegimenPhaseTemplate[]
}
export interface CatalogDrug {
  key: string; name: string; genericName: string; brandNames: string[]
  route: MedicationRoute; defaultDose: number | null; unit: string
  color: string; note?: string
}
export interface DiseaseDrug {
  diseaseId: string; drugKey: string; firstLine: boolean
  doseNote?: string; regimen: RegimenTemplate
}
```

`Medication` 已扩展：`route: 'sc' | 'iv'`、`diseaseIds: string[]`、`catalogKey: string | null`。

## 只读模块

```ts
// src/data/diseases.ts
export const DISEASES: Disease[]
export const DISEASE_GROUPS: Array<{ id: DiseaseGroup; name: string }>
export const DISEASE_DISCLAIMER: string
export function findDisease(id: string | null | undefined): Disease | undefined
export function diseasesByGroup(group: DiseaseGroup): Disease[]

// src/data/catalog.ts
export const CATALOG_DRUGS: CatalogDrug[]
export const DISEASE_DRUGS: DiseaseDrug[]
export const DRUGS_BY_KEY: Record<string, CatalogDrug>
export function drugsForDisease(diseaseId: string): Array<{ drug: CatalogDrug; entry: DiseaseDrug }>
export function diseaseIdsForDrug(drugKey: string): string[]
export function regimenFor(diseaseId: string, drugKey: string): DiseaseDrug | undefined
```

## repo 新增

```ts
medications.listForDisease(diseaseId: string): Promise<Medication[]>
```

## 约定

- `settings` 固定 key：`disease_id`、`patient_name`、`onboarded_at`、`app_lock`、`theme_mode`、`dnd_start`、`dnd_end`；内部标记位 `symptom_tags_seeded` 只用于症状标签的首次播种，UI 不读取。
- **`route === 'iv'` 时不要展示"注射部位"选择器**（部位轮换只对皮下有意义），但 `Injection.site` 必须写合法值，统一写 `'abdomen_ul'`。
- 涉及"按体重计算剂量"的文案必须带"以医生处方为准"。
- 面向用户的文案里不要出现"推荐用药""建议换药"这类表述。

---

# 补充 v3：疼痛评分与可维护的症状标签

`SCHEMA_VERSION = 3`，`src/db/schema.ts` 导出 `MIGRATION_3_SQL`。

## symptom_log.pain_score

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `pain_score` | `REAL`，可空 | 临床疼痛评分，采用 NRS（数字评分法），取值 0–10 |

- NRS 0–10：`0` 表示无痛，`1–3` 轻度疼痛，`4–6` 中度疼痛，`7–10` 重度疼痛。
- 未填写时存 `NULL`，与"评分为 0（确实无痛）"区分开。
- 与 `severity`（1–5 的整体不适程度）是**两个独立维度**，不要互相换算或覆盖。

## symptom_tag

```sql
CREATE TABLE symptom_tag (
  id         TEXT    PRIMARY KEY NOT NULL,
  name       TEXT    NOT NULL UNIQUE,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_symptom_tag_order ON symptom_tag (sort_order, created_at);
```

| 列 | 说明 |
| --- | --- |
| `id` | `crypto.randomUUID()` |
| `name` | 标签文字，全表唯一，也是展示内容 |
| `is_builtin` | 是否为内置标签（首次启动播种的那批） |
| `sort_order` | 展示顺序，越小越靠前；索引 `idx_symptom_tag_order` 按 `(sort_order, created_at)` 排序 |
| `created_at` | UTC 毫秒 |

用途与约定：

- 标签是**用户可增删**的配置：内置项在首次启动时由 `seedBuiltinSymptomTags` 写入，并用 `app_setting.symptom_tags_seeded` 标记已播种，用户删掉的标签不会被下次启动加回来。
- **`symptom_log.tags` 保存的是标签文字数组（JSON 文本）的快照**，不是 `symptom_tag.id` 外键。因此删除或重命名标签不会篡改历史记录，历史展示始终用当时记录的文字。
- 新增记录时的候选标签从 `symptom_tag` 按 `sort_order, created_at` 读取。

## 类型（已在 src/types.ts）

```ts
export interface SymptomLog {
  id: string
  loggedAt: number
  severity: 1 | 2 | 3 | 4 | 5
  painScore: number | null   // NRS 0–10，0 表示无痛
  tags: string[]             // 文字快照
  note: string | null
  temperature: number | null
  injectionId: string | null
}

export interface SymptomTag {
  id: string
  name: string
  isBuiltin: boolean
  sortOrder: number
  createdAt: number
}
```

---

# 补充 v5 / v6：治疗组合、口服用药与疗效事件

`SCHEMA_VERSION = 6`。v5 小节**取代 v3 及之前关于 `regimen / regimen_phase / injection` 的约定**：
旧模型已从数据库删除，`src/types.ts` 顶部的 `Regimen`、`RegimenPhase`、`Injection` 等类型只作历史保留，
不再有对应表和仓库 API；v3 的 `symptom_log.pain_score` 与 `symptom_tag` 继续有效。
v6 只新增 `treatment_line.ended_at` 与 `efficacy_event`，已有数据全部保留。

## 设计变化

| v3 / 更早 | v5 |
| --- | --- |
| 一个 `regimen` 只对应一种药 | 一个 `treatment` 是一个治疗组合，可同时有多条注射线和口服线 |
| `injection` 表记录注射 | `dose_log` 统一记录注射与口服打卡 |
| `regimen_phase` | `treatment_phase`，挂在 `treatment_line` 上 |
| `reminder_rule.regimen_id` | `reminder_rule.treatment_id` |
| 药物只有 `route: sc \| iv` | `route: 'sc' \| 'iv' \| 'oral'`，新增 `brand_names`、`extra` |
| `symptom_log.injection_id` | `symptom_log.dose_log_id`（对外类型字段仍叫 `injectionId`） |

## 表结构

### `medication`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | `crypto.randomUUID()` |
| `name` | `TEXT NOT NULL` | 药名 |
| `generic_name` | `TEXT` | 通用名 |
| `brand_names` | `TEXT NOT NULL DEFAULT '[]'` | 商品名 JSON 字符串数组 |
| `default_dose` | `REAL` | 默认剂量 |
| `unit` | `TEXT NOT NULL` | 单位 |
| `color` | `TEXT NOT NULL` | 展示色 |
| `route` | `TEXT NOT NULL DEFAULT 'sc'` | `sc / iv / oral` |
| `disease_ids` | `TEXT NOT NULL DEFAULT '[]'` | 适用病种 JSON 字符串数组 |
| `catalog_key` | `TEXT` | 内置目录标识；部分唯一索引 |
| `is_builtin` | `INTEGER NOT NULL DEFAULT 0` | 是否内置 |
| `extra` | `TEXT NOT NULL DEFAULT '{}'` | 预留扩展字段 JSON 对象，导入/导出原样保留 |
| `created_at` | `INTEGER NOT NULL` | UTC 毫秒 |

索引：`idx_medication_catalog_key` 对非空 `catalog_key` 唯一。

### `treatment`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `name` | `TEXT NOT NULL` | 组合名称，例如「阿达木单抗 + 甲氨蝶呤」 |
| `is_active` | `INTEGER NOT NULL DEFAULT 0` | 仓库层保证同一时间只有一个激活方案 |
| `created_at` | `INTEGER NOT NULL` | |

### `treatment_line`

每种药一条。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `treatment_id` | `TEXT NOT NULL` | → `treatment(id)`，`ON DELETE CASCADE` |
| `medication_id` | `TEXT NOT NULL` | → `medication(id)`，`ON DELETE CASCADE` |
| `kind` | `TEXT NOT NULL` | `injection` 或 `oral` |
| `label` | `TEXT NOT NULL` | 用药线名称，用于导入消歧 |
| `is_host` | `INTEGER NOT NULL DEFAULT 0` | 主药；排程锚点跟随它的实际注射时间 |
| `sync_with_host` | `INTEGER NOT NULL DEFAULT 0` | 注射线是否跟随主药针日 |
| `anchor` | `TEXT NOT NULL DEFAULT 'actual'` | `actual / planned` |
| `window_days` | `INTEGER NOT NULL DEFAULT 2` | 按时窗口 |
| `ended_at` | `INTEGER` | 停用时间；`NULL` 表示仍在使用。停用后不再生成未来计划，历史保留 |
| `oral_start` | `INTEGER` | 口服：首次服药时间（UTC 毫秒） |
| `oral_duration_days` | `INTEGER` | 口服：疗程天数；`NULL` 表示长期 |
| `oral_frequency` | `TEXT` | 口服：`daily / weekly / custom` |
| `oral_times_per_period` | `INTEGER` | 口服：仅 `weekly` 使用，表示每周次数（1–7） |
| `oral_days_of_week` | `TEXT` | 口服：仅 `custom` 使用，JSON 数组，`0 = 周日 … 6 = 周六` |
| `oral_remind_time` | `TEXT` | 口服：提醒时间 `HH:mm` |

约束：`kind IN ('injection', 'oral')`；`anchor IN ('actual', 'planned')`；
`oral_frequency IS NULL OR oral_frequency IN ('daily', 'weekly', 'custom')`。
索引：`idx_treatment_line_treatment (treatment_id)`。

### `treatment_phase`

仅注射线使用，按 `order_idx` 依次执行。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `line_id` | `TEXT NOT NULL` | → `treatment_line(id)`，`ON DELETE CASCADE` |
| `order_idx` | `INTEGER NOT NULL` | 阶段顺序，同线内唯一 |
| `kind` | `TEXT NOT NULL` | `loading / maintenance` |
| `interval_days` | `INTEGER NOT NULL` | 间隔天数 |
| `repeat_count` | `INTEGER NOT NULL DEFAULT 0` | 重复次数；`0` 表示无限重复 |
| `dose` | `REAL` | 阶段剂量 |
| `unit` | `TEXT NOT NULL` | 单位 |

索引：`idx_treatment_phase_order (line_id, order_idx)`。

### `dose_log`

注射与口服共用，一条计划或一次补录对应一条记录。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `line_id` | `TEXT NOT NULL` | → `treatment_line(id)`，`ON DELETE CASCADE` |
| `scheduled_at` | `INTEGER` | 计划时间；补录可为 `NULL` |
| `taken_at` | `INTEGER` | 实际打卡时间；`status = 'done'` 时必填 |
| `status` | `TEXT NOT NULL` | `done / skipped / missed` |
| `dose` | `REAL` | 剂量 |
| `unit` | `TEXT` | 单位 |
| `site` | `TEXT` | 注射部位；口服为 `NULL` |
| `lot_number` | `TEXT` | 批号 |
| `note` | `TEXT` | 备注 |
| `created_at` | `INTEGER NOT NULL` | |
| `updated_at` | `INTEGER NOT NULL` | |

约束：`status IN ('done', 'skipped', 'missed')`。
索引：`idx_dose_log_line_time (line_id, scheduled_at)`。

### `efficacy_event`（v6）

记录用户主动登记的疗效下降 / 失效 / 不耐受等事件，不对原因或因果作任何推断。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `line_id` | `TEXT NOT NULL` | → `treatment_line(id)`，`ON DELETE CASCADE` |
| `kind` | `TEXT NOT NULL` | `reduced / failed / intolerance / antibody / other` |
| `occurred_at` | `INTEGER NOT NULL` | 事件发生时间（UTC 毫秒） |
| `doses_count` | `INTEGER NOT NULL DEFAULT 0` | 事件发生前该线已完成次数快照 |
| `note` | `TEXT` | 用户备注 |
| `created_at` | `INTEGER NOT NULL` | |

索引：`idx_efficacy_event_line_time (line_id, occurred_at)`。
创建事件时可以选择同时把 `treatment_line.ended_at` 设为事件时间；删除事件不会自动恢复用药线，
需要用户显式「恢复用药线」。

### `reminder_rule`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT PK` | |
| `treatment_id` | `TEXT NOT NULL UNIQUE` | → `treatment(id)`，`ON DELETE CASCADE` |
| `offsets` | `TEXT NOT NULL DEFAULT '[-2,-1,0]'` | 相对计划注射日提前的天数，JSON 数组 |
| `time_of_day` | `TEXT NOT NULL DEFAULT '09:00'` | `HH:mm` |
| `snooze_minutes` | `INTEGER NOT NULL DEFAULT 10` | |
| `enabled` | `INTEGER NOT NULL DEFAULT 1` | |

### `symptom_log` / `symptom_tag`

结构与 v3 相同，仅把关联列从 `injection_id` 改为：

```sql
dose_log_id TEXT REFERENCES dose_log(id) ON DELETE SET NULL
```

`pain_score`、标签快照、`app_setting.symptom_tags_seeded` 的约定不变。

## 类型（`src/types.ts`）

```ts
export type LineKind = 'injection' | 'oral'
export type OralFrequency = 'daily' | 'weekly' | 'custom'
export type DoseStatus = 'done' | 'skipped' | 'missed'

export interface TreatmentPhase {
  id: string; lineId: string; orderIdx: number
  kind: PhaseKind; intervalDays: number; repeatCount: number
  dose: number | null; unit: string
}

export interface OralPlan {
  startDate: number
  durationDays: number | null
  frequency: OralFrequency
  /** 仅 weekly 使用：每周 N 次，均匀分布 */
  timesPerPeriod: number
  /** 仅 custom 使用：固定周几，0 = 周日 … 6 = 周六 */
  daysOfWeek: number[]
  remindTime: string        // 'HH:mm'
}

export interface TreatmentLine {
  id: string; treatmentId: string; medicationId: string
  kind: LineKind; label: string
  isHost: boolean; syncWithHost: boolean
  anchor: RegimenAnchor; windowDays: number
  endedAt: number | null   // 停用时间；null 表示仍在使用
  phases: TreatmentPhase[]  // 仅注射线
  oral: OralPlan | null     // 仅口服线
}

export interface Treatment {
  id: string; name: string; isActive: boolean
  createdAt: number; lines: TreatmentLine[]
}

export interface DoseLog {
  id: string; lineId: string
  scheduledAt: number | null; takenAt: number | null
  status: DoseStatus
  dose: number | null; unit: string
  site: InjectionSite | null; lotNumber: string | null
  note: string | null; createdAt: number; updatedAt: number
}

export interface ReminderRuleV5 {
  id: string; treatmentId: string
  offsets: number[]; timeOfDay: string
  snoozeMinutes: number; enabled: boolean
}

export type EfficacyKind = 'reduced' | 'failed' | 'intolerance' | 'antibody' | 'other'

export interface EfficacyEvent {
  id: string; lineId: string
  kind: EfficacyKind
  occurredAt: number
  dosesCount: number      // 事件发生时已完成的用药次数快照
  note: string | null
  createdAt: number
}
```

## 仓库 API（`src/db/repo.ts`）

旧的 `regimens`、`injections` 已删除；使用：

```ts
export const treatments: {
  list(): Promise<Treatment[]>
  getActive(): Promise<Treatment | null>
  get(id: string): Promise<Treatment | null>
  create(input: TreatmentInput): Promise<Treatment>
  /** 给已有方案补一条用药线；不自己开事务，便于导入复用 */
  addLine(treatmentId: string, input: TreatmentLineInput): Promise<TreatmentLine>
  removeLine(lineId: string): Promise<void>
  setLineEnded(lineId: string, endedAt: number | null): Promise<TreatmentLine>
  setActive(id: string, active: boolean): Promise<void>
  update(id: string, patch: TreatmentPatch): Promise<Treatment>
  remove(id: string): Promise<void>
}

export const doseLogs: {
  list(lineId?: string): Promise<DoseLog[]>
  listBetween(from: number, to: number): Promise<DoseLog[]>
  create(input: DoseLogInput): Promise<DoseLog>
  update(id: string, patch: Partial<Omit<DoseLog, 'id' | 'lineId' | 'createdAt'>>): Promise<DoseLog>
  remove(id: string): Promise<void>
}

export const efficacyEvents: {
  list(lineId?: string): Promise<EfficacyEvent[]>
  create(input: EfficacyEventInput): Promise<EfficacyEvent>
  remove(id: string): Promise<void>
}

export interface EfficacyEventInput {
  lineId: string
  kind: EfficacyKind
  occurredAt: number
  note?: string | null
  stopLine?: boolean      // true 时同时设置 treatment_line.ended_at
}
```

输入类型：

```ts
export interface TreatmentLineInput {
  medicationId: string
  kind: 'injection' | 'oral'
  label: string
  isHost?: boolean          // 默认 false
  syncWithHost?: boolean    // 默认 false
  anchor?: 'actual' | 'planned'
  windowDays?: number       // 默认 2
  phases?: Array<Omit<TreatmentPhase, 'id' | 'lineId'>>  // 注射线必填且至少一个
  oral?: OralPlan | null    // 口服线必填
}

export interface TreatmentInput {
  name: string
  lines: TreatmentLineInput[]
}

export interface DoseLogInput {
  lineId: string
  scheduledAt: number | null
  takenAt: number | null
  status: 'done' | 'skipped' | 'missed'
  dose?: number | null
  unit?: string | null
  site?: InjectionSite | null
  lotNumber?: string | null
  note?: string | null
}
```

约束：

- 一个治疗方案只能有一个 `isHost: true` 的注射线；`addLine` 和 `update` 都会维护这个不变式。
- `create` 和 `addLine` 会拒绝重复添加同一种药；`update` 修改 `medicationId` 时目前没有查重（已知缺口）。
- 口服线不保存 `phases`（传入也会被忽略）；注射线至少要有一个 `phases`。
- `doseLogs.create` 在 `status = 'done'` 时必须提供 `takenAt`。
- `symptom_log.dose_log_id` 可以关联注射或口服打卡；`ON DELETE SET NULL`，删打卡不会连带删症状。

`medications` 仍提供 `list / listForDisease / get / create / update / remove`；
`create` 接收 `brandNames: string[]`、`extra: Record<string, unknown>`，内部转 JSON 文本。
内置药物的名称、通用名、商品名、给药途径来自目录，`update` 只允许改默认剂量等用户字段。

## 迁移：v5 重建、v6 增量

- `user_version = 0`：只执行 `CREATE_TABLES_SQL`。
- `user_version = 1–4`：`DROP_ALL_TABLES_SQL` → `CREATE_TABLES_SQL` → `PRAGMA user_version = 6`。
  **旧表 `regimen / regimen_phase / injection` 已删除**，v1–v4 的旧数据不会迁移，用户已确认开发阶段无需保留。
- `user_version = 5`：执行 `MIGRATION_6_SQL`（`ALTER TABLE treatment_line ADD COLUMN ended_at` +
  `CREATE TABLE efficacy_event`）→ `PRAGMA user_version = 6`，治疗、打卡、症状与设置全部保留。
- 重建后 `seedBuiltinMedications` 与 `seedBuiltinSymptomTags` 会重新播种；症状标签仍靠 `symptom_tags_seeded` 防止重复播种。
- `DELETE_ALL_BUSINESS_DATA_SQL` 清理 v6 业务表（含 `efficacy_event`）；`DROP_ALL_TABLES_SQL` 同时包含新旧表名，用于清库和 v5 重建。

## 导入 v2

- 顶层：`{ format: "bioclock-import", version: 2, medications, injections, oralLogs, symptoms }`；v1 仍接受。
- 注射/口服记录按「`lineLabel` → `medication` → 主药/第一条线」解析用药线。
- 药已存在但当前方案没有对应线时自动建线：注射线用该药导入记录的中位间隔（默认 28 天），
  口服线默认每天一次、09:00、长期；首条注射线自动成为主药。
- 药物按药名 / 通用名 / 商品名 / 内置目录名称互认；命中已有药只补空字段、合并商品名。
- 去重：打卡按「`takenAt` + `lineId`」，症状按「`loggedAt` + `severity` + 排序后的标签」。
- `previewImport` 返回 `injections / oralLogs / symptoms / skipped / skippedNoLine / tags / medicationsCreated / linesCreated`，
  确认框据此提示将新建几条用药线。
- 完整字段见 [`docs/import-format.md`](./import-format.md)。
