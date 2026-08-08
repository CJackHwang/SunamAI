# Sunam — 支持的功能与能力

> **Sunam 当前支持能力的权威清单。** 每一项都已实现并验证——此处绝无愿景或臆测。
> **来源（Source）** 列标注实现它的 TASK 系列（详见 CHANGELOG）或记录它的权威文档。
> 英文版：[FEATURES.md](FEATURES.md)

## 1. 系统概览

Sunam 是**浏览器原生的 AI 编程助手**：Chromium 浏览器标签页把 **pi** Agent 引擎
（`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`）与 **Succinix** 容器环境
（`@succinix/engine`，基于 WebContainer）结合。无需安装、无后端、不托管模型——浏览器直接连接
你配置的模型服务。

| 项 | 值 | 来源 |
| ---- | ----- | ------ |
| 产品 | Sunam（SunamAI） | README |
| Agent 引擎 | pi（唯一引擎；旧 `AgentEngine` 已删除） | P1–P6、PISWITCH |
| 容器 | Succinix TerminalExecutor（WebContainer + Lifo + 真实 Node.js） | M1、README |
| 请求 API | `openai-completions` / `anthropic-messages` | P1、R4 |
| 设置 | 独立设置页：供应商 / 皮套 / 关于 | UX3 |
| 许可 | **AGPL-3.0** © CJackHwang | README、LICENSE |
| 浏览器 | 仅 Chromium 系（Chrome/Edge）+ COOP/COEP 跨源隔离 | README |

## 2. Agent 引擎（pi）

| 能力 | 说明 | 来源 |
| ---------- | ------ | ------ |
| **pi 是唯一引擎** | 聊天、工具、子 agent 与压缩全部运行在 pi 上；运行时懒加载（不进初始 bundle） | P1、PISWITCH、PITOOLUI |
| **驱动抽象** | `AgentDriver` 接口；默认 `PiDriver`，ClaudeCode / Codex CLI 桥为实验实现 | P6 |
| **18 个 Agent 工具** | 工作区（`workspace_tree` / `read_file` / `search_workspace`）、进程（`run_command` / `manage_process` / `read_user_terminal`）、资源（`list_resources` / `read_resource_text` / `read_resource_image` / `materialize_resource`）、子 agent（`spawn_subagent` / `wait_subagents` / `message_subagent`）、控制（`update_plan` / `report_progress` / `ask_user` / `ask_parent` / `complete_task`） | M4、P3 |
| **事件桥接** | pi 事件 → `AgentEvent` 流（流式 delta、工具调用、子 agent 透传），尽力而为写 v3 | P1、R1、PITOOLUI |
| **自动上下文压缩** | 有效窗口 90% 触发压缩；摘要 + 保留尾持久化；刷新后按最新摘要 + 尾重建 | P5 |
| **子 Agent** | 最多 3 路并发（每 root 6 个、深度 1）；`explore` 只读 / `task` 完整非委派；预算独立计数 | P4 |
| **附件** | 每条 8 个（2/10/20 MiB、单批 50 MiB），SHA-256 去重，图片模型副本 ≤1.5 MiB，pi 多模态 user 消息 | R1 |
| **能力声明** | 每个工具携带编译期强制的 `capability` 声明；面板开关 + allow-set 一律读注册表 | M4、capability |
| **用户终端** | 浏览器内完整 Succinix 系统界面（自检 + `guest` 提示符 + 可输入命令） | V2TERM |

## 3. 容器环境（Succinix）

| 能力 | 说明 | 来源 |
| ---------- | ------ | ------ |
| **文件 RPC 执行** | Agent 与用户终端通过 Succinix 文件 RPC（`/cmd.json` → `/result-<id>.json`，每请求独立结果文件）执行命令 | M1 |
| **真实运行时** | `node|npm|npx` → 真实 Node.js；`python|pip` → 常驻 Pyodide daemon；其余 → Lifo Unix 用户态；共享同一文件系统 | M1、Succinix |
| **跨容器进程隔离** | 进程表携带 `scope`（`system`/`container`/`unknown`）+ `containerId`；按容器过滤查询、拦截跨容器 kill、系统进程不可停止 | CISOL |
| **端口与服务** | 端口事件来自 Succinix 端口注册表；managed 端口精确停止；orphaned 端口需确认 + 快照优先全局重启 | M2 |
| **快照双层** | Succinix 文件快照（`succinix-persist`，文本优先）+ Sunam agent checkpoint（`sunam-v3`）；刷新后两者都恢复 | M3 |
| **多工作区隔离** | 虚拟目录容器互不可见；规范 workdir `/home/workspace/<containerId>` | M6 |
| **命名** | 面向用户的容器文案为 **Succinix**；WebContainer 仅在技术必要处保留 | M7 |

## 4. 设置页

| 栏目 | 说明 | 来源 |
| ----- | ------ | ------ |
| **供应商（Providers）** | 16 个预设（派生自 `@earendil-works/pi-ai` providers）；每供应商 base URL / API Key / 默认模型 / 请求 API；全局对话模型 + 「拉取模型列表」 | UX3、R4 |
| **皮套（Personas）** | 可复用系统提示词 + 模型参数（temperature/top-p/max tokens）+ 模型绑定（`auto` 跟随全局模型，或锁定供应商+模型）；即时出现在聊天模型选择器 | UX3、R5 |
| **关于（About）** | 项目信息、GitHub 仓库、AGPL-3.0 许可证、**Succinix 项目链接** | UX3、R6 |

## 5. 产品

- **多语言 UI** — 中文 / English / 日本語，可安装 PWA。
- **对话 / 电脑 / 能力库** — 「Sunam 的电脑」把终端、用户 shell、服务与文件合并到单一视图，
  用胶囊灵动岛分段切换；能力库提供模块级与工具级双层开关，控制 AI 可感知的能力。
- **容器三态** — `已开启` / `已关闭` / `启动受限`（boot 失败）。关闭即真正释放（flush 快照 →
  teardown）；受限时优雅降级到纯聊天。
- **纯聊天降级** — 容器关/受限时 `CapabilityAwareRuntime` 保留聊天与资源工具；shell 不可用时
  completion 门跳过工作区验证。
- **RunBoard** — 计划、压缩状态、子任务树；子任务 transcript 按展开动作按需加载（最近 250
  条事件）。

## 6. 持久化

| 数据 | 存储 | 说明 |
| ---- | ----- | ----- |
| API Key、供应商/皮套配置、语言 | Local Storage（`sunam_v2_*`） | 不要把真实密钥提交到仓库 |
| 会话、Run、事件、资源、终端记录、快照 | IndexedDB `sunam-v3`（9 个 store） | events append-only、每 Run 单覆盖 checkpoint |
| pi 会话历史 | IndexedDB `sunam-pi-sessions`（独立于 v3） | 单标签页单写入者；mutation 日志刷新重放 |
| 容器文件快照 | IndexedDB `succinix-persist`（Succinix） | 文本优先、诚实排除 |

- 刷新把活动父/子 Run 标记为 `interrupted`；恢复创建新 Run 并从「最新摘要 + 保留尾」重建 pi
  会话。
- 删除 session/container 前先取消并等待范围内活动 Run 收尾，再执行单事务；删除后不会有数据
  复活。

## 7. 如实边界

已接受的约束——不是 bug，也绝不模拟：

| 边界 | 说明 | 来源 |
| -------- | ------ | ------ |
| 仅浏览器、无后端 | 模型密钥由用户在每个浏览器内配置；部署必须允许 CORS + COOP/COEP | README |
| pi 无视觉降级回退 | 旧引擎的「模型拒绝视觉时降级为文本」探测未带入 pi 通道；带图附件需要支持图片的模型 | R5、README |
| `ask_user` / `ask_parent` 在 pi 中非阻塞 | 自治循环无法暂停等待 UI 输入；问题作为工具结果回传，模型在回复中提问 | R4、README |
| `apply_patch` 已删除 | 文件写入走 `run_command`（heredoc / `sed` / `node fs`） | M4 |
| 外部 CLI 桥为实验 | ClaudeCode / Codex 驱动在同一 `AgentDriver` 接口之后，但非默认；需要本地环境 | P6 |
| Firefox / Safari / 移动端不支持 | WebContainer 需要 Chromium + 跨源隔离 + SharedArrayBuffer | README |
| pi 压缩无确定性兜底 | LLM 摘要器失败时本轮不压缩继续（不阻断 prompt） | P5、README |
| 资源限制 | 每条 8 个、2/10/20 MiB、单批 50 MiB；图片 ≤2048px、模型副本 ≤1.5 MiB | R1 |
| 快照限制 | 10,000 文件 / 100 MiB 上限；二进制/不可读文件跳过（文本优先） | M3、README |

## 8. 测试

- **单元 / 组件** — Vitest：纯逻辑 + React 组件，mock / fake IndexedDB。覆盖率门禁：
  statements/functions/lines ≥85%、branches ≥80%（核心文件）。
- **E2E** — Playwright 端到端流程（配置门禁、设置、session/container CRUD、附件、压缩、
  checkpoint 恢复、子 agent、transcript 隔离）。
- **视觉** — 桌面 1440×900 / 移动 390×844，差异 ≤0.2%。
- **运行时** — 真实 Succinix/WebContainer 验收：launch/PID/端口登记、进程隔离、规范工作区
  可见性、快照导出排除、父取消级联。
- **门禁** — `npm run check`（typecheck、lint、架构边界、覆盖率、build、包体）与
  `npm run check:all`（+ e2e、visual、runtime、生产依赖审计）。

## 9. 快速开始与文档索引

```bash
npm ci
npm run dev          # http://localhost:7891（COOP/COEP 已预配置）
```

文档家族（中文 · English）：

- **README** — 概览、使用、架构：[中文](README.zh-CN.md) · [English](../README.md)
- **FEATURES** — 本文档：[中文](FEATURES.zh-CN.md) · [English](FEATURES.md)
- **架构与依赖边界** — 模块职责与依赖边界：[architecture.md](architecture.md)
- **Agent 运行设计** — pi 会话 / 驱动 / 持久化 / 压缩 / 子 agent：[agent-v2-design.md](agent-v2-design.md)
- **CHANGELOG** — 变更历史：[中文](../CHANGELOG.zh-CN.md) · [English](../CHANGELOG.md)
- **CONTRIBUTING** — 贡献指南：[中文](../CONTRIBUTING.zh-CN.md) · [English](../CONTRIBUTING.md)
