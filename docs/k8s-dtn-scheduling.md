# Kubernetes 视角下的 DTN 接触调度（教学设计）

> 本文把 Delay/Disruption Tolerant Networking（DTN）的**接触图（Contact Graph）**与 **store-and-forward** 映射到 Kubernetes 资源模型。目标是课堂/自学，**不是**生产级 Bundle Protocol（BP）或 NASA ION。

## 1. 概念映射：DTN → Kubernetes

| DTN 概念 | K8s 类比 | 说明 |
|----------|----------|------|
| DTN 节点（地球站 / 中继 / 火星站） | **Node** 上的 **Pod** / **Deployment**；本仓库用 CRD `DTNNode` 描述逻辑节点 | 每个节点跑 agent（本仓库 NestJS 仿真或 stub 容器） |
| Bundle 保管存储 | **PVC** 或 **emptyDir**（本演示用 emptyDir） | 链路中断时 Bundle 落本地「保管库」 |
| 接触（Contact）窗口 | **NetworkPolicy** 临时放行 + 可选 **Service** 端点；CRD `DTNContact` 描述窗口起止、时延、带宽 | 窗口外默认拒绝跨节点流量（深空「看不见」） |
| 接触图日程 | **CronJob** 或 **Custom Controller** 按计划 open/close | 对应 Contact Graph Routing（CGR）的时间表输入 |
| 窗口打开时的突发传输 | **Job**（transfer burst / forward worker） | 接触打开 → 触发转发工人排空本地 store |
| 路由表 / CGR 决策 | Controller + 静态 `nextHop`（本演示）或更复杂的图算法 | 教育版用静态下一跳；真实系统用 CGR |

## 1.1 节点角色（endpoint / relay / hybrid）

本演示在 `DTNNode.spec.role` 与接触计划 `nodes[].role` 中区分三类职责（省略则默认 `hybrid`）：

- **endpoint**：应用端点——可 CREATE / DELIVER；不为他人转发（非本端 Bundle 记 REJECT）。
- **relay**：纯中继——禁止应用注入；必须 STORE + FORWARD；Deployment 标签 `dtn.demo.space/role=relay`。
- **hybrid**：端点 + 中继能力合一，便于扩展拓扑。

课堂拓扑：**Earth / Mars → endpoint**，**Relay → relay**。控制器可按角色决定是否挂载应用 sidecar 或只跑 forward-worker。

## 2. 为什么 DTN 需要「日程感知」路由，而不是常开 ClusterIP？

在集群内，**ClusterIP Service** 假设后端大致**始终可达**（偶发失败靠重试/负载均衡）。深空/间歇链路则不同：

1. **物理可见窗口**：地球—中继、中继—火星只在特定时间有射频/光链路。
2. **巨大传播时延**：RTT 可达分钟到几十分钟；「等 ACK 再发下一段」的 TCP 心智不适用。
3. **端到端路径可能永不同时存在**：经典场景是 Earth↔Relay 先通，中断后再通 Relay↔Mars；**没有任何时刻**存在 Earth→Mars 的完整实时路径。
4. 因此必须 **先存储、后转发（store-and-forward）**，并按 **接触图** 决定「现在该不该发给谁」（Contact Graph Routing），而不是假设 ClusterIP 式的 always-on 连通。

本仓库仿真中：`contactOpen(local, nextHop)` 为假时**不转发**，Bundle 留在节点 store——这就是日程感知的最小模型。

## 3. 控制器协调回路（Reconcile Loop）草图

```
Watch DTNContact (及关联 DTNNode)
        │
        ▼
  读取 windowStart / windowEnd / delayMs / bandwidthBps
        │
        ▼
  now ∈ [start, end) ?
     ├─ 是 → status.linkState = Open
     │         ├─ 确保 NetworkPolicy 允许 endpointA ↔ endpointB
     │         ├─ 可选：创建/复用 Service 或临时 Endpoint
     │         └─ 触发 Job：forward-worker（对 A、B 上 store 做突发转发）
     │
     └─ 否 → status.linkState = Closed
               ├─ 删除/收紧 NetworkPolicy
               └─ 不启动新的 forward Job；节点继续保管 Bundle
```

伪代码：

```typescript
async function reconcile(contact: DTNContact) {
  const open = nowIsWithin(contact.spec.windowStart, contact.spec.windowEnd);
  if (open && contact.status?.linkState !== 'Open') {
    await applyAllowNetworkPolicy(contact.spec.endpointA, contact.spec.endpointB);
    await setStatus(contact, { linkState: 'Open' });
    await ensureForwardJob(contact); // transfer burst
  }
  if (!open && contact.status?.linkState !== 'Closed') {
    await revokeNetworkPolicy(contact);
    await setStatus(contact, { linkState: 'Closed' });
  }
}
```

`k8s/contact-controller.yaml` 中的 Deployment / CronJob 是该回路的**文档化 stub**，可用 `kubectl apply --dry-run=client -f k8s/` 校验清单，无需真实集群。

## 4. 与本仓库代码的对应关系

| 组件 | 路径 | 角色 |
|------|------|------|
| 共享仿真核心 | `packages/dtn-core` | TypeScript：Node / Contact / Simulator |
| NestJS API | `apps/api` | `GET /api/plan`、`POST /api/simulate` 等 |
| Next.js UI | `apps/web` | 接触窗口时间线 + 事件日志可视化 |
| 接触计划 | `k8s/contact-plan.json` + ConfigMap | 与演示虚拟时间 `[0,800)` / `[2000,3500)` 一致 |
| CRD / 部署 | `k8s/*.yaml` | DTNNode、DTNContact、节点 Deployment、控制器 stub |

## 5. 模拟 vs 真实

| 本演示（模拟） | 更接近真实 |
|----------------|------------|
| 内存 / 进程内事件队列 | 持久 Bundle 库、CLA（LTP/TCP…） |
| 静态 nextHop | 完整 CGR / sabr 等 |
| emptyDir + NetworkPolicy 示意 | 天线调度、频谱、真实时延 |
| Nest 单进程跑完三节点 | 多节点分布式 agent |
| CronJob 注释式墙钟映射 | 轨道预报驱动的接触计划 |

## 6. 建议阅读顺序

1. 本地：`npm run demo`（核心 CLI）→ `npm run api` + `npm run web`（可视化）
2. 清单：`kubectl apply --dry-run=client -k k8s/`（若已安装 kubectl）
3. 对照本文映射表理解「为何不能当成 ClusterIP」
