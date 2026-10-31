# BioClock

记录生物制剂注射时间、推算下次注射日、按时提醒的个人健康工具。

- **纯本地**：数据存放在设备 SQLite，无账号、无服务器、无网络请求。
- **不给医学建议**：方案与剂量完全由用户按医嘱录入，App 只做算术与提醒。
- 技术栈：Expo SDK 58 + expo-router + expo-sqlite + Zustand + TypeScript。

> 本应用仅用于个人记录与提醒，不提供诊断、治疗或用药建议。详见应用内免责声明。

## 开发

```bash
npm install
npm start          # Expo 开发服务器
npm run typecheck  # tsc --noEmit
npm test           # Vitest（src/domain 下的纯函数测试）
```

## 目录

```
app/                 expo-router 页面（今天 / 记录 / 趋势 / 设置）
src/types.ts         契约类型定义
src/db/              手写 SQL schema、迁移、seed、repository
src/domain/          排程 / 部位轮换 / 依从性纯函数（待实现）
src/notify/          本地通知排程（待实现）
src/export/          CSV / PDF 导出（待实现）
src/ui/              主题
src/i18n/zh.ts       简体中文文案
docs/                设计文档与实现契约
```

实现约定见 `docs/contract.md`。
