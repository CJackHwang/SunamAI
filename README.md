# Sunam

Sunam 是一个运行在浏览器中的 Agent Coding Assistant。它使用 WebContainer 提供隔离终端和文件系统，并通过 OpenAI-compatible Chat Completions API 与模型通信。

## 开发

```bash
npm ci
npm run dev
```

WebContainer 依赖 COEP/COOP 响应头；本项目的 Vite 与 Vercel 配置已包含所需头部。建议在 Chromium 系浏览器中完成真实运行时冒烟。

## 质量命令

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run check:bundle
npm run test:e2e
npm run test:runtime
npm run check
```

`check:bundle` 将首次关键 UI 的 gzip JavaScript 限制为 180 KiB；终端、WebContainer、文件管理、人格提示和代码高亮均为按需资源。

`test:runtime` 不会发送模型请求，但会在 Chromium 中启动真实 WebContainer；它是发布前 WebContainer 环境检查，不纳入无外网保证的常规 CI。

更多的架构边界、兼容性保证和发布验收项见 [docs/architecture.md](docs/architecture.md) 与 [docs/refactor-acceptance.md](docs/refactor-acceptance.md)。
