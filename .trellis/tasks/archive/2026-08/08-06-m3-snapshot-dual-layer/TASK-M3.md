# TASK-M3 — 快照双层协调：SunamAI checkpoint 与 Succinix 文件快照并存

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI/组件/样式零改动**。
- 不新增 npm 依赖。
- 不删改 agent 编排、资源系统、工具系统。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

M1/M2 完成：SunamAI 的执行引擎已切到 Succinix（host.js 常驻 + 文件 RPC），服务/端口管理已对齐。现在容器里有两套持久化机制并存：

1. **SunamAI 自己的快照**（`snapshotCoordinator.ts` + `snapshotScheduler.ts` + `v3Repository.ts`）：用 `webcontainer.export(getContainerRoot(containerId), { format: 'json', excludes: SNAPSHOT_EXPORT_EXCLUDES })` 把**工作区文件树**快照到自己的 IndexedDB（v3RecordStore，含 snapshots store），750ms debounce，boot 时 `ensure()` mount 恢复。这是 agent checkpoint 体系的一部分（`getWorkspaceRevision` / 可恢复执行依赖它）。
2. **Succinix 的自动快照**（WebUnix 侧，IndexedDB 库 `succinix-persist`）：host.js 启动后对**整个容器 FS**（含 /etc/succinix.* 状态、/usr/lib/succinix 资产、.pyodide、工作区）约每 2.5s 自动快照 + pagehide 兜底，boot 时恢复。

**问题**：两套快照并存需要协调，否则：
- **双写冲突**：SunamAI export 快照时若 Succinix 正在写快照，或反之，IndexedDB 写事务可能互相阻塞/竞态
- **恢复时机不一致**：Succinix 先恢复容器 FS → SunamAI 再 mount 工作区树 → 谁覆盖谁？
- **性能浪费**：两套快照各写一遍全量数据

**本任务：协调双层快照，让两套机制正确并存、互不覆盖、性能可接受。**

## 关键事实（已调研确认）

- Succinix 快照的 IndexedDB 库名 `succinix-persist`（浏览器 origin 隔离）；SunamAI 用自己的 v3RecordStore（库名待确认，见 `v3RecordStore.ts`）——**两个不同 IndexedDB 库，不直接冲突**
- SunamAI 的 `SNAPSHOT_EXPORT_EXCLUDES` 已排除某些目录（生成目录如 node_modules/dist），Succinix 快照含全部
- SunamAI `ensure(containerId)`：loadSnapshotState → mount 到 getContainerRoot；Succinix boot：恢复整个容器
- SunamAI scheduler 750ms debounce；Succinix ~2.5s 周期

## 需求（逐条、可验收）

### R1. 恢复顺序协调（谁先谁后）

现状时序（boot）：WebContainer.boot → SunamAI getContainerRoot → `ensure()` mount SunamAI 快照 → runtime 就绪。Succinix host 的恢复发生在其 boot（注入 host.js → spawn node host.js，host 自己从 succinix-persist 恢复容器）。

**需求**：确认并协调恢复顺序，保证**工作区文件**最终一致（SunamAI 快照为准，因为它是 agent 语义的权威——revision 体系基于它）。方案：
- 若 Succinix host 恢复先发生（它恢复的是上次整个容器，包含工作区）→ SunamAI ensure mount 会覆盖工作区为 SunamAI 快照版本 → 一致 ✅（但要确认 mount 不会把 Succinix 的 /etc 状态/资产覆盖掉——mount 是 overlay 还是 replace？若 replace，Succinix 恢复的 /etc/.pyodide 会被抹掉）
- 若 SunamAI 先 mount → Succinix host 恢复容器 → 可能覆盖工作区 → 不一致 ❌
- **目标**：最终状态 = SunamAI 工作区（agent 权威）+ Succinix /etc 状态/资产（host 权威），互不覆盖。实现方式自选（如：SunamAI mount 只挂工作区根；或 Succinix host 恢复时跳过工作区；或明确时序先 host 后 sunam 且 mount 用 merge 语义）

### R2. 双写协调（避免互相干扰）

**需求**：两套快照写入互不阻塞、不丢失。方案（自选，满足门禁）：
- 明确 Succinix 快照排除工作区（host 只管 /etc 状态/资产/系统文件），SunamAI 管工作区——职责分离，无重叠写
- 或快照时机协调（Succinix 周期避开 SunamAI export 的瞬间——但 750ms vs 2.5s 很难精确避开，推荐职责分离）

### R3. 刷新恢复端到端验证

**需求**：刷新页面后：工作区文件（agent 创建的项目）、/etc 状态（Succinix env/settings）、pip 装的纯 Python 包（.pyodide）都还在，且 agent 会话可恢复（revision 正确）。

### R4. 边界如实记录

若某类数据无法双层并存（如 node_modules 被两套都排除、二进制 .so 不持久），**如实标注到代码注释/文档**，不硬造。

## 保留项（不许改清单）

1. 两个 contracts 文件
2. 前端 UI 视觉
3. SunamAI 的 revision 体系语义（getWorkspaceRevision 的数字必须与之前一致——agent 验证证据依赖它）
4. Succinix host.js / PROTOCOL / 快照机制本身（WebUnix 侧不改；只改 SunamAI 侧的协调逻辑）
5. 不新增 npm 依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/persistence-and-snapshots.md`（sunam-v3 存储、守卫、隔离）+ `.trellis/spec/frontend/agent/checkpoint-and-recovery.md`
- 完成后跑 `npm run check:all`（含 test:runtime）
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji
- 参考既有实现：`snapshotCoordinator.ts` / `snapshotScheduler.ts` / `v3Repository.ts` / `v3RecordStore.ts` 全文；WebUnix 侧快照实现（`~/Desktop/MyProject/WebUnix/src/persist.ts` 只读参考）

## 质量门禁

1. `npm run check:all` 全绿
2. 真实浏览器（或 test:runtime）验证刷新恢复：创建文件 + 改 Succinix env + pip 装纯 py 包 → 刷新 → 三者都在
3. revision 语义不变（agent 验证证据测试全过）
4. 双写无丢失：连续操作后刷新，最近的文件修改都在
5. `git diff --check` 干净

## 约束

- 提交信息：`feat: M3 快照双层协调（SunamAI checkpoint 与 Succinix 文件快照并存）`
- 一次提交完成；不确定先读现有代码再动手
- 若"职责分离"方案需要 Succinix 侧改（如快照排除项），**先确认 WebUnix 侧改动面**（可以改 WebUnix 的 persist.ts 排除工作区，但要先读它确认快照范围和排除机制，且不能破坏 Succinix 自身自检）
