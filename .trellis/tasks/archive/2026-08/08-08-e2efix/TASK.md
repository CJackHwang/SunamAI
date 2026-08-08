# TASK-E2EFIX — e2e 回归修复（pi 切换后 agent-flows checkpoint/核心流失败）

## 背景

CI verify job 的 e2e **确定性失败 25 个**（agent-flows 系列为主：checkpoint resume/compaction/image-attachment/child-run 等），本地 CI=true 也复现。**V1 大审计时 e2e 18/18 全绿** → V1 后改动（PISWITCH pi 切换 + R4 删旧引擎）引入回归。

**已定位的线索**：
- `agent-flows.spec.ts:189` `readCheckpointRunId` 读 IndexedDB `checkpoints` store 的 `getAll()` → 8s 等不到数据（undefined）
- `checkpoints` store 还在（v3Repositories.ts 写入），`saveCheckpoint` 还在（eventStore.ts:76）
- **嫌疑**：pi 通道（piSession）不再调用 `saveCheckpoint`（旧引擎 engine.ts 有 checkpoint 写入路径，R4 删了）→ checkpoint store 空 → 测试读不到

## 物理边界

- contracts 一字不改、UI 视觉零改动、零新增依赖
- **不删测试、不放宽断言**（checkpoint 必须真持久化）
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. 排查根因（先诊断）

- 确认 pi 通道是否调用 `saveCheckpoint`（grep piSession/useAgentV2 的 checkpoint 调用）
- 对比 R4 前：engine.ts 的 checkpoint 写入路径（`git show d8e2294~1:src/features/agent-core/engine.ts | grep -n checkpoint`）
- **列出所有失败的 e2e**（agent-flows 8 个 + 其他），分类：
  - checkpoint 相关（readCheckpointRunId 读 store）
  - 其他核心流（compaction/image-attachment/child-run）——是否同一根因（pi 通道某些状态没落盘）还是各自独立

### R2. 修复

**若根因 = pi 不写 checkpoint**：
- pi 通道（piSession 或 useAgentV2 的 pi 路径）补上 checkpoint 持久化：run 中断/关键节点时 `saveCheckpoint`（复用 eventStore.ts 的现有方法，对齐旧引擎语义）
- 或确认 pi 有自己的 checkpoint 机制（IndexedDB 会话）——若语义不同，评估测试期望是否该对齐新机制（**注意：不能只改测试，pi 的 checkpoint 能力必须真实存在**）

**若根因 = 其他**（按实测）：修对应链路

### R3. 验证

- 本地 `CI=true npx playwright test tests/e2e/agent-flows.spec.ts` 全绿
- 本地 `CI=true npx playwright test tests/e2e/` 全量绿（verify 的 e2e 全部）
- push 后 CI verify job 全绿（唯一验收）

## 提交

`fix: e2e 回归（pi 通道 checkpoint 持久化恢复，agent-flows 全绿）`
