# AGENTS.md — 萤火（Yinghuo）约束

本仓库是 **DTN 萤火束递网**（*DTN Yinghuo Bundle Delivery Fabric*）的教学实现。

| | |
|--|--|
| 中文名 | 萤火 |
| 正式中文 | DTN 萤火束递网 |
| 正式英文 | DTN Yinghuo Bundle Delivery Fabric |
| 项目代号 | Yinghuo（目录 `yinghuo/`、npm `@yinghuo/*`） |
| 控制台 | 萤火控制台 / Yinghuo Console |
| 口号 | 暗空萤火，束递相连 / LightLink in Dark Space |

**不要**把正式英文品牌写成单独的 *Firefly*（易与 Firefly Aerospace 混淆；Firefly 仅作「萤火」直译释义）。

本目录及后续相关工作须遵守：

## 语言与栈

- **编程语言**：TypeScript（禁止以纯 JavaScript 作为主要源码；编译产物除外）
- **前端**：Next.js（App Router 优先）；内置 **萤火控制台**（Yinghuo Console）
- **后端**：NestJS relay daemon
- **基础设施清单**：Kubernetes YAML（调度／接触窗口／节点部署示意）

## DTN 演示范围

- 教育向 Delay/Disruption Tolerant Networking（存储–转发、接触计划、束递）
- 不要求完整 Bundle Protocol / ION 兼容，但概念命名尽量对齐
- 本地可跑通；K8s 可为清单 + 设计说明，不强制真实集群

## 协作要求

- 新增功能先落在 TypeScript + Nest／Next 结构内
- 对外用 **萤火 / Yinghuo**；口号可用 *LightLink in Dark Space*
- 保持 README／设计文档为中文说明 + 英文标识符
- 改动后保证有可执行的 demo／测试入口
