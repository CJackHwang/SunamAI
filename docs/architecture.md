# 架构与依赖边界

```text
shared → entities → features → widgets → pages → app
```

- `shared` 提供浏览器存储、i18n、LLM/SSE、跨功能契约、通用 UI 与样式 token；不得依赖业务功能。
- `entities` 仅包含消息、会话、容器、文件的类型与持久化规则。
- `features` 实现独立用例：聊天 Agent、会话标题、终端、文件管理、设置。
- `widgets` 只组合功能。Workspace 负责页面状态与布局，Sidebar 负责工作区资源入口。

## 关键契约

- `AgentRuntime` 是聊天 Agent 与终端的唯一交界面：启动进程、查询状态、写输入、终止进程。
- LLM API 层独立构造 OpenAI-compatible 请求、解析 SSE、列模型；UI 字段不会传给服务端。
- 存储模块继续使用已有 `sunam_*` 键，并以 `sunam_storage_schema_version` 标识可恢复的规范化版本。
- `shared/i18n` 默认 `zh-CN`、延迟加载 `en-US`；新增 UI 文案必须先加入两份类型安全词条。

## 性能原则

- 页面未配置 API Key 时不加载 Workspace、WebContainer、xterm、文件管理或人格提示。
- 切换终端标签不销毁 xterm；文件面板首次加载后保持实例。
- 流式消息每动画帧最多提交一次 React 状态；文件列表大小使用有界并发与路径缓存。
- 快照保存串行化，避免定时保存重叠。
