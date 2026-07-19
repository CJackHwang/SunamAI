# Sunam

Sunam 是一个运行在浏览器中的开源 AI 编程助手。它通过 OpenAI-compatible Chat Completions API 与大语言模型通信，并利用 WebContainer 在浏览器中提供隔离的终端、文件系统和开发服务体验。

项目面向希望在本地或自托管环境中使用 AI 协助编程的开发者：聊天、代码与文件操作、终端执行、服务预览等工作流均在同一界面完成。

## 功能概览

- 支持 OpenAI-compatible API：可配置服务地址、API Key 与模型。
- 基于 WebContainer 的浏览器内运行环境：提供终端、文件管理和端口服务预览。
- Agent Core v2：具备计划、结构化工具调度、验证完成门、预算/取消、上下文摘要、事件恢复与多会话 / 多容器隔离。
- 支持 AI 工具调用、流式输出，以及多会话 / 多容器工作流；工作区改动必须具备真实验证证据才可完成。
- 支持文件上传、下载、编辑、移动与预览。
- 会话与容器工作区是开发态内存状态；刷新后从新的工作区开始。
- 内置中文与英文界面，支持安装为 PWA。
- 使用响应式界面，适配桌面端开发场景。

> Sunam 不提供模型服务或托管后端。模型 API 的可用性、配额、费用与数据处理规则由你配置的服务提供商决定。

## 环境要求

- Node.js 22（推荐；项目 CI 使用该版本）
- npm
- 推荐使用最新版 Chromium 内核浏览器（Chrome、Edge 等）
- 一个可用的 OpenAI-compatible 模型服务及 API Key

WebContainer 依赖跨源隔离（cross-origin isolation）。生产部署必须使用 HTTPS，并正确返回文档中的 `Cross-Origin-Embedder-Policy` 和 `Cross-Origin-Opener-Policy` 响应头。

## 快速开始

```bash
git clone https://github.com/CJackHwang/SunamAI.git
cd SunamAI
npm ci
npm run dev
```

打开终端提示的本地地址（默认是 <http://localhost:7891>），然后在应用设置中填写：

1. API 服务地址；
2. API Key；
3. 要使用的模型名称。

模型服务需至少兼容 Chat Completions 接口（通常为 `/chat/completions`）。模型列表接口（通常为 `/models`）可用于自动读取模型；若服务未提供该接口，也可以手动填写模型名。

## 配置与安全

Sunam 是纯前端应用。当前配置（包括 API 服务地址、模型和 API Key）存储在当前浏览器的本地存储中，并由浏览器直接请求你指定的模型服务。

- 不要在公共设备或多人共用的浏览器配置个人 API Key。
- 不要将真实密钥写入仓库、构建产物或前端环境变量。
- 部署到公开站点时，应让每位用户自行配置其 API Key，或在引入服务端代理前完成相应的鉴权、配额与安全设计。
- 请确认所使用模型服务允许来自你的部署域名的跨域请求（CORS）。

## 构建与本地预览

```bash
npm run build
npm run preview
```

生产构建会输出到 `dist/` 目录。可以将该目录部署到任意支持静态站点的服务。

## 部署指南

### Vercel

仓库已包含 `vercel.json`，其中为 WebContainer 配置了必要的跨源隔离响应头。

1. 将仓库导入 Vercel；
2. 选择 Vite 项目；
3. 设置 Node.js 22；
4. 构建命令填写 `npm run build`；
5. 输出目录填写 `dist`；
6. 部署并通过 HTTPS 访问站点。

通常不需要在 Vercel 配置 API Key 环境变量，因为密钥由每位用户在浏览器中自行配置。

### 其他静态托管服务

在 CI 或本地构建后上传 `dist/`：

```bash
npm ci
npm run build
```

除将 `dist/` 设为发布目录外，请确保静态服务器对页面响应至少返回以下头部：

```text
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

缺少这些头部时，浏览器会禁止 WebContainer 所需的共享内存能力，终端和运行时功能可能无法启动。部署后建议至少验证：能创建容器、打开终端、读写文件，并启动一个可预览的本地服务。

## 工程质量命令

```bash
npm run check          # TypeScript、ESLint、单元测试、覆盖率与构建体积检查
npm run test           # 单元测试
npm run test:coverage  # 单元测试与覆盖率报告
npm run test:e2e       # Playwright 端到端测试
npm run test:runtime   # Chromium + 真实 WebContainer 运行时冒烟测试
npm run build          # 生产构建
```

更多实现与验收信息：

- [架构说明](docs/architecture.md)
- [重构验收清单](docs/refactor-acceptance.md)

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请运行与改动范围相称的检查；涉及交互、终端或 WebContainer 时，建议同时执行 `npm run test:e2e` 或 `npm run test:runtime`。

贡献者应确保其提交有权以本项目的许可证发布，并保留第三方组件原有的版权与许可证声明。

## 许可证

本项目采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）许可证。

若你修改本项目并通过网络向用户提供该修改版本，AGPL 第 13 节要求向与该版本远程交互的用户提供取得对应源代码的机会。完整条款以仓库内的 [LICENSE](LICENSE) 与 [GNU 官方文本](https://www.gnu.org/licenses/agpl-3.0.html) 为准。
