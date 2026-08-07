# TASK-PITOOLUI — pi 通道工具调用显示在聊天气泡

## 背景（用户实测反馈）

用户实测 pi 通道：**能运行和调用工具（后端正常），但前端聊天气泡不显示工具调用信息，只剩思考内容**。根因：
- `piSession.ts:276-283` `tool_execution_start/update/end` 事件**直接 break 丢弃**（P3 时按"UI 视觉零改动"跳过）
- `piMessageToAppMessage`（`piSession.ts:185-202`）转换 assistant 消息时**没转 toolCalls**（toolResult 已转 role:'tool'）

注意：**R4 已删除旧引擎**（engine.ts 的 tool_started/tool_finished 事件源没了）——现在 pi 通道是唯一实现，工具消息渲染必须在 pi 侧补齐（不能再"对齐旧引擎"）。

## 物理边界

- `src/shared/contracts/agentRuntime.ts` / `terminal.ts` 一字不改
- **UI 组件结构零改动**（ChatMessageList 的现有 tool 消息渲染——若已有 tool 消息渲染就复用；只改 piSession 数据侧）
- 零新增依赖
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. assistant 消息的 toolCalls 转换（piMessageToAppMessage）

- pi 的 assistant 消息 content 含 `toolCall` 块时，转成现有 Message 模型的 toolCalls（检查 `src/entities/agent/types.ts` 的 ToolCall/Message 结构 + ChatMessageList 消费的字段）
- 转换：toolCall 块（name/arguments/工具 id）→ 现有 ToolCall 结构
- 这样 assistant 消息渲染时气泡里能看到工具调用（调用名 + 参数）

### R2. 工具执行事件 → UI 事件（tool_execution_start/end 不再丢弃）

- `tool_execution_start` → emit `tool_started`（含 toolCall：名称/参数）
- `tool_execution_end` → emit `tool_finished`（含 toolCall + result）
- 检查 UI 是否消费 tool_started/tool_finished（ChatMessageList/事件订阅）——消费则工具调用实时显示（开始/完成状态）
- tool_execution_update → 评估（有中间态则透传，无则忽略+标注）

### R3. 工具结果消息渲染

- toolResult 消息（role:'tool'，已转换）确认 UI 正确渲染（工具名 + 结果摘要）
- 若有截断（结果太长），对齐现有工具消息的摘要逻辑

### R4. 与思考内容共存

- 思考（reasoning_content）保留显示，工具调用信息**叠加**在气泡里（思考 + 工具调用都要）
- 顺序：assistant 思考 → 工具调用 → 工具结果 → 继续

### R5. 测试

- 单测：pi assistant 消息含 toolCall → Message.toolCalls 正确转换；tool_execution_start/end 事件 → tool_started/tool_finished 事件正确 emit
- e2e（mock LLM）：pi 对话含工具调用 → 聊天气泡显示工具信息（断言 UI 出现工具调用元素）

## 质量门禁（节选）

1. `npx tsc -b` 0 错
2. `npx vitest run tests/unit/` 全绿（新增转换/事件测试）
3. `npm run build` + check-bundle 通过
4. **浏览器实测**（mock 或真实 API）：pi 对话调工具 → 聊天气泡显示工具调用 + 结果（不只是思考内容）
5. `git diff --check` 干净

## 提交

`fix: pi 通道工具调用显示在聊天气泡（toolCalls 转换 + 执行事件透传）`
