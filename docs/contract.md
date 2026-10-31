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
