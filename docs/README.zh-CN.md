<p align="center">
  <img src="assets/header-max.png" alt="Sunam — 浏览器原生 AI 编程助手" width="100%" />
</p>

# Sunam

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](../LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](../CONTRIBUTING.md)

> 语言：[English](../README.md) | **简体中文**

**一个浏览器原生的 AI 编程助手：pi Agent 引擎运行在 Succinix 容器环境之上。无需安装、没有后端——你的浏览器标签页就是工作区。**

Sunam 完全运行在 Chromium 浏览器标签页内。它把 **pi** Agent 引擎（[`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) + [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)）与 **Succinix** 容器环境（[`@succinix/engine`](https://www.npmjs.com/package/@succinix/engine)，基于 WebContainer）结合，让 Agent 可以聊天、检查与编辑真实工作区、运行命令、管理进程与服务，并验证自己的结果——全部在客户端完成，使用你自己配置的模型服务。

Sunam 不提供模型服务、账号系统或托管后端。浏览器直接连接你配置的 OpenAI-compatible（或 Anthropic-messages）模型服务。

---

## 核心特性

### pi Agent 引擎

- **唯一引擎就是 pi。** 旧的自研 `AgentEngine` 已删除，[pi 框架](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 是唯一的执行内核。它驱动聊天、工具调用、子 agent 与上下文压缩，并把每个 pi 事件桥接进现有 UI 状态层。
- **18 个 Agent 工具。** 工作区（`workspace_tree` / `read_file` / `search_workspace`）、进程（`run_command` / `manage_process` / `read_user_terminal`）、资源（`list_resources` / `read_resource_text` / `read_resource_image` / `materialize_resource`）、子 agent（`spawn_subagent` / `wait_subagents` / `message_subagent`）与控制（`update_plan` / `report_progress` / `ask_user` / `ask_parent` / `complete_task`）。每个工具都携带编译期强制的能力声明。
- **自动上下文压缩。** 每轮发送前，pi 按模型 profile（未知模型保守 32k）计算有效上下文窗口，在达到可用窗口 90% 时自动压缩：摘要 + 保留尾写回持久化会话，长对话无需用户操作即可继续。
- **子 Agent。** 最多 **3 路并发**子 Run（每 root 6 个、深度 1）。`explore` 子任务只读；`task` 子任务拥有完整但不委派的工具。子任务继承父级 turn/工具/时间预算并独立计数，真实工作区写入通过全局容器 mutation lease 串行。
- **资源附件。** 每条消息最多 8 个资源（文本 2 MiB、图片 10 MiB、其他二进制 20 MiB、单批 50 MiB），按 session SHA-256 去重，Blob 存 IndexedDB，消息账本只保留持久引用。图片会缩放为 ≤1.5 MiB 的模型副本。
- **驱动抽象。** UI 通过 `AgentDriver` 接口与引擎通信。内置 **pi 驱动**为默认实现；ClaudeCode / Codex CLI 桥为同一接口下的实验实现，不作为默认。
- **如实边界。** pi 通道没有旧引擎的「模型拒绝视觉时降级为文本」探测回退：若配置的模型不支持图片，带图请求会如实失败。`ask_user` / `ask_parent` 的阻塞语义在 pi 自治循环中不保留——适配器把问题作为工具结果回传，由模型在回复中向用户提问。

### Succinix 容器环境

- **浏览器内的真实容器。** Succinix 在 WebContainer 里运行 [TerminalExecutor](https://github.com/CJackHwang/Succinix) host：`node` / `npm` / `npx` 运行在**真实 Node.js** 子进程，`python` / `pip` 运行在**常驻 Pyodide** daemon，其余一切（`grep`、`sed`、`tar`、管道、重定向……）运行在 **Lifo** Unix 用户态——全部共享同一文件系统。
- **文件 RPC 命令通道。** Agent 与用户终端都通过 Succinix 文件 RPC（`/cmd.json` → `/result-<id>.json`，每请求独立结果文件）执行命令。超时、退出码、stdout/stderr 与 `runtime` 标签原样透传。
- **跨容器进程隔离。** Succinix 进程表携带 `scope`（`system` / `container` / `unknown`）与可选 `containerId`。Sunam 按虚拟容器过滤进程查询并拦截跨容器 kill；受保护的系统进程无法从 UI 停止。
- **快照双层。** Succinix 自动把容器文件系统快照到 IndexedDB（`succinix-persist`，文本优先、诚实排除），Sunam 在 `sunam-v3` 保留 agent 会话 checkpoint。刷新后工作区文件与会话同时恢复。
- **虚拟端口与服务。** `server-ready` 事件注册预览 URL；服务面板显示 managed 端口并提供精确停止（绝不从端口反推 PID）。

### 独立设置页

- **供应商（Providers）** — 管理模型供应商（16 个预设：DeepSeek、OpenAI、Anthropic、OpenRouter、Groq、Mistral、xAI、Cerebras……），各自含 base URL、API Key、默认模型与请求 API（`openai-completions` 或 `anthropic-messages`），并有全局对话模型与「拉取模型列表」按钮。
- **皮套（Personas）** — 可复用的系统提示词，含模型参数（temperature / top-p / max tokens）与模型绑定：`auto`（跟随全局模型）或锁定到特定供应商 + 模型。启用的皮套即时出现在聊天模型选择器。
- **关于（About）** — 项目信息、GitHub 仓库、AGPL-3.0 许可证，以及直接指向 **Succinix** 项目的链接。

### 产品

- **对话 / 电脑 / 能力库** — 「Sunam 的电脑」把终端、用户 shell、服务与文件合并到单一视图，用胶囊灵动岛分段切换；能力库面板提供模块级与工具级双层开关，控制 AI 可感知的能力。
- **容器三态** — `已开启` / `已关闭` / `启动受限`（boot 失败）。关闭即真正释放（flush 快照 → teardown）；受限时优雅降级到纯聊天。
- **多语言与 PWA** — 中文 / English / 日本語 界面，可安装为 PWA。

## 快速开始

前置条件：**Node.js 22**、npm、现代 **Chromium** 浏览器（Chrome/Edge），以及带 API Key 的 OpenAI-compatible 或 Anthropic-messages 模型服务。

```bash
git clone https://github.com/CJackHwang/SunamAI.git
cd SunamAI
npm ci
npm run dev
```

开发服务器固定为 <http://localhost:7891>，并已带上所需的跨源隔离头（COOP/COEP）。打开后进入 **设置 → 供应商**，添加或选择一个预设并保存 API Key，然后开始对话。

推荐流程：选择会话与容器，描述任务并按需附加资源，在 RunBoard 查看计划、压缩与子任务摘要，在文件 / 终端 / 服务面板核对结果。复杂任务只有当前工作区 revision 通过验证后才会完成。

## 技术栈

| 层 | 选型 |
| --- | --- |
| Agent 引擎 | [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) + [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) |
| 容器环境 | [Succinix](https://github.com/CJackHwang/Succinix) / [`@succinix/engine`](https://www.npmjs.com/package/@succinix/engine) 之上运行 [`@webcontainer/api`](https://www.npmjs.com/package/@webcontainer/api) |
| UI | React 19、xterm.js、react-markdown、lucide-react |
| 语言与构建 | TypeScript（strict）、Vite 8、Vitest、Playwright、Oxlint |
| 持久化 | IndexedDB（`sunam-v3`、`succinix-persist`）+ Local Storage（`sunam_v2_*`） |
| 许可证 | AGPL-3.0 |

## 数据与隐私

Sunam 是纯前端应用，浏览器直接连接你配置的模型服务。

| 数据 | 保存位置 | 注意事项 |
| --- | --- | --- |
| API Key、供应商/皮套配置、语言 | Local Storage（`sunam_v2_*`） | 不要在共享设备上保存个人密钥。 |
| 会话、容器、Run、事件、资源、终端记录、快照 | IndexedDB（`sunam-v3` + `succinix-persist`） | 清理站点数据会删除全部本地数据。 |
| 提示词、选定文件、发给模型的工具结果 | 你配置的模型服务 | Sunam 默认不会上传整个工作区；实际发送内容适用提供商自己的隐私/保留规则。 |

不要把真实密钥提交到仓库。公开部署建议每位用户自行配置密钥，或通过你自行设计鉴权/配额/审计的服务端代理；模型服务必须允许部署域名的 CORS。

## 部署

WebContainer 需要跨源隔离。生产站点必须使用 HTTPS 并返回：

```text
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

仓库中的 `vercel.json` 已包含这些响应头。Vercel 或其他静态托管使用 `npm run build`，发布 `dist/`，Node.js 版本保持 22。上线后至少验证容器创建、文件读写、终端启动与本地服务预览。

## 开发与验证

```bash
npm run dev            # 开发服务器，端口 7891
npm run typecheck      # 严格 TypeScript
npm run lint           # Oxlint
npm run test           # Vitest 单元与组件测试
npm run test:coverage  # 全核心覆盖率
npm run test:e2e       # Playwright 端到端流程
npm run test:visual    # 桌面 / 移动视觉回归
npm run test:runtime   # 真实 Succinix/WebContainer 验收
npm run check:audit    # 生产依赖 high/critical 审计
npm run build          # 类型检查 + 生产构建
npm run check          # typecheck + lint + 架构边界 + 覆盖率 + build + 包体
npm run check:all      # check + e2e + visual + runtime + audit
```

冻结门槛：核心 lines/functions/statements ≥85%、branches ≥80%；初始 JS ≤90 KiB gzip、总 JS ≤350 KiB gzip（pi 懒加载通道 +~95 KiB，见 `scripts/check-bundle.mjs`）、生产 `dist` ≤1.8 MiB。Playwright 视觉差异上限 0.2%。

仓库使用 **Trellis** 工程工作流。根 `AGENTS.md` 是统一的 AI 工程入口，真实项目规范位于 `.trellis/spec/`，任务与研究记录位于 `.trellis/tasks/`，开发者日志位于 `.trellis/workspace/`。完整贡献指南见 [CONTRIBUTING.zh-CN.md](../CONTRIBUTING.zh-CN.md)。

## 文档索引

中文 · English：

- **README** — 本文档：[中文](README.zh-CN.md) · [English](../README.md)
- **FEATURES** — 已实现能力与如实边界：[中文](FEATURES.zh-CN.md) · [English](FEATURES.md)
- **架构与依赖边界** — 模块职责、单向依赖、关键数据流：[架构与依赖边界](architecture.md)
- **Agent 运行设计** — pi 会话、驱动、IndexedDB 持久化、压缩、子 agent：[Agent 运行设计](agent-v2-design.md)
- **能力库扩展模块开发指南** — 开发能力模块 / MCP / 插件：[能力库扩展模块开发指南](extension-development.md)
- **依赖 Advisory 策略** — 生产审计门禁与 PWA/Workbox 例外：[依赖 Advisory 策略](dependency-advisories.md)
- **发布与优化冻结验收** — 旧（pi 前）验收清单：[发布与优化冻结验收](refactor-acceptance.md)
- **CHANGELOG** — 变更历史：[中文](../CHANGELOG.zh-CN.md) · [English](../CHANGELOG.md)
- **CONTRIBUTING** — 贡献指南：[中文](../CONTRIBUTING.zh-CN.md) · [English](../CONTRIBUTING.md)

## Succinix

Sunam 依赖 **[Succinix](https://github.com/CJackHwang/Succinix)** —— 一个浏览器原生 Linux（WebContainer + Lifo + 真实 Node.js），为本项目提供容器环境、终端执行与进程/端口管理。Succinix 是独立开源项目；`@succinix/engine` npm 包是 Sunam 消费的集成面。

## 许可证

[GNU Affero General Public License v3.0](../LICENSE)。通过网络向用户提供修改版本时，应按 AGPL 第 13 节提供取得对应源代码的机会；完整条款以仓库内 `LICENSE` 与 [GNU 官方文本](https://www.gnu.org/licenses/agpl-3.0.html) 为准。
