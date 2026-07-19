# 架构与依赖边界

```text
shared → entities → features → widgets → pages → app
```

- `shared` 提供浏览器存储、i18n、LLM/SSE、跨功能契约、通用 UI 与样式 token；不得依赖业务功能。
- `entities` 仅包含消息、会话、容器、文件的领域类型。
- `features` 实现独立用例：Agent Core、会话标题、终端、文件管理、设置。
- `widgets` 只组合功能。Workspace 负责页面状态与布局，Sidebar 负责工作区资源入口。

## 关键契约

- `AgentWorkspaceRuntime` 是 Agent Core 与 WebContainer 的唯一边界：受容器根目录约束的文件读取/搜索/写入、前后台进程、输出游标、取消与事件订阅。`WebContainerAgentRuntime` 拥有进程；终端仅渲染和手动控制它。
- `features/agent-core` 是唯一的 Agent 执行内核。每个 Run 拥有固定的 session、container、模型、人格、Task Contract、Chaos Contract、预算和 append-only 事件序列；不存在旧的纯 loop 或运行时回退路径。
- Tool Registry 以 schema、只读/并发属性和结构化 `AgentToolResult` 描述工具。只读工具可并发，写入和命令按容器串行；所有工具结果回流下一次模型请求。
- LLM API 层独立构造 OpenAI-compatible 请求、解析 SSE、列模型；Agent Core 通过 `AgentModelClient` 使用它，因此未来协议只能新增 Adapter，不能进入执行内核。
- Agent Event Store 在当前页面内存中保存 v2 的 session/run/sequence 事件与 checkpoint；它从不导入旧消息或旧 Run。运行中的 v2 Run 在当前 session 重新接管时会被标记为 `interrupted`，只能从 checkpoint 新建 Run 续作；刷新即清空。
- 设置使用独立的 `sunam_v2_*` 键。旧 `sunam_*` 键、旧工作区、消息、终端历史和文件系统快照均不会被读取或转换；开发刷新从新的内存工作区开始。
- `shared/i18n` 默认 `zh-CN`、延迟加载 `en-US`；新增 UI 文案必须先加入两份类型安全词条。

## 性能原则

- 页面未配置 API Key 时不加载 Workspace、WebContainer、xterm、文件管理或 Agent Core。
- 切换终端标签不销毁 xterm；文件面板首次加载后保持实例。
- 流式 assistant delta 是 transient 事件，不进入长期 transcript；上下文达到阈值后由 Context Composer 摘要，连续失败后确定性裁剪。
- Agent 终端输出仅保留在当前页面内存中，切换标签不会丢失，刷新页面即清空。
