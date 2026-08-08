# 参与 Sunam 开发

感谢你对本项目的兴趣。Sunam 是一个浏览器原生的 AI 编程助手，构建于 **pi** Agent 引擎与
**Succinix** 容器环境之上。请先阅读 [AGENTS.md](AGENTS.md)——它是本仓库统一的 AI 工程入口，
真实项目规范位于 `.trellis/spec/`。

## 开发环境

前置条件：**Node.js 22**（CI 版本）、npm，以及现代 **Chromium** 浏览器（Chrome/Edge）——
任何涉及容器或 UI 的工作都需要。

```bash
npm ci               # 按 lockfile 安装精确依赖
npm run dev          # 开发服务器，http://localhost:7891
```

开发服务器已预配置 WebContainer 所需的 `Cross-Origin-Opener-Policy` /
`Cross-Origin-Embedder-Policy` 响应头。**不要改端口或移除这些头。** `npm run dev` 还会同步
Succinix host 运行时资产（`predev` → `scripts/sync-succinix-assets.mjs`），并在端口 7891
被占用时释放它。

打开 <http://localhost:7891>，在 **设置 → 供应商** 配置一个模型供应商，即可开始对话。

## 项目结构

```
src/
  app/                 # 根 Provider、全局样式、启动
  pages/               # 页面入口（MainPage、SettingsPage、ConfiguredPage）
  features/
    agent-core/        # pi 引擎、工具、事件、驱动、压缩、子 agent、能力库
    settings/          # 设置状态 + 面板（供应商 / 皮套 / 关于）
    runtime/           # Succinix 容器运行时、文件 RPC 客户端、快照、进程注册表
    terminal-session/  # 终端标签、服务面板、Agent 终端
    chat/              # 聊天 UI、流式、自动滚动、动效
    file-manager/      # 文件管理器、导出
  entities/            # 领域类型 + v3 持久化（IndexedDB）
  shared/              # contracts、i18n、配置 store、浏览器工具、UI
  widgets/             # 跨功能组合（workspace、sidebar、capability、settings）
tests/
  unit/                # Vitest 单元与组件测试
  e2e/                 # Playwright 端到端流程
  visual/              # Playwright 视觉回归
  runtime/             # 真实 Succinix/WebContainer 验收
scripts/               # 同步、架构/包体/门禁脚本
.trellis/              # Trellis 工作流（spec / tasks / workspace）
```

## 设计与代码规范

- **TypeScript strict 必须**，开启 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、
  `noImplicitReturns`。运行 `npm run typecheck`（0 错误）。
- **Trellis 工作流**：项目由 Trellis 管理。在某个层写代码**之前**，先读 `.trellis/workflow.md`
  与 `.trellis/spec/` 下对应 spec 叶子。遵循任务生命周期
  （`python3 .trellis/scripts/task.py …`），不要绕过。`AGENTS.md` 是入口；不要在 `.agents/`
  下建第二份 `AGENTS.md`。
- **架构边界**：`shared → entities → features → widgets → pages → app`。feature 之间只通过
  公共入口或 `shared/contracts` 交互；禁止引用其他 feature 的内部类型。
  `scripts/check-architecture.mjs` 在 `npm run check` 内强制此边界。
- **`AgentWorkspaceRuntime` 是 Agent core 与容器的唯一边界**。Agent 不得直接访问 Succinix
  运行时；进程所有权是 `(sessionId, runId, containerId)`。
- **每个 Agent 工具必须通过 `defineTool` 携带 `capability` 声明**（module / defaultEnabled /
  warnOnDisable / dependencies）——缺声明即编译失败。新工具先定义 schema、权限、并发、超时、
  结果与持久化边界。
- **UI 文案统一英文**（面向用户文本），应用通过 `shared/i18n` 本地化（中文 / English /
  日本語）。每个新字符串都要加 locale key。
- **UI 中不使用 emoji**（界面文本、输出、渲染到终端的注释）。
- **暗色、克制的主题** —— 遵循现有设计 token（动效、圆角、颜色）与「专业而非玩具感」的
  生产质感。没有 spec 不得新增运行时依赖。
- **注释**：开发者注释可用中文；标识符一律英文。

## 测试

提 PR 前至少运行 `npm run check`；完整门禁是 `npm run check:all`。

| 命令 | 覆盖 |
| --- | --- |
| `npm run typecheck` | 严格 TypeScript（0 错误） |
| `npm run lint` | Oxlint（0 错误） |
| `npm run test` | Vitest 单元与组件测试 |
| `npm run test:coverage` | 全核心覆盖率门禁（statements/functions/lines ≥85%、branches ≥80%） |
| `npm run check:architecture` | 架构 + 能力注册审计 |
| `npm run build` + `npm run check:bundle` | 生产构建 + 初始/总 JS 与 `dist` 包体门禁 |
| `npm run test:e2e` | Playwright 端到端流程 |
| `npm run test:visual` | 桌面 / 移动视觉回归（差异 ≤ 0.2%） |
| `npm run test:runtime` | 真实 Succinix/WebContainer 验收 |
| `npm run check:audit` | 生产依赖 high/critical = 0 |

- **节选**：当改动很小（纯逻辑模块、单个工具）时，本地跑相关 Vitest 文件或聚焦的 Playwright
  spec 是合理的节选——但 PR 仍必须说明最终状态下已运行 `npm run check`（UI/容器改动跑
  `check:all`）。
- **新视觉基线**：用匹配版本 Chromium 重生成基线、人工检查，再跑一次不带 `--update` 的验证。
- **运行时 / 网络 / 浏览器限制**：某个检查无法执行（无 Chromium、无端口权限、`check:audit`
  无网络）时，在 PR 描述中记为**未执行 / 外部阻塞**——绝不能标记为通过。
- **冻结门槛**：核心覆盖率与包体是硬性门槛；pi 懒加载通道不计入初始 JS，但仍计入总 JS gzip。

## 提 PR 流程

本项目遵循 Trellis 任务生命周期。标准流程是：

1. **TASK 规格** — 任务描述改动内容、涉及的 Trellis spec 叶子、物理边界（哪些不能动）与
   验收门禁。小修复可引用既有任务。
2. **实现** — 带测试实现，保持提交聚焦且原子，使用
   [Conventional Commits](https://www.conventionalcommits.org/)：
   `feat: …`、`fix(agent): …`、`docs: …`、`refactor(tests): …`、`chore: …`。
3. **审计** — 独立只读审查（独立 agent 或维护者）对照任务规格核对实现。处理发现的问题并在
   最终状态重跑门禁。大改动不得跳过审计。
4. **验收** — 门禁通过（`npm run check`，UI/容器改动加 `check:all`）、审计干净，任务归档到
   `.trellis/tasks/archive/`。

PR 实际操作：

```bash
git checkout -b feat/your-change
# 实现 + 测试
npm run check
git push -u origin feat/your-change
# 开 PR 说明改动、意义与验证方式
```

保持 diff 可审——大改动拆成多个 PR。维护者会审查；根据反馈修改并重跑门禁。

## 文档与兼容性

- 架构、持久化、公共行为、验证门禁或依赖策略发生变化时，同步更新 `README.md` / `docs/`
  中所有受影响 Markdown（有中英双语文件的要同步双语），以及受影响的 `.trellis/spec/` 叶子。
- 贡献者须确保提交可按 **AGPL-3.0-only** 发布，并保留第三方组件的版权与许可证声明。
- 没有 spec 叶子不得新增运行时依赖；依赖更新按
  [依赖 advisory 策略](docs/dependency-advisories.md) 单独评估。

## 问题

Bug 与功能请求请开 issue。设计问题请参考 [AGENTS.md](AGENTS.md)、
[架构与依赖边界](docs/architecture.md) 与 [Agent 运行设计](docs/agent-v2-design.md) 文档，
以及 [README](README.md)。
