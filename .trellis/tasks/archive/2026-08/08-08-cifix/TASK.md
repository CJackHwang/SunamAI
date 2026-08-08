# TASK-CIFIX — CI 全局跑通修复（覆盖率阈值 + runtime 隔离测试）

## 背景

结项硬性要求：GitHub CI 全局跑通。push 后 CI 失败（run 31243040944）：
1. **verify job：覆盖率不达标**——functions 81.92% < 85%、branches 79.15% < 80%（新增代码缺测试：设置页/皮套/逃生门/FINALFIX 相关）
2. **runtime job：容器隔离测试失败**——`containerIsolation-real` 超时（"Container A setup complete" 100s 未出现）+ `containerProcessIsolation` 超时（ISOLATED 30s 未等到）

## 物理边界

- contracts 一字不改、UI 视觉零改动、零新增依赖
- 不删测试、不放宽阈值（覆盖阈值是既有标准，不能改）
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. 覆盖率达标（functions ≥85%、branches ≥80%）

- 跑 `npm run test:coverage` 看覆盖报告（coverage/ 目录），定位**未覆盖的模块**（新增代码：settingsStore/providers/personas/ProvidersPanel/PersonasPanel/AboutPanel/useAgentV2 新分支/containerUnavailable/piSession 新分支等）
- **补测试**到覆盖率达标（不要放宽阈值）：
  - 设置页各 panel（供应商 CRUD/皮套 CRUD/关于）
  - 逃生门（isPiEngineEnabled 分支）
  - 皮套提示词回填分支
  - containerUnavailable/containerAvailability 新逻辑
- 优先补**逻辑密集但未覆盖**的（settingsStore/providers/personas 纯函数最容易补齐）
- 目标：functions ≥85%、branches ≥80%（达标即停，不必追求更高）

### R2. runtime 隔离测试修复

- `containerIsolation-real`（containerIsolation.spec.ts:130 "Container A setup complete" 100s 超时）——分析失败原因（真实 WC 环境：可能是并发测试的资源/网络、或新改动影响）。**先本地复现**（npx playwright test --config playwright.runtime.config.ts tests/runtime/containerIsolation.spec.ts），区分：
  - 本地也失败 = 实现缺口 → 修实现
  - 本地过 + CI 挂 = 环境（CI runner 慢/并发）→ 测试加固（超时调整/重试/资源隔离）
- `containerProcessIsolation`（ISOLATED 30s 超时）——同上流程：本地复现 → 区分实现缺口 vs 环境
- **注意**：这两个是 CISOL 新增的测试（进程隔离），V1 大审计时跑过 5/5 全绿——大概率是 CI 环境慢（真实 WC boot 在 CI runner 上更慢），但必须实测确认，不能假设

### R3. 验证

- 本地：`npm run test:coverage` 达标 + `npx playwright test --config playwright.runtime.config.ts` 全绿（单独跑）
- push 后 CI 全局绿（verify + runtime）

## 提交

`fix: CI 全局跑通（覆盖率达标 + runtime 隔离测试修复）`
