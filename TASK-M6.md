# TASK-M6 — 多工作区隔离保留（虚拟目录容器语义验证 + 对齐）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI 视觉零改动**（容器切换 UI/工作区列表不动，除非发现真 bug）。
- 不新增 npm 依赖。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

M1-M5 完成：SunamAI 执行引擎切到 Succinix（host.js + 文件 RPC + 快照双层 + 工具重构 + 进程管理）。**多工作区隔离**是 SunamAI 原有核心设计：一个 WebContainer 里拆多个虚拟目录（`c-<id>`）作为独立"容器"，agent 命令在各自容器根执行，互不可见。

**现状隔离机制**（M1 已适配）：
- `getContainerRoot(containerId)` = `c-<id>`（WC 相对路径）
- `getContainerPublicPath(containerId)` = `/home/workspace/c-<id>`（node 进程视角）
- M1 的 run 前缀 `cd <containerRoot> &&`（serviceRegistry 组装）保证 agent 命令在容器根执行
- M1 修复 M-1 时 setCwd 逻辑已处理容器目录

**本任务**：**验证隔离在 Succinix 执行模型下真实成立**（不是假设），补齐任何漏洞，确保"两个虚拟容器互不可见"的原有语义不变。

## 需求（逐条、可验收）

### R1. 隔离验证（核心，真实测试）

- 验证两个容器（c-a、c-b）的隔离：
  - 容器 A 创建文件 → 容器 B 看不到（ls/read 不到）
  - agent 在容器 A 跑命令 → cwd 是 A 根，不是 B 或 WC 根
  - 容器 A 的进程（spawn 后台）不影响容器 B
- **真实测试**：新增/更新 runtime 测试（`tests/runtime/`）用真实 WebContainer 验证多容器隔离（参照 webcontainer.smoke.spec.ts 的既有多容器用例）；若无现成用例则新增
- 同时验证：Succinix host 的会话 cwd 在容器间切换时正确（容器 A 命令后切容器 B，cwd 是 B）

### R2. cwd 竞态防护

- **检查并修复**：Succinix host 是**单一会话 cwd**（文件 RPC 协议没有 per-request cwd），SunamAI 多容器并发时若两个容器交替发命令，`cd 前缀` 是否可能竞态（A 的 cd 后 B 的命令插队）？
- 若存在竞态（M1 的 `cd <root> && <cmd>` 前缀在并发下不可靠），修复方案：
  - suuccinixClient 的 FIFO 串行链已保证请求顺序（M1 实现），确认 `cd && cmd` 在同一请求内原子执行（host 侧 shlex 解析整条）
  - 或 setCwd 后立即命令（同一 FIFO 链内）
- **门禁**：并发场景测试（两容器交替发命令，各自 cwd 正确）

### R3. 隔离边界如实记录

- 若发现某类隔离无法成立（如 Succinix host 进程表是全局的——ps 显示所有容器进程，kill 跨容器可能），**如实标注**：进程表全局可见是 Succinix 语义（宿主 OS 视角），SunamAI 的"虚拟容器"隔离是**文件系统级**不是进程级——文档/注释说明这个边界，不硬造进程级隔离

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 视觉（容器列表/切换 UI）
3. Succinix host 侧（WebUnix 不改；只在 SunamAI 侧验证 + 修复客户端逻辑）
4. agent 编排/工具系统
5. 零新依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/workspace-namespace.md`（规范根、shell 环境、路径）
- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/` + **`npx playwright test --config playwright.runtime.config.ts tests/runtime/`（隔离真实测试，网络允许时）**
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿
3. **多容器隔离 runtime 测试通过**（真实 WC：A 建文件 B 不可见、cwd 正确、并发切换无竞态）
4. cwd 竞态防护测试（两容器交替命令）
5. 隔离边界如实标注（进程表全局 vs 文件隔离的说明）
6. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——WebContainer boot 有网络 flake（stackblitz），单独测试过即可，全量留 V1 终审。

## 约束

- 提交信息：`feat: M6 多工作区隔离保留（虚拟目录容器语义验证 + cwd 竞态防护）`
- 一次提交完成；不确定先读 `src/shared/lib/containerPaths.ts`、`src/features/runtime/serviceRegistry.ts`（cd 前缀逻辑）、既有 runtime 测试用例再动手
- 若隔离实际已成立（M1 已处理），任务重心在**验证 + 测试 + 边界标注**，不是改代码——如实报告验证结果
