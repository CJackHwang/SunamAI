<p align="center">
  <img src="docs/assets/header-max.png" alt="Sunam — The useless AI agent" width="100%" />
</p>

# Sunam

Sunam 是运行在浏览器中的开源 AI 编程助手。它通过 OpenAI-compatible Chat Completions API 连接模型，并使用 [WebContainer](https://webcontainers.io/) 在浏览器内提供隔离文件系统、终端、进程和本地服务预览。

项目适合希望自行选择模型服务、在单个浏览器工作区内完成聊天、资源分析、文件编辑、命令执行与分工验证的开发者。Sunam 不提供模型服务、账号系统或托管后端。

## 主要能力

- OpenAI-compatible 模型：配置服务地址、API Key 和模型，可从兼容的 `/models` 接口读取模型列表。
- 浏览器内工作区：WebContainer 提供文件管理、终端、前后台进程、端口服务和可恢复文件快照。
- 自动上下文管理：按模型 token 窗口自动压缩完整消息/工具组，保留计划、证据、资源引用、工作区版本和最近相关文件，不提供需要用户操作的压缩按钮。
- 资源附件：文本、代码、PNG/JPEG/WebP/GIF 和通用二进制作为本地资源保存；文本按范围读取，图片按需送入视觉模型，其他文件可 materialize 到工作区。
- 多模态降级：模型明确拒绝视觉输入时自动改用文本与持久资源引用；与视觉无关的 400/422 错误原样上抛，不进行无效二次调用。
- 子 Agent：根 Agent 可分派 `explore`、`implement`、`verify` 子任务；研究最多三路并发，写入和验证串行，父 Agent 负责综合证据并通过当前工作区版本完成门。
- 子任务记录按需加载：展开 RunBoard 中的子任务时，才读取该子 Run 最近 250 条事件并显示最近 transcript，不占用主聊天首屏。
- 可恢复执行：Run、事件、单一 checkpoint、子任务、终端记录和快照保存在浏览器；刷新后活动父子 Run 标记为 `interrupted`，继续时创建新 Run，不复活旧请求、控制器或 PID。
- 可恢复写入：workspace 保存、session/container 删除和 reset 使用同一串行队列；Run、checkpoint、terminal 和 snapshot 分别串行保存。显式 snapshot flush 会取消尚未触发的 debounce，避免重复快照；失败保留上一份完整版本，已排队的后续快照仍会继续。
- 中文、English、日本語界面，以及可安装 PWA。

## 开始使用

### 前置条件

- Node.js 22（CI 使用版本）
- npm
- 现代 Chromium 浏览器（推荐 Chrome 或 Edge）
- 可用的 OpenAI-compatible 模型服务和 API Key

```bash
git clone https://github.com/CJackHwang/SunamAI.git
cd SunamAI
npm ci
npm run dev
```

开发服务器固定为 <http://localhost:7891>。首次进入应用后填写 API 服务地址、API Key 和模型名称。模型服务至少需要兼容 `/chat/completions`；没有 `/models` 接口时可手动输入模型名。

推荐流程：选择会话和容器，描述任务并按需附加资源，在 RunBoard 查看计划、压缩和子任务摘要，在文件/终端/服务面板核对结果。复杂任务只有在当前工作区版本通过验证后才能完成。Agent 对用户交互终端只有有限缓冲读取权限，不能向其中注入命令；所有 Agent 命令必须通过自有的 `shell_run` 进程执行。所有可能改变工作区的 shell 都是明确的 revision 边界；即使文件监听通知延迟，验证也不会错误认证命令执行前的版本。

## 资源与上下文

每条消息最多 8 个资源：文本单文件 2 MiB、图片原图 10 MiB、其他二进制 20 MiB，单批总量 50 MiB。限制在 UI 和资源处理核心中都会执行；已经持久化的 resource ID 引用同样计入 8 个和 50 MiB，缺失或跨会话引用会直接失败。

- 同一会话按 SHA-256 去重；资源读取和视觉映射再次校验会话归属。
- 图片校验真实 MIME，最长边缩放到 2048，模型副本不超过 1.5 MiB，同时保留原图；浏览器无法解码并验证尺寸时安全拒绝，不会绕过上限放行。
- Blob 只存在 IndexedDB `resources` store；event、message、checkpoint 只持久化资源 ID，不保存附件正文、Blob 或 Base64。
- data URL 只在实际视觉请求的适配器边界临时生成，不进入持久 ledger。
- 自动压缩在有效 token 窗口达到 90% 前触发；UI 只在 RunBoard 显示一次非打扰状态。

子 Agent 每个根任务最多创建 6 个，最大深度为 1。子 Run 上限为 20 次模型轮、50 次工具调用和 5 分钟；根任务族共享 90 次模型轮、225 次工具调用和 15 分钟预算。当前版本不实现递归 swarm、team、mailbox 或并行 writer。

## 配置与数据安全

Sunam 是纯前端应用，浏览器直接向你指定的模型服务发起请求。

| 数据 | 保存位置 | 注意事项 |
| --- | --- | --- |
| API 地址、API Key、模型与界面语言 | Local Storage（`sunam_v2_*`） | 不要在公共设备或共享浏览器保存个人密钥。设置键保留 v2 名称以维持配置兼容。 |
| 会话、容器、Run、事件、资源、子任务、终端记录、快照 | IndexedDB（`sunam-v3`） | 旧 v2 repository/schema 等生产实现已删除；生产代码不打开、读取、迁移或删除旧 `sunam-v2` 工作数据库。清理站点数据会删除本地数据。 |
| 当前提示、选定图片、模型主动读取的文件/资源片段和工具结果 | 你配置的模型服务 | Sunam 不会默认上传整个工作区；实际发送内容仍适用提供商的隐私、保留、配额与计费规则。 |

不要把真实密钥提交到仓库、构建产物或前端环境变量。公开部署时建议每位用户自行配置密钥；如使用服务端代理，应自行设计鉴权、配额、审计和密钥保护。模型服务必须允许部署域名的 CORS 请求。

## 部署

WebContainer 需要 cross-origin isolation。生产站点必须使用 HTTPS，并返回：

```text
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

仓库中的 `vercel.json` 已包含这些响应头。Vercel 或其他静态托管使用 `npm run build`，发布 `dist/`，并确保 Node.js 版本为 22。上线后至少验证容器创建、文件读写、终端启动和本地服务预览。

## 开发与验证

```bash
npm run dev            # 开发服务器，端口 7891
npm run typecheck      # 严格 TypeScript 检查
npm run lint           # Oxlint
npm run test           # Vitest 单元与组件测试
npm run test:coverage  # 全核心覆盖率
npm run test:e2e       # Playwright 端到端流程
npm run test:visual    # 桌面/移动视觉回归
npm run test:runtime   # 真实 WebContainer 验收
npm run check:audit    # 生产依赖 high/critical 审计
npm run build          # 类型检查与生产构建
npm run check          # typecheck、lint、架构边界、覆盖率、build、包体
npm run check:all      # check、E2E、visual、runtime、生产依赖审计
```

冻结门槛：核心 lines/functions/statements ≥85%、branches ≥80%；初始 JS ≤90 KiB gzip、总 JS ≤320 KiB gzip、生产 `dist` ≤1.8 MiB。Playwright 视觉差异上限为 0.2%。

### Trellis 工程工作流

仓库已使用 Trellis 0.6.9 完成 Codex 初始化。根 `AGENTS.md` 是统一的 AI 工程入口，项目真实规范位于 `.trellis/spec/`，任务与研究记录位于 `.trellis/tasks/`，开发者日志位于 `.trellis/workspace/`。架构、Agent Runtime、持久化、组件、Hook、状态、类型和质量门禁都应先同步到 Spec，再由后续任务复用。

```bash
trellis --version
python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py validate <task-id>
```

本项目的 `.trellis/config.yaml` 使用 Codex `inline` 模式，避免主任务上下文被不必要地拆散；`session_auto_commit` 为 `false`，Trellis 的 journal/archive 改动必须与其他变更一起人工审查和暂存，不会自动创建提交。Codex 使用者需要在用户级 `~/.codex/config.toml` 启用 `[features].hooks = true`，并在 Codex TUI 中通过一次 `/hooks` 审批项目 hook。未审批时根 `AGENTS.md` 仍生效，但每回合工作流注入和 Trellis 命令菜单不会激活。

修改工程约定时同时更新 `.trellis/spec/`、根 `AGENTS.md`（如适用）以及受影响的 README/`docs/`。不要在 `.agents/` 下再建立第二份 `AGENTS.md`。

首次执行浏览器测试通常需要与当前 Playwright 版本匹配的 Chromium。也可通过 `PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium` 显式使用已有 Chromium/Chrome；测试仍需要权限启动本地预览服务。`check:audit` 需要能访问 npm registry。缺少浏览器、端口权限或网络时必须把对应检查记录为未执行，不能标记为通过。

### 当前优化冻结状态

2026-07-26 的最终工作区已连续两次通过 `npm run check:all`：35 个测试文件、166 个核心测试，E2E 7/7、视觉 4/4、真实 WebContainer 3/3，生产依赖审计为 0。覆盖率为 statements 91.23%、branches 82.95%、functions 90.39%、lines 94.97%；初始 JS 84.92 KiB gzip、总 JS 313.28 KiB gzip、生产 `dist` 1.34 MiB。

完整开发依赖审计仍有 8 个 high，全部位于 `vite-plugin-pwa@1.3.0` / `workbox-build@7.4.1` 构建链；npm 提议的 `vite-plugin-pwa@1.2.0` 不支持 Vite 8，因此按 [依赖 advisory 策略](docs/dependency-advisories.md) 作为上游兼容性例外跟踪，不影响生产依赖零漏洞门禁。

## 常见问题

### 终端或 WebContainer 无法启动

确认使用 HTTPS（本地开发除外），并检查 COEP/COOP 响应头。某些浏览器扩展、代理或 CDN 可能移除这些头。

### 无法加载模型或发送消息

检查 API 地址、Key、模型名和 CORS。模型列表失败不一定代表聊天不可用，可直接输入模型名。

### 刷新后数据不见了

Sunam 只在当前浏览器配置文件保存数据。无痕窗口、清理站点数据、换浏览器或换设备都不会带走数据。IndexedDB 不可用时应用会报告持久化错误，而不会用临时内存伪装保存成功。

删除 session 或 container 时，相关活动父/子 Run 会先被取消并等待收尾，再进入持久化清理事务，避免删除完成后旧执行把事件或资源写回。session 删除会清理该 session 的 terminal history；container 删除会清理该 container 的 snapshot 和 container-scoped Run 数据。

## 文档与贡献

- [架构与依赖边界](docs/architecture.md)
- [Agent Runtime 设计](docs/agent-v2-design.md)
- [发布与优化冻结验收](docs/refactor-acceptance.md)
- [依赖 advisory 策略](docs/dependency-advisories.md)

提交前至少运行 `npm run check`；涉及交互、视觉或 WebContainer 时执行相应 Playwright 测试。贡献者须确保提交可按 AGPL-3.0-only 发布，并保留第三方组件的版权和许可证声明。

## 许可证

项目采用 [GNU Affero General Public License v3.0](LICENSE)。通过网络向用户提供修改版本时，应按 AGPL 第 13 节提供取得对应源代码的机会；完整条款以仓库内许可证与 [GNU 官方文本](https://www.gnu.org/licenses/agpl-3.0.html) 为准。
