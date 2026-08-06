# TASK-M5 — 进程管理界面绑定 Succinix 进程表（系统进程 protected）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**：只改数据源/交互逻辑，不碰 CSS/布局/组件结构（ServicesPanel 渲染逻辑保留，进程数据从哪来是本任务核心）。
- 不新增 npm 依赖。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

M1-M4 完成：SunamAI 执行引擎切 Succinix（host.js 常驻），进程都经 Succinix 进程表（`succinixClient.ps()` 返回 `{ pid, cmd, status, startTime, exitCode?, outputTail? }`）。现在 SunamAI 的**进程管理 UI**（ServicesPanel 的"运行中进程"区）需要绑定 Succinix 进程表，并且**系统进程（host.js/Lifo/python daemon 等 Succinix 内置进程）要标记 protected 禁止用户 stop**。

**现状**：ServicesPanel 显示的是 SunamAI 自己的 ProcessRegistry 进程（agent 启动的）。Succinix host 启动的 host.js 本身、lifo-core、python daemon 等"系统进程"不在其中，用户也看不到。

**目标**：进程管理 UI 显示 Succinix 统一进程表（agent 进程 + 系统进程），系统进程标记 protected（UI 禁 stop + 后端拒绝 kill）。

## 需求（逐条、可验收）

### R1. 进程数据源绑定 Succinix 进程表

- 进程列表数据从 `succinixClient.ps()` 读取（host 进程表，真实 pid/cmd/status/startTime/outputTail）
- SunamAI 侧 ProcessRegistry 保留（agent 所有权/session 隔离语义），但**展示层合并两源**：Succinix 进程表（全部真实进程）+ SunamAI 所有权标注（哪些是当前 session/run 的）
- 映射：Succinix pid ↔ SunamAI launchId（M1 已有映射逻辑，确认展示层能关联上 agent 进程的所有权信息）
- 轮询刷新（如 2-3s 一次，或复用现有端口/进程刷新机制）

### R2. 系统进程 protected

- **系统进程识别**：Succinix host 进程表中，cmd 匹配系统资产/内置的进程标记 protected：
  - `node host.js`（TerminalExecutor 守护进程）
  - lifo-core 相关（Lifo 内核，host 内嵌不单独成进程——确认实际 ps 表里长什么样）
  - python daemon（`node python-daemon.js`，Pyodide 常驻）
  - 任何 `/usr/lib/succinix/` 路径启动的进程
- **UI 表现**：protected 进程显示为系统进程（如 `[system]` 标记或禁用 stop 按钮），用户不能 stop
- **后端防御**：`succinixClient.kill(pid)` 调用前，SunamAI 侧过滤 protected pid（拒绝 kill 系统进程，返回说明）——**双保险**（UI 禁用 + 后端拦截）
- 诚实边界：如果某个进程无法可靠判定是否系统进程，标记为可 stop 但不标注 protected（宁少标不误标）

### R3. agent 进程关联显示

- agent 启动的进程（经 run_command background / manage_process）在 UI 上关联到对应 session/run（复用 M1 的映射表）
- stop 按钮对 agent 进程生效（走 succinixClient.kill）

### R4. 死代码/重复清理

- 若旧 ProcessRegistry 展示逻辑与 Succinix ps 表重复，统一到 Succinix 表（ProcessRegistry 保留为所有权元数据，不作为展示主源）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉（进程行的渲染样式/布局；只改数据来源和按钮状态）
3. agent 编排/资源/工具系统
4. 零新依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/process-lifecycle.md`（进程所有权、跨 Run 管理、端口、服务）
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（相关进程测试）+ 必要冒烟
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿
3. protected 判定单测：系统进程（host.js/python daemon）标记 protected，agent 进程可 stop
4. kill 拦截单测：尝试 kill protected pid → 返回拒绝说明，进程不被杀
5. 浏览器冒烟（可选，网络允许时）：ServicesPanel 进程区显示 Succinix 进程（含系统进程 protected）
6. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——WebContainer boot 有网络 flake（stackblitz），单独测试过即可，全量留 V1 终审。

## 约束

- 提交信息：`feat: M5 进程管理界面绑定 Succinix 进程表（系统进程 protected）`
- 一次提交完成；不确定先读 `src/features/runtime/processRegistry.ts`、`src/widgets/workspace/` 相关组件、`succinixClient.ts` 再动手
- 若 ServicesPanel 的进程区是组件内联逻辑，找到组件文件精确改动（不重构组件结构）
