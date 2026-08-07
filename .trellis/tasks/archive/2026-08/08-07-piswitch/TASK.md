# TASK-PISWITCH — pi 全面切换（附件/resume/默认开关/旧引擎删除）

## 背景

P 系列完成 pi 通道全部能力（对话/持久化/工具/子 agent/压缩/AgentDriver），但**默认关闭**（featureFlag localStorage 控制，默认走旧引擎）。用户决策：**pi 没问题就全面切换，删掉旧引擎**。本任务：补齐 pi 通道缺口（附件/resume）→ 默认开关 → 稳定后删旧引擎。

## 物理边界

- `src/shared/contracts/agentRuntime.ts` / `terminal.ts` 一字不改
- UI 视觉零改动（功能行为改，样式不动）
- 不新增 npm 依赖
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. pi 通道附件支持（当前缺口）

现状：`useAgentV2.ts:298` `(!attachments || attachments.length === 0)` 才走 pi，有附件回退旧引擎；piSession 无附件处理。

**实现**：
- 附件接入 pi 消息：ChatAttachment（现有资源系统 resourceId/read_resource_image）→ pi AgentMessage 多模态 content（图片/文本）
- 附件感知：pi Agent 收到附件后能理解（图片用 read_resource_image 或消息内嵌 image content——**以 pi 消息类型支持为准**，若 pi 消息支持 image block 则内嵌，否则转资源工具）
- 移除"有附件回退旧引擎"的条件——pi 通道全场景接管
- 测试：附件消息 → pi Agent 感知（mock LLM 断言消息含附件）

### R2. pi 通道 resume（断点恢复，当前缺口）

现状：`!resume` 才走 pi；pi 通道 resume 回退旧引擎。

**实现**：
- 现有 resume 语义（AgentResumeState：恢复历史 + 继续执行）在 pi 通道落地：
  - P2 IndexedDB 会话已存历史 → resume 时从会话加载 + 继续（pi Agent 的 state.messages 已支持）
  - resume 的 checkpoint/workspace 恢复（现有 resumeState 的 workspaceRevision 等）→ pi 通道对齐
- 移除"resume 回退旧引擎"条件
- 测试：resume 会话 → pi Agent 从历史继续（mock LLM 或真实）

### R3. 默认开关切换（pi 成为主引擎）

- `featureFlag.ts`：默认**开**（`isPiEngineEnabled()` 默认 true；保留 localStorage 可关，作为回退逃生门）
- 设置 UI（如有开关入口）同步：默认勾选 pi 引擎
- 旧引擎路径保留但非默认（逃生门：localStorage 关 pi → 走旧引擎）

### R4. 旧引擎删除（稳定后，独立步骤）

**前提**：R1-R3 完成后实测稳定（浏览器真实对话 + 工具 + 附件 + resume 全链验证通过）

**删除面**（先审计再删）：
- `engine.ts`（AgentEngine 旧实现）/ `agentFamily.ts`（AgentFamilyBudget 等）/ `subagentCoordinator.ts`（旧 AgentFamilyCoordinator）/ `modelClient.ts` 旧路径 / `context.ts` 旧压缩
- **保留**：`tools/` 现有工具实现（pi 适配器复用它们，只包不改！）、contracts、capability 注册表
- **审计**：grep 旧引擎引用（useAgentV2 的旧路径、测试、其他模块）——全部切 pi 后删
- **删除后**：tsc 0 错 + 单测全绿 + 浏览器实测（旧引擎路径不可达）

### R5. 诚实标注

- 删除旧引擎是**不可逆**（git 历史可回滚）——删除前 git tag 存档
- 若某功能只在旧引擎有（pi 实在补不上）→ 如实标注降级或暂留旧引擎那一块

## 质量门禁（节选）

1. `npx tsc -b` 0 错
2. `npx vitest run tests/unit/` 全绿（新增：附件消息、resume 继续、默认开关）
3. `npm run build` + check-bundle 通过
4. **浏览器实测**（关键）：真实对话（DeepSeek）+ 附件 + resume + 工具调用全链在 pi 通道跑通
5. 删除旧引擎后：tsc/单测/build 全绿 + 旧路径不可达

## 提交

- `feat: pi 全面切换（附件 + resume + 默认开启）`
- `refactor: 移除旧引擎（AgentEngine/AgentFamily/subagentCoordinator），pi 为唯一引擎`
