# SunamAI × Succinix 集成 + pi 重构 完整执行计划（最终版）

> 用户确认项：危险护栏不做、apply_patch 删除、前端 UI 零改动、工具名/描述可改、pi 是开发框架（用 pi 重新实现编排，非照搬）、8 小时指 CC 累计工时
> 流程：每个 Task 走标准循环（编码 CC 实现 → 汇报 → 只读审计 CC → 有缺口打回修复/复审 → 审查 CC 确认 → Hermes 验收 → 提交归档 → 下一个）
> **编码 CC 开发规范（每个 Task 派活时必须明确）**：遵循 SunamAI Trellis 标准开发——读 `.trellis/spec/` 对应叶子规范（见各 Task 的"Trellis 叶子"），完成后跑 `npm run check`（release 级 `check:all`），遵循 .trellis/workflow.md 的任务生命周期（task.py）

---

# 阶段 1：SunamAI × Succinix 无感迁移（M 系列，SunamAI 仓库，主线）

## M1：runShell 底层替换（核心，2h CC）

- **背景**：SunamAI 的 `WebContainerAgentRuntime.runShell()` 用 `wc.spawn('jsh', ['-c', cmd])` 执行 agent 命令。Succinix 提供 TerminalExecutor 文件 RPC（`/cmd.json` → `/result-<id>.json`，host 常驻 node 进程，node|npm|npx→真 Node、python→Pyodide、其余→Lifo）。
- **目标**：SunamAI 终端背后的执行引擎从裸 WebContainer jsh 换成 Succinix TerminalExecutor，**用户可见功能体验不变**。
- **需求**：
  1. 新增 `src/features/runtime/succinixClient.ts`：文件 RPC 客户端（exec/ps/kill/cwd/setCwd），通过 wc.fs 写 `/cmd.json`、轮询读 `/result-<id>.json`（per-request 独立文件）
  2. 改 `WebContainerAgentRuntime.ts`：`runShell` / `spawnUserShell` / `stopProcess` / `sendProcessInput` 底层实现切换到 succinixClient（**`AgentWorkspaceRuntime` 契约不变**）
  3. 改 `serviceRegistry.ts`：spawn 封装对接 Succinix 进程表
  4. 超时透传（SunamAI timeout_ms → host exec timeout）；后台模式 → Succinix spawn 统一进程表
  5. shell 元字符（`&&`/`|`/`>`）由 Succinix host 内置 shell 融合处理，直接传命令字符串
  6. `jsh` 专用命令移除
- **保留项**：`src/shared/contracts/agentRuntime.ts` 的 `AgentWorkspaceRuntime` 接口**一字不改**（架构唯一边界）；前端 UI/组件零改动；不新增依赖
- **Trellis 叶子**：`.trellis/spec/frontend/foundation/architecture-and-boundaries.md`（AgentWorkspaceRuntime 边界）、`.trellis/spec/frontend/agent/process-lifecycle.md`（进程所有权）、`.trellis/spec/frontend/agent/workspace-namespace.md`（路径）
- **门禁**：`npm run check`（release 级 `check:all`）；agent 任务实测：`npm install && npm run build`、`node --version | grep 22`、`python -c "print(6*7)"` 全通；exit code/stdout/stderr/超时语义正确；`npm run check` 通过
- **依赖**：无

## M2：端口/服务对齐（1h）

- **背景**：SunamAI serviceRegistry 监听 WC `server-ready` → 预览 URL；Succinix 有端口注册表（ports/netstat）。
- **需求**：端口事件处理改为读 Succinix 端口注册表；预览 URL 机制一致
- **保留项**：UI 零改动；端口语义（虚拟 preview）不变
- **Trellis 叶子**：`.trellis/spec/frontend/agent/process-lifecycle.md`（端口、服务）
- **门禁**：起服务后 `ports`/`netstat` 显示；预览 URL 可访问；`npm run check` 通过
- **依赖**：M1

## M3：快照双层（1h）

- **背景**：SunamAI snapshotCoordinator（agent checkpoint）+ Succinix 自动文件快照（IndexedDB succinix-persist）。
- **需求**：双层并存——Succinix 管文件系统快照（已自动），SunamAI 保留 agent 会话 checkpoint；保存时机协调避免双写冲突
- **保留项**：agent 会话可恢复性（90% 压缩 checkpoint）不能丢；`.trellis/spec/frontend/agent/persistence-and-snapshots.md`（sunam-v3 存储）遵守
- **Trellis 叶子**：`.trellis/spec/frontend/agent/persistence-and-snapshots.md`、`.trellis/spec/frontend/agent/checkpoint-and-recovery.md`
- **门禁**：刷新后文件 + agent 会话均恢复；`npm run check` 通过
- **依赖**：M1

## M4：工具列表重构 22→15（1.5h）

- **背景**：SunamAI 22 个工具，适配 Succinix 后简化。
- **需求**：
  - `run_command`（原 `shell_run` 改名+改描述：在 Succinix 沙箱执行终端命令，真实 Unix+Node+Python）
  - `manage_process`（合并 `process_list`/`process_observe`/`process_stop`/`process_input` → `action: list|observe|stop|input` 参数，指向 Succinix 进程表）
  - `read_user_terminal` 保留
  - `workspace_tree` / `read_file` / `search_workspace` 保留
  - **`apply_patch` 删除**（用 run_command + heredoc/sed/node fs 替代，文件写入更灵活）
  - 资源 4 / 控制 5 / 子agent 3 共 12 个保留
- **保留项**：工具能力 gate（capability 声明）机制不变；capability-library.md 规范遵守
- **Trellis 叶子**：`.trellis/spec/frontend/agent/capability-library.md`（工具 gate/能力声明/chat-only 降级）、`.trellis/spec/frontend/agent/architecture-and-data-flow.md`
- **门禁**：工具清单 = 15；agent 用 run_command 完成文件写入（替代 apply_patch 的用例）；进程管理走 manage_process 单工具；`npm run check` 通过
- **依赖**：M1

## M5：进程管理界面对接（1h）

- **背景**：SunamAI 进程 UI 显示 agent 进程。
- **需求**：绑定 Succinix 统一进程表（ps/kill）；**Lifo/host/python daemon 等系统进程标记 protected，UI 禁止 stop**
- **保留项**：UI 视觉样式零改动（只改数据源/交互逻辑）；进程所有权语义不变
- **Trellis 叶子**：`.trellis/spec/frontend/agent/process-lifecycle.md`
- **门禁**：UI 显示系统进程但 stop 禁用；用户进程 kill 生效；`npm run check` 通过
- **依赖**：M1

## M6：多工作区隔离保留（1h）

- **背景**：SunamAI 一个 WC 容器拆多个虚拟目录 = 独立"虚拟容器"（隔离）。
- **需求**：保留隔离语义不变；与 Succinix workspace 映射或确认兼容（getContainerRoot / SUNAM_WORKSPACE）
- **保留项**：两个虚拟容器互不可见（原隔离行为）；`.trellis/spec/frontend/agent/workspace-namespace.md` 遵守
- **Trellis 叶子**：`.trellis/spec/frontend/agent/workspace-namespace.md`
- **门禁**：两容器互不可见；`npm run check` 通过
- **依赖**：M1

## M7：命名统一（0.5h）

- **背景**：SunamAI 内 "WebContainer" 描述遍布。
- **需求**：业务文案/工具描述全部改为 **Succinix**（能力库小字注明 "Container environment"）；**前端样式零改动**
- **保留项**：CSS/布局零改动；技术必要处（如 import 路径）保留
- **门禁**：grep "WebContainer" 业务文案 0 匹配（技术必要处列出例外）；`npm run check` 通过
- **依赖**：无

---

# 阶段 2：Succinix 独立开源（S 系列，Succinix 仓库，与 M 系列并行）

## S1：独立仓库整理（1h）

- **背景**：Succinix 代码在本地 WebUnix 目录（git 历史含 WebUnix 阶段）。
- **需求**：独立 GitHub 仓库 `CJackHwang/Succinix`；README 对外口径（OS 定位）；CI/文档全家族核对
- **保留项**：docs/tasks/ 历史归档保留；版本 0.2.0
- **门禁**：独立仓库 CI 全绿；README 无 WebUnix 残留（除历史说明）
- **依赖**：无

## S2：@succinix/engine 发布（1.5h）

- **背景**：src/engine/ 已解耦（TASK21），SDK Form A 设计已定。
- **需求**：npm 发布 `@succinix/engine`（0.1.0）；打包配置（tsup/rollup）；README 集成说明
- **保留项**：协议 v1 不变；版本从 0.1.0 起
- **门禁**：npm 包可 install；SunamAI 侧按此接口集成（M1 对齐）
- **依赖**：S1

---

# 阶段 3：pi 重构核心编排（P 系列，后置，SunamAI 仓库）

> pi = 开发框架底座（@earendil-works/pi-agent-core + pi-ai），用 pi 重新实现 SunamAI 编排（非照搬 CLI）。已调研：agent-core 纯 JS 无 node 内置依赖（浏览器可跑）、compaction/session/工具钩子齐备、SQLite 会话后端可换 IndexedDB。

## P1：pi 嵌入 + 单 Agent 对话（2-3h）

- **需求**：pi-agent-core 嵌入 React 壳；单 Agent 对话跑通（事件流 → 现有 UI）；pi-ai createModels 接现有提供商配置；AgentMessage ↔ SunamAI 消息模型桥接
- **保留项**：UI 零改动；现有提供商配置格式兼容
- **Trellis 叶子**：`.trellis/spec/frontend/agent/model-context-and-messages.md`（模型/消息/token 预算）
- **门禁**：聊天 + 简单工具调用跑通；bundle 限制（初始 JS ≤90 KiB gzip、总 JS ≤350 KiB gzip）；`npm run check` 通过
- **依赖**：M4

## P2：IndexedDB 会话后端（1.5h）

- **需求**：pi session 后端抽象 → IndexedDB 实现（替代 node:sqlite，浏览器持久 checkpoint）
- **保留项**：`.trellis/spec/frontend/agent/persistence-and-snapshots.md`（sunam-v3 存储）遵守
- **门禁**：刷新后会话恢复；`npm run check` 通过
- **依赖**：P1

## P3：工具平移 15 → pi AgentTool（1.5h）

- **需求**：15 工具平移为 pi AgentTool（label/prepareArguments/execute/executionMode）；run_command → Succinix RPC
- **保留项**：工具能力 gate 机制不变
- **Trellis 叶子**：`.trellis/spec/frontend/agent/capability-library.md`
- **门禁**：15 工具全部可被 pi agent 调用；`npm run check` 通过
- **依赖**：P1、M4

## P4：三路并发子 agent 重写（2-3h，最大工作量）

- **需求**：用 pi 多 Agent 实例 + 编排层实现 spawn_subagent/wait_subagents/message_subagent（语义不变）；并发上限 3
- **保留项**：`.trellis/spec/frontend/agent/subagents-and-cancellation.md`（角色/预算/并发/通知/取消）遵守
- **Trellis 叶子**：`.trellis/spec/frontend/agent/subagents-and-cancellation.md`
- **门禁**：并发 3 子任务 + wait + message 全通；`npm run check` 通过
- **依赖**：P3

## P5：压缩 + checkpoint 对齐（1.5h）

- **需求**：SunamAI 90% 压缩语义 → pi compaction（shouldCompact/compact/generateSummary 自定义策略）；与 UI 压缩指示桥接
- **保留项**：压缩后 token 显著下降行为不变
- **Trellis 叶子**：`.trellis/spec/frontend/agent/model-context-and-messages.md`（compaction）
- **门禁**：长对话压缩后 token 显著下降；恢复后继续；`npm run check` 通过
- **依赖**：P2

## P6：主 Agent 可替换层（2h）

- **需求**：AgentDriver 适配器抽象：内置 pi 驱动（默认）+ ClaudeCode/Codex CLI 桥（壳模式）
- **保留项**：默认行为不变（内置 pi 驱动）
- **门禁**：切换驱动配置生效；`npm run check` 通过
- **依赖**：P1

---

# 阶段 4：验收收尾（V 系列）

## V1：全量验收（2h，Hermes 执行）

- 浏览器实测：SunamAI 完整 agent 任务（npm 开发闭环 / python pip / git / 服务端口 / 刷新持久）
- 只读审查 agent 抽检（独立 CC，不写代码）：对照各 TASK 规格核对真实实现
- 工具清单核对：15 个，描述正确
- 前端样式截图对比：零改动确认

## V2：文档更新（1h）

- SunamAI README/FEATURES 同步新架构（Succinix 引擎 + 工具清单 + 架构图）
- Succinix FEATURES 更新（SunamAI 作为首个应用场景）

---

# 执行顺序

```
SunamAI 线（串行防冲突）：M1 → M2 → M3 → M4 → M5 → M6 → M7 →（P1 → P2 → P3 → P4 → P5 → P6）
Succinix 线（并行不同仓库）：S1 → S2
穿插：V1 验收（每完成 2-3 个 M 后抽查）
最后：V2 文档收尾
```

# 风险与对策

| 风险 | 对策 |
|---|---|
| jsh 语义与 Lifo 命令集差异 | M1 后 agent 任务回归；差异项列入 FEATURES 边界 |
| 文件 RPC 并发写冲突 | Succinix RPC 已 per-request 独立文件（result-<id>.json），沿用 |
| 快照双写性能 | M3 协调 flush 时机；压力测试 |
| pi 浏览器打包坑 | P1 最小跑通后全量；保留自研引擎回退开关 |
| agent 静默卡死 | 定时监督 cron（见监督机制）；卡死诊断：CPU 0% + 文件 mtime 15min 无变化 |
