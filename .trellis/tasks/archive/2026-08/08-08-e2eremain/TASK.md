# TASK-E2EREMAIN — agent-flows 剩余 4 个失败修复

## 背景

E2EFIX（cc88c33）已修好 checkpoint/steer/压缩锚点（agent-flows 3→5 passed）。剩余 4 个失败（本地 CI=true 复现）：

1. **compaction（:70）**：Test timeout 120s——20,000 字历史应触发语义压缩（mock 等 'Create a compact factual continuation record' 请求），但 pi 通道可能未触发。**已定位线索**：e2e-model 兜底 profile contextWindow=32,768，触发阈值 = 32,768×0.9≈29.5k tokens，20k 字输入边缘——可能未达阈值。piSession.ts:164 有 `compactionContextWindow` 测试注入点（P5 加的），测试未用。**修复方向**：测试注入小窗口（如 8,000）确保确定性触发，或 piSession 默认窗口对该场景更合理
2. **queues-guidance（:229）**：user 消息 'Prioritize the mobile composer.' 8s 未出现——steer 引导未生效。E2EFIX 已接 guideActiveTask→driver.steer，但测试仍挂。**看 steer 链路**：useAgentV2 guideActiveTask → PiDriver.steer → piSession 的 steer 是否真实注入下一轮
3. **child-run（:413）**：'Parent coordination fixture did not receive the child ID'——子 agent 编排链路：root spawn 子 → 子 ask_parent → 父引导 → 子 resume。E2EFIX 加了 blocked/resumeBlockedChild 但仍挂。**看 child ID 传递**：fixture 怎么收 child ID（root 的 ask_parent 返回里？）
4. **root-family（:489）**：'a new root family prunes terminal children'——子 agent 清理逻辑

## 物理边界

- contracts 一字不改、UI 视觉零改动、零新增依赖
- **不删测试、不放宽断言**（功能必须真实）
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. 逐个根因定位（先诊断再修）

- **compaction**：确认触发链（isCompactionNeeded → estimateContextTokens vs 阈值）——测试注入 compactionContextWindow 或调 piSession 默认
- **queues-guidance**：跟 steer 全链路（useAgentV2.guideActiveTask → PiDriver.steer → piSession.steer → 下一轮 user 消息）——哪环断了
- **child-run/root-family**：子 agent 编排（spawn/ask_parent/message/resume/prune）——E2EFIX 的 blocked 机制是否完整（child ID 传递、resume 后转录）

### R2. 修复（实测驱动）

每个修复后**本地 CI=true 单跑该测试**验证，不批量跑（快反馈）

### R3. 最终验证

- 本地 CI=true agent-flows 全量全绿
- 本地 CI=true e2e 全量全绿（verify 的 e2e 全部）
- push 后 CI verify job 全绿（唯一验收）

## 提交

`fix: agent-flows 剩余失败（compaction 触发 + steer 引导 + 子 agent 编排）`
