# TASK-P2 — pi IndexedDB 会话后端（刷新持久化）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**。
- 不新增运行时依赖（**IndexedDB 用浏览器原生 API，不装 idb 库**——除非原生 API 实在难用且体积可控，给出理由）。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

P1 完成（8c44f4d）：pi 框架嵌入，单 Agent 对话跑通（piSession.ts 304 行 + 事件流桥接 useAgentV2）。现在做 **会话持久化**：pi 的 Session 系统默认用 `InMemorySessionStorage`（内存，刷新即丢）。目标：实现 **IndexedDB 版 SessionStorage**，刷新后 pi 会话可恢复（checkpoint 基础）。

**pi Session API（P1 已确认，以实际源码为准）**：
- `Session<TMetadata>` 类：`appendMessage / findEntries / getLog / createLane / appendRecord / getMetadata` 等
- `SessionStorage<TMetadata>` 接口（`session/types.d.ts`）——**实现这个接口就是 IndexedDB 后端**
- `InMemorySessionStorage` 是现成内存实现（参考它的事件/存储形状）
- `SessionRepo`（`session/memory.d.ts`）：仓库层（多会话管理）——若 pi 用 repo 管理会话列表，也要 IndexedDB 化

## 需求（逐条、可验收）

### R1. IndexedDB 存储实现（新增 `src/features/agent-core/pi/indexedDbSessionStorage.ts`）

- 实现 `SessionStorage<TMetadata>` 接口（以 pi 实际类型定义为准）
- 用 IndexedDB 持久化：每个 session 一条记录（或按数据结构分 store），**刷新后数据完整可恢复**
- 参考 `InMemorySessionStorage` 的实现形状（事件顺序/返回结构一致）
- 若 SessionRepo 也需要：实现 IndexedDB 版 repo（会话列表持久）

### R2. 接入 piSession（piSession.ts 改）

- piSession 创建 Session 时用 IndexedDB 后端替代内存后端
- 会话 ID 策略：现有 SunamAI 会话 ID 或 pi 自己的 idGenerator——**与现有 UI 会话切换对齐**（刷新后恢复当前会话）

### R3. 刷新恢复端到端（真实测试）

- 真实对话（或 mock LLM）→ 记录消息 → 刷新页面 → 会话消息恢复、pi Agent 可从历史继续
- **注意 pi Agent 实例是内存态**：刷新后重建 Agent，但**会话历史从 IndexedDB 加载**——验证"历史在、可继续对话"

### R4. 边界如实记录

- IndexedDB 存储的局限（浏览器存储配额、跨设备不同步等）**如实标注**（后续 P5 checkpoint 可能扩展）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉
3. P1 的 piSession 事件桥接（useAgentV2 的消息流逻辑不动，只换存储后端）
4. 现有 SunamAI 自己的 v3 持久化（v3Repository）——pi 会话是独立体系，不混用
5. 零新增依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/persistence-and-snapshots.md`（sunam-v3 存储、守卫）+ `.trellis/spec/frontend/agent/model-context-and-messages.md`
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（新增 indexedDbSessionStorage 测试）+ `npm run build`（bundle 预算）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（新增：IndexedDB 读写往返、session 恢复、repo 列表）
3. `npm run build` → bundle 在限制内
4. **刷新恢复测试**：写→读→重建 session→历史完整（mock LLM 或真实）
5. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: P2 pi IndexedDB 会话后端（刷新持久化）`
- 一次提交完成；**先读 pi 的 session/types.d.ts + memory.d.ts（InMemorySessionStorage 实现）确认接口形状**，再写 IndexedDB 版
- 若 IndexedDB 原生 API 实现复杂，可评估轻量封装（项目内自写，不引第三方库）——**给出理由**
- 测试环境 IndexedDB：用 fake-indexeddb 或现有测试基建（若有）——**不新增重型依赖**
