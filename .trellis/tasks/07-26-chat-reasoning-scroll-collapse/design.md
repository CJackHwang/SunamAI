# Technical Design

## Architecture and Boundaries

本任务沿现有数据链路修复，不新增跨层状态：

```text
Provider SSE
  -> shared/api/sse Zod validation and null normalization
  -> AgentModelClient cumulative delta
  -> AgentEngine assistant message preservation
  -> Agent event projection
  -> ChatMessage / ThinkingProcess
```

滚动与折叠只属于聊天 UI：

```text
stream/message/composer height changes
  -> useChatAutoScroll follow decision
  -> instant bottom correction when following
  -> smooth scroll only for explicit user action
```

## Provider Delta Contract

- `content` 和 `reasoning_content` 在 wire schema 中接受 `string | null | undefined`。
- schema 解析后将 `null` 视为“本事件无该字段内容”；`applyDelta` 只合并非空字符串。
- 其他错误类型继续使事件失效，维持外部数据 fail-closed 原则。
- 增加真实形态回归测试：同一 delta 同时包含 `content: null` 与字符串 reasoning。

## Final Message Preservation

- 工具调用分支已经通过 spread 保留 reasoning。
- 纯文本分支改为保留 response message 的规范字段，同时覆盖清理后的 content，避免只构造 `{ role, content }`。
- 测试使用 delta-only reasoning client 或直接 reasoning response，证明最终 `message` 事件仍含 reasoning。

## Scroll Coordination

### Current failure mode

当前 hook 对每次依赖变化执行 `scrollTo(... behavior: 'smooth')`。30fps 流式增量会在上一段滚动动画结束前启动下一段；动画过程触发 scroll 事件，`isAtBottom` 在 true/false 之间变化。与此同时 `.chat-message-list` 的 bottom padding 还在过渡，scrollHeight 持续变化，形成可见抖动。

### New behavior

- hook 使用 ref 同步记录“是否应跟随底部”，避免等待 React state 后才决定是否抢滚动。
- `onScroll` 根据阈值同时更新 ref 与 `isAtBottom`。
- 依赖变化时使用 layout-phase 底部校正，将 `scrollTop` 直接设置到最新底部；这不会创建可叠加动画。
- 公共 `scrollToBottom` 仅用于用户按钮，保留 `behavior: 'smooth'`。
- bottom padding 移除 transition，让 composer 保留高度一次性生效并被同一轮底部校正覆盖。
- 历史分页的 `previousHeight` 补偿仍由 `Workspace.tsx` 管理，不移入 hook。

## Thinking Process Layout

- `.thinking-process` padding 从 16px 缩小到四边 10px，margin-bottom 缩小。
- `.thinking-content` 最大高度从 120px 降到 72px。
- 保留内部 `overflow-y: auto` 和 `ThinkingProcess` 自身的流式 scrollTop 跟随。

## Tool Disclosure UI

- `ChatMessage` 将普通工具卡片渲染为未设置 `open` 的 `<details>`。
- `<summary>` 承担原标题行，包含图标、状态、工具名和 chevron；浏览器原生交互提供键盘支持。
- 工具 disclosure 本身不绘制 border，只保留轻背景和圆角，避免在已有外层消息卡片内形成重复描边。
- disclosure 内的 arguments/result 内容块使用 `var(--color-surface)`，在默认浅色主题中呈白色。
- disclosure 外层背景直接使用 `var(--color-bg)`，与聊天页灰色完全一致，不再混入透明度。
- 参数和结果放入 disclosure body。
- 点击 summary 时测量折叠态与展开态的固有边界，通过 Web Animations API 对 width/height 做非线性 FLIP 式过渡；内容同步使用较短的 opacity/translate/scale 动画，箭头使用 spring 曲线。
- 动画开始前若聊天视口位于底部，则逐帧使用无动画 scrollTop 校正保持贴底；wheel/touchstart 会停止该跟随，避免抢夺用户滚动。
- `prefers-reduced-motion: reduce` 或缺少 Web Animations API 时直接切换原生 details 状态。
- output 存在时使用新增 `chat.completed`，否则使用现有 `chat.running`。
- `ask_user` 不进入 details，保持当前直接交互语义。

## Global Motion Audit

- `motion.css` 增加统一 `--motion-exit` 曲线；hover/color 继续使用 fast/ease，空间变化使用 spring/sheet，避免每个模块复制 cubic-bezier。
- 模型选择器补齐 160ms 的 opacity/translate/scale 退场，匹配默认 `usePresence` 保留时间。
- 桌面 context menu 仍快速退出；移动 bottom sheet 使用 240ms 退出，因此文件和侧栏资源菜单的 presence 延长到 240ms，避免动画中途卸载。
- RunBoard 的 grid-row、内容 opacity/transform 和箭头统一采用 sheet/spring；它属于用户触发的 overlay 展开，不参与 composer 保留高度。
- 终端标签保持 15px 稳定字号，选中态用字重和轻微 transform，避免 font-size transition 触发布局重排。
- 文件管理器与侧栏的 120/150ms 零散反馈改用共享 fast/snappy token；spinner/shimmer 保持适合其语义的 linear/ease-in-out。
- 所有消息气泡的 padding 统一为四边 16px，思考块为四边 10px，内部 disclosure 为四边 8px；外层消息与内部 disclosure 都不绘制描边。

## Compatibility and Rollback

- 不修改 Message、AgentEvent 或 IndexedDB schema，无数据迁移。
- 旧历史消息会直接获得新的折叠呈现。
- 若滚动策略出现回归，可独立回滚 hook/CSS；provider null 兼容和 reasoning 保留不依赖 UI 改动。

## Risks

- jsdom 不提供真实布局，需要通过可控的 `scrollHeight/clientHeight/scrollTop` 属性验证策略，并以浏览器 E2E/视觉检查补充。
- 原生 details 的 marker 需要 CSS 统一隐藏或替换，避免与自定义 chevron 重复。
- `useLayoutEffect` 必须避免无条件 state write，以免产生额外渲染循环。
