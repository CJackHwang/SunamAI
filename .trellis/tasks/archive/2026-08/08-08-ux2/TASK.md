# TASK-UX2 — 容器启动时序优化 + 受限状态持久化

## 背景（用户明确要求）

1. **启动时序**：容器本身加载好就立刻显示终端界面（主观快感），**Succinix 系统（host）加载在终端可见之后**——不然等 host 完全就绪再显示会很久，而且看不到自检画面。现状：可能等 boot 全完成才显示（要检查）。
2. **受限状态持久化**：环境不支持启动 Succinix（如非 Chromium/无跨域隔离）→ 触发一次受限 → **自动关闭容器环境**，并且要**像主动关闭一样持久化**——下次进入不会自动重新开启，避免无效加载。

## 物理边界

- contracts 一字不改
- UI 视觉零改动（时序/状态逻辑改）
- 零新增依赖

## 需求

### R1. 启动时序：容器就绪即显示终端，host 加载后置

检查现状：
- `ensureContainer`（WebContainerAgentRuntime.ts:153）+ `bootSuccinixHost`（:100）的调用顺序——是否等 host 完全就绪才让 UI 显示终端？
- 用户终端会话（V2TERM 的 UserTerminalSession）什么时候就绪？

目标：
- **WC 容器加载完成（ensureContainer 完成）→ 立即显示终端界面**（横幅/loading 状态可见）
- host boot（注入 host.js + spawn + ping）在终端可见后继续，完成时自检日志/横幅追加到终端（滚动显示）
- 主观体验：点容器 → 终端立刻出现 → boot 日志/自检往下滚动 → 提示符就绪

**注意**：V2TERM 已让终端显示 Succinix 横幅 + 自检——检查是否已经在"WC 就绪即显示"，还是等 host。若是等 host，调整时序。

### R2. 受限状态持久化

现状：`containerAvailable`（useAgentV2.ts:76，capability 判定）为 false = 受限（chat-only）。检查触发机制。

目标：
- 环境不支持 Succinix（受限）→ 触发一次 → 自动关闭容器环境 + **持久化受限标记**（localStorage，如 `sunam_container_unavailable=1`）
- 下次进入：读取持久化标记 → **不自动开启容器**（避免无效加载），显示"容器环境不可用（已记录），可手动重试"或保持 chat-only
- 手动重试（用户主动再试）→ 清除标记重新检测

### R3. 边界如实

- 受限判定标准（非 Chromium/无 COOP/COEP）保持现状，只改"触发后的持久化行为"
- 持久化标记的清除时机（用户手动重试/环境变化）如实记录

## 质量门禁（节选）

1. `npx tsc -b` 0 错
2. `npx vitest run tests/unit/` 全绿（新增：受限持久化测试——触发→标记→下次不自动开→重试清除）
3. 浏览器实测：容器打开 → 终端立即显示（不等 host 就绪）→ boot 日志滚动 → 提示符；受限环境 → 触发一次 → 刷新后不自动开容器
4. `git diff --check` 干净

## 提交

`feat: 容器启动时序优化（WC 就绪即显示终端）+ 受限状态持久化`
