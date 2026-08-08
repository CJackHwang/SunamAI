# 变更日志

本文档记录本项目所有显著变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，并遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] — 2026-08-08

2026-08 是本项目历史上最大的一次发布：执行内核重写为 **pi** 框架、容器运行时全面迁移到
**Succinix**、旧 `AgentEngine` 删除、并新增独立**设置页**。工作以 M / P / S / V / UX /
审计任务系列执行（归档于 `.trellis/tasks/archive/2026-08/`）。

### 新增

- **独立设置页**（`SettingsPage`，UX3），三栏目：
  - **供应商（Providers）** — 管理模型供应商（16 个预设，派生自
    `@earendil-works/pi-ai` providers：DeepSeek、OpenAI、Anthropic、OpenRouter、Groq、
    Mistral、xAI、Cerebras……），各自含 base URL、API Key、默认模型与请求 API
    （`openai-completions` / `anthropic-messages`），并有全局对话模型与「拉取模型列表」按钮。
  - **皮套（Personas）** — 可复用的系统提示词，含模型参数（temperature / top-p /
    max tokens）与模型绑定（`auto` 跟随全局模型，或锁定到特定供应商 + 模型）。启用的皮套
    即时出现在聊天模型选择器。
  - **关于（About）** — 项目信息、GitHub 仓库、AGPL-3.0 许可证，以及直接指向 **Succinix**
    项目的链接。
- **pi 引擎成为唯一 Agent 引擎**（P1–P6 + PISWITCH）：pi 框架
  （`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`）现在驱动聊天、工具调用、
  子 agent 与上下文压缩。pi 运行时懒加载，不进入初始 bundle。
- **AgentDriver 抽象**（P6）：UI 通过 `AgentDriver` 接口与引擎通信；内置 **pi 驱动**为
  默认实现，ClaudeCode / Codex CLI 桥为同一接口下的实验实现。
- **pi IndexedDB 会话后端**（P2）：pi 会话持久化到 IndexedDB；刷新后按「最新摘要 + 保留尾
  + 后续消息」重建 Agent 历史。
- **pi 子 agent 编排**（P4）：`spawn_subagent` / `wait_subagents` / `message_subagent` 作为
  独立 pi Agent 实例运行（最多 3 路并发、每 root 6 个、深度 1），子任务预算独立计数。
- **pi 上下文压缩**（P5）：在有效上下文窗口（模型 profile 派生，未知模型保守 32k）达到 90%
  时自动压缩——摘要 + 保留尾写回持久化会话后再继续。
- **Succinix 容器环境**（M1–M7）：Agent 与用户终端现在通过 Succinix TerminalExecutor 文件
  RPC（`/cmd.json` → `/result-<id>.json`，每请求独立结果文件）执行命令——`node|npm|npx`
  走真实 Node.js、`python|pip` 走常驻 Pyodide daemon、其余走 Lifo Unix 用户态，共享同一
  文件系统。
- **跨容器进程隔离**（CISOL）：Succinix 进程表携带 `scope`（`system` / `container` /
  `unknown`）与可选 `containerId`；Sunam 按虚拟容器过滤进程查询、拦截跨容器 kill，并在 UI
  中将受保护的系统进程标记为不可停止。
- **快照双层**（M3）：Succinix 自动把容器文件系统快照到 IndexedDB（`succinix-persist`，
  文本优先、诚实排除），Sunam 在 `sunam-v3` 保留 agent 会话 checkpoint——刷新后文件与对话
  同时恢复。
- **用户终端接入完整 Succinix 界面**（V2TERM）：浏览器内用户终端启动完整的 Succinix 系统
  （自检 + `guest` 提示符 + 可输入命令）。
- **pi 工具调用显示在聊天气泡**（PITOOLUI）：assistant 工具调用与其结果内联渲染在聊天消息
  气泡（toolCall 转换 + 执行事件透传）。
- **UX 打磨**：侧边栏默认半屏、「Sunam 的电脑」默认终端 tab（UX1）；WebContainer 就绪即显示
  终端、受限状态持久化（UX2）。
- **18 个 Agent 工具**（M4 重构）：工作区（`workspace_tree` / `read_file` /
  `search_workspace`）、进程（`run_command` / `manage_process` / `read_user_terminal`）、
  资源（`list_resources` / `read_resource_text` / `read_resource_image` /
  `materialize_resource`）、子 agent（`spawn_subagent` / `wait_subagents` /
  `message_subagent`）与控制（`update_plan` / `report_progress` / `ask_user` /
  `ask_parent` / `complete_task`）。每个工具都携带编译期强制的 `capability` 声明。

### 变更

- **旧引擎删除**（PISWITCH）：`AgentEngine`、`AgentFamilyCoordinator` 与
  `subagentCoordinator` 已删除；pi 是唯一执行内核。历史持久化的 `implement | verify` 记录
  保持可读并显示为 `task`。
- **runShell 替换为 Succinix 文件 RPC**（M1）：Agent 命令不再 spawn `jsh`，改走 Succinix
  TerminalExecutor，带超时透传、统一进程表后台 `spawn`、shell 元字符融合由 Succinix host
  处理。
- **端口与服务对齐 Succinix**（M2）：端口事件来自 Succinix 端口注册表；服务面板精确停止
  managed 端口（绝不从端口反推 PID）。
- **`apply_patch` 删除**（M4）：文件写入改走 `run_command`（heredoc / `sed` / `node fs`），
  更灵活。
- **进程 UI 绑定 Succinix 进程表**（M5）：受保护的系统进程被标记且无法从 UI 停止；用户进程
  照常停止。
- **命名统一为 Succinix**（M7）：面向用户文案中容器环境统一为 **Succinix**（能力库小字注明
  "Container environment"）；WebContainer 仅在技术必要处保留（import、协议细节）。
- **多工作区隔离保留**（M6）：虚拟目录容器语义保留并加 cwd 竞态防护；两个虚拟容器保持互不可见。
- **跨容器进程查询/kill 过滤与拦截**（CISOL）：容器的进程列表只显示自己的进程；跨容器
  `kill` 被拒绝。
- **文档结构重建**（本次发布）：中英双语 README / CHANGELOG / CONTRIBUTING / FEATURES，
  更新架构与 Agent 运行设计文档，过时文档加标注。

### 修复

- **P1–P3 审计修复**：pi 事件 UI 消息恢复、子 agent 如实降级标注、pi 懒加载通道 bundle 门禁
  达标。
- **P4–P6 审计修复**：子 agent 哨兵改名、usage 统计真实化（model turns / tool calls）、驱动
  文档注释。
- **V1 审计 H1 修复**：CRLF 语义、前台进程可见性、CI 容器链门禁。
- **M2 复审修复**：端口事件先到的单测覆盖、orphan 端口回溯窗口。
- **M3–M5 批量审计 M-1 修复**：活 spec 同步到新的 `run_command` / `manage_process` 工具名。
- **终审修复**（FINALFIX）：陈旧注释更新、Succinix host 信号回收竞态防御、逃生门接线、
  供应商 `api` 在预设选择时传播、皮套系统提示词生效。

### 移除

- **`AgentEngine` / `AgentFamilyCoordinator` / `subagentCoordinator`** —— pi 前的 Agent
  执行栈。
- **`apply_patch`** 工具 —— 由 `run_command` 取代。
- **`jsh`** 作为 Agent 命令运行时 —— 由 Succinix TerminalExecutor 取代。
- **面向用户的 "WebContainer" 环境命名** —— 现在为 **Succinix**（M7）。
- **`HeyMean拷貝/` 残留拷贝**与根目录 **`TASK-*.md` / 计划文件** —— 归档到
  `.trellis/tasks/archive/2026-08/` 或删除。
