# TASK-M2 — SunamAI 服务/端口管理对齐 Succinix 执行模型

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 的接口一字不改**（AgentWorkspaceRuntime 唯一边界）。
- **前端 UI/组件/样式零改动**（widgets/、ServicesPanel 视觉不动；只允许逻辑数据源适配）。
- 不新增 npm 依赖。
- 不删改 agent 编排、快照、资源系统。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

M1 已完成：SunamAI 的 runShell/spawn 底层换为 Succinix TerminalExecutor（文件 RPC + host.js 常驻）。迁移带来一个已知副作用（M1 复审 M-3 指出）：**`NODE_OPTIONS` service-hook 注入已从 spawn 移除**（`serviceRegistry.ts` 不再组装 hook env），导致：
1. `service-events.jsonl`（SunamAI 用 NODE_OPTIONS hook 让服务进程自己写事件文件）**不再产生记录**
2. `serviceRegistry` 的 **managed 端口分类**（把端口关联到 launchId）对 Succinix 启动的服务进程**失效**——端口会落成 orphaned

同时，Succinix 侧的事实（来自 WebUnix docs/PROTOCOL.md §6）：
- **Succinix 不 tunnel 端口**，它中继 WebContainer 的端口生命周期：`server-ready(port,url)` → `onServerReady` 回调给 host 应用
- 即 **WC 的 `server-ready`/`port` 事件对 SunamAI 依然可监听**（host.js 在 WC 内运行，不影响 SunamAI 侧直接 `webcontainer.on('server-ready')`）
- SunamAI 的 `initializeInternal` 里 `this.webcontainer.on('server-ready', ...)` / `on('port', ...)` 监听（serviceRegistry.ts:130-134）**保留是正确且必要的**

**本任务：修复服务/端口管理在 Succinix 执行模型下的失效点，让端口 UI 如实反映 Succinix 启动的服务进程。**

## 需求（逐条、可验收）

### R1. 服务进程端口关联修复

现状：SunamAI 用 NODE_OPTIONS hook（`service-hook.cjs`，M1 已删）让服务进程写 `service-events.jsonl`，`initializeInternal` 的 event watcher 读它把端口归类为 `managed`（关联 launchId）。hook 删除后：
- 服务进程（经 Succinix host spawn）仍会触发 WC 的 `server-ready`（端口事件是 WC 内核级的，与谁 spawn 无关）
- 但 `managedPort()` 的判定依赖 hook 写入的 event 文件 → 失效

修复方向（实现自选，但必须满足门禁）：
- **方案 A（推荐）**：端口关联改为"进程→端口"推断——服务进程 spawn 后（host ps 表有 `cmd`），`server-ready` 到来时按端口与已知服务命令的匹配（如 `tinbase --port 3001`、`node server.js`）归类；或按服务声明的预期端口（`RuntimeServiceRegistry` 已有 `preview-port` 概念）关联
- **方案 B**：恢复轻量 hook——但 Succinix spawn 无法注入 NODE_OPTIONS（host 用自己的 mergedEnv），需在 Succinix host 侧加机制（**超出本任务范围，不推荐**）
- 选择方案 A。**UI 表现**：服务启动后端口显示为 managed（可 stop），非 orphaned

### R2. 死代码清理

M1 已删 `SERVICE_HOOK_SOURCE`，但 `service-events.jsonl` watcher 通道若已无生产者，标注休眠或移除（注释注明"Succinix 执行模型下由 R1 端口关联替代"）。`killPid` 保留（stopPort 的 pid 分支仍可用）。

### R3. stopPort / stopLaunch 对齐

- `stopLaunch(launchId)`：现调 `launch.process.kill()`——Succinix spawn 返回的是 host pid，需改 `succinixClient.kill(pid)`（M1 已把 ProcessStatus 映射到 host pid，确认链路）
- `stopPort(portNumber)`：managed 端口 stop 时 kill 关联进程（host pid）→ `succinixClient.kill(pid)`

### R4. 服务注册表语义保留

`RuntimeServiceRegistry` 的公开 API（getPorts/subscribe/stopPort/spawn/stopLaunch）和 `RuntimePortStatus` 字段（port/url/state/source/containerId/launchId/processId/pid）语义不变。`state: 'managed' | 'orphaned' | 'stopping'` 如实反映。

## 保留项（不许改清单）

1. 两个 contracts 文件全部类型
2. 前端 UI 视觉（ServicesPanel 渲染逻辑、端口列表展示）
3. `webcontainer.on('server-ready')` / `on('port')` 监听（这是正确机制，保留）
4. agent 编排/快照/资源系统
5. 不新增 npm 依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/process-lifecycle.md`（端口、服务、跨 Run 管理）+ `.trellis/spec/frontend/foundation/architecture-and-boundaries.md`
- 完成后跑 `npm run check:all`（release 级：含 test:runtime）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji
- 参考既有实现：`src/features/runtime/serviceRegistry.ts` 全文（spawn/stopPort/stopLaunch/openPort/closePort/managedPort）、`src/shared/contracts/terminal.ts`、M1 的 `succinixClient.ts`

## 质量门禁

1. `npm run check:all` 全绿（typecheck/lint/architecture/coverage/build/bundle/e2e/visual/runtime/audit）
2. 真实浏览器（或 test:runtime）验证：起一个服务（如 `node -e "require('http').createServer(...).listen(3457)"` 经 Succinix spawn）→ 端口出现在运行时开放端口列表且**归类 managed 可 stop**（非 orphaned）
3. stopPort 后服务进程真实终止（host 进程表消失）
4. `webcontainer.smoke.spec.ts` 服务/端口断言（既有测试）全过
5. `git diff --check` 干净

## 约束

- 提交信息：`feat: M2 服务/端口管理对齐 Succinix 执行模型（端口关联推断 + stop 链路）`
- 一次提交完成；不确定先读现有代码再动手
- 若方案 A 的"进程→端口推断"在真实环境有不确定性，**如实标注边界**（如端口无法可靠关联时落 orphaned 并说明），不许硬造 managed

## 复审修复项（2026-08 只读审查 agent 发现，M 级建议，修复后再提交）

审计结论：R1-R4 真实实现、无 H1、边界零越界、单测 295 全绿。2 项 M 级建议修复：

### M1. 核心路径单测缺口（端口事件先到、launch 后注册）

**问题**：生产主序是「端口事件先到、launch 后注册」（代码注释自证 serviceRegistry.ts:563-564），但全部推断单测都是"先 spawn 再 emit"。`reconcileLaunch` 的 identifying→managed 重推路径、`cancelOrphanTimer` 触发均无单元覆盖。

**修复**：补一条单测——先 `emit('server-ready')` → 断言 identifying → 再 `spawn` → 断言 managed 且 timer 已取消。

### M2. 残余 orphan 竞态（孤儿窗口 3s vs spawn RPC 上限 5s）

**问题**：孤儿窗口 3s（ORPHAN_RECONCILIATION_MS）vs 浏览器侧 spawn RPC 上限 5s（succinixClient.ts:46）。冷启动/负载下若 host 确认 >3s，端口已被一次性 timer 翻为 orphaned，而 `reconcileLaunch` 只重推 identifying、孤儿端口永不回溯 → 真 managed 服务被永久误标 orphaned。

**修复**：launch 注册时对 `orphaned` 端口加宽限回溯（如 spawn 返回后短暂窗口内允许 orphaned→managed），或把孤儿窗口扩到 spawn RPC 超时上限（5s+）。注意不破坏"如实落 orphaned"的诚实边界（无声明且多服务时仍 orphaned）。

### L1/L2（可选，尽力修）

- **L1**：`stopPort` 对已在 stopping 的 launch 二次调用直接标 orphaned 返回 false——即使首杀在途且 close 事件将至。改为等待 close 或返回 true（避免瞬态误标）。
- **L2**：推断的"声明命中"分支未排除 `source==='terminal'`（serviceRegistry.ts:514）——终端跑 `node -e "...listen(N)"` 会得 managed(source=terminal)。补排除 + 单测。

修复后重跑 `npm run check:all`（含 test:runtime）。提交信息：`fix: M2 复审修复（端口事件先到的单测覆盖 + orphan 回溯窗口）`
