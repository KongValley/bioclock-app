# BioClock

记录并提醒按时注射生物制剂的个人健康工具。

- React Native + Expo SDK 58 + expo-router + TypeScript
- 数据**纯本地**：expo-sqlite，无账号、无服务器、无网络请求、无埋点
- 主要功能：病种/药物目录（病种可多选合并）、联合用药（注射 + 口服，一个治疗方案多条用药线）、用药方案（含负荷剂量）、注射打卡、口服打卡、下次倒计时、本地通知、部位轮换、症状日志（临床疼痛评分 NRS 0–10、自定义症状标签、记录时间可编辑）、依从性统计、CSV / Excel / JSON / PDF 导出、Excel / JSON 批量导入

## 快速开始

```bash
npm install
npm start          # 扫码用 Expo Go 打开（需与电脑同一局域网）
npm run android    # 连接 Android 真机/模拟器
npm run ios        # 需要 macOS
npm run web        # 浏览器预览（通知能力受限）
```

```bash
npm run typecheck  # tsc --noEmit
npm test           # 排程/口服/轮换/依从性/药物匹配/导入解析单测
npm run import-template  # 重新生成 Excel 导入模板
```

## 目录

```
app/                 路由（expo-router）
  (tabs)/            今天 / 记录 / 趋势 / 设置
  onboarding/        四步引导：病种 → 药物 → 方案 → 提醒
  modal/             注射登记、口服打卡、症状登记
src/
  data/              疾病目录、生物制剂目录与方案模板（只读）
  db/                SQLite 建表、迁移、种子、仓库层（v5：treatment / treatment_line / dose_log）
  domain/            schedule.ts 排程（注射 + 口服）、medication.ts 药名匹配、
                     rotation.ts 部位轮换、adherence.ts 依从性、pain.ts 疼痛分档
  import/            Excel / JSON 解析与落库（v2，兼容 v1）
  notify/            本地通知排程
  export/            CSV / Excel / JSON / PDF 导出
  store/             zustand
  ui/                主题与组件
docs/
  design.md          设计方案
  contract.md        模块接口契约（含 v5）
  import-format.md   导入文件格式（v2）
tools/
  import-editor/     补录数据并导出 JSON / Excel 的网页工具
```

## 医疗声明

本应用是**个人记录与提醒工具**，不是医疗器械软件。

- 不提供诊断、处方、剂量调整或换药建议。
- 目录中的药名、剂量与给药间隔仅用于减少录入成本，**以医生处方和药品说明书为准**。
- 涉及按体重计算的剂量，务必按医生给的数值录入。
- 症状统计仅供自我观察，不构成因果判断。

## 隐私

- 数据仅存于本机数据库，卸载即清除。
- 不申请网络权限；导出文件需你主动分享。
- 建议在设置中开启应用锁（指纹 / 面容）。

## 已知限制

- 应用外提醒依赖系统通知权限；Android 12+ 需要「精确闹钟」权限才能准点触发。
- PDF 导出中文字体使用系统字体，个别定制 ROM 显示可能略有差异。
- 通知滚动预排 8 周，需 App 定期打开一次以继续延长排程。
