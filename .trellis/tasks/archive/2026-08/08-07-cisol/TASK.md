# TASK-CISOL — 进程归属标注 + 跨容器操作限制（容器隔离完善）

## 背景

M6 已做文件级隔离（c-* 独立目录），但进程是**全局共享**的：单一 Succinix host，`ps()` 返回所有容器的进程，跨容器 kill 无拦截。用户要求：**做好划分、标注、跨容器进程操作限制**——不同容器的 Agent 不能看到/干扰不属于自己容器的进程。非侵入（不改 @webcontainer/api 包，协议兼容扩展）。

## 物理边界

- `src/shared/contracts/agentRuntime.ts` / `terminal.ts` 的**现有字段一字不改**（本任务加的是**新增字段/新增行为**，不修改现有契约字段语义）
- 前端 UI 视觉零改动（ServicesPanel 分组是数据驱动渲染，不改样式）
- 不改 @webcontainer/api 包
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. Succinix host 进程归属标注（WebUnix 侧，协议兼容扩展）

`ps()` 响应给每个进程加归属字段（新增，不破坏现有字段）：
- `scope: 'system' | 'container' | 'unknown'`
- `containerId?: string`（scope=container 时）

**归属判定**：
- host 自身进程（host.js 主循环）/ python daemon / /usr/lib/succinix 路径启动 → `system`
- 命令带 `cd /workspace/c-<id> &&` 前缀启动（agent/用户终端命令）→ `container` + containerId（从 cwd 解析 `c-<id>`）
- 无法判定 → `unknown`

**实现位置**：WebUnix `src/engine/host-procs.ts`（进程表登记时记录 cwd/启动信息）+ `host.ts`（ps 响应组装归属字段）。重建 host.js（`node scripts/build-host.mjs`）。

### R2. SunamAI 查询过滤（按容器）

`getSuccinixProcesses(containerId)`：
- 只返回 `scope=system` + `scope=container && containerId=当前` 的进程
- `scope=unknown` → 返回但标记不可操作（见 R3）
- **容器 A 看不到容器 B 的进程**（测试断言）

### R3. 跨容器 kill 拦截

`stopProcessByPid(pid)` / `kill` 校验：
- `scope=system` → 拒绝（已有 protected，保持）
- `scope=container && containerId !== 当前容器` → **拒绝**（返回"进程属于其他容器"说明）
- `scope=unknown` → 拒绝（宁严勿松）
- 仅 `containerId === 当前容器` 的进程可 kill

### R4. UI 分组显示（ServicesPanel）

进程列表分三组：
- **系统进程**（scope=system）：protected 徽标，禁 stop，附说明"Succinix 运行时，关闭会破坏容器功能"
- **当前容器进程**（scope=container + 当前 containerId）：可 stop
- **未知归属**（scope=unknown）：折叠/灰显，不可操作

### R5. 边界如实

- 若 host 侧进程归属判定有盲区（如某些 Lifo 链进程 cwd 不可解析）→ 如实归 unknown 并标注
- 归属判定基于 cwd 前缀（启发式）——若有误判场景如实记录，不硬造

## 质量门禁（节选）

1. 两仓库 `npx tsc -b` 0 错
2. `npx vitest run tests/unit/` 全绿（新增：归属判定、查询过滤、kill 拦截）
3. **runtime 测试**（关键）：两容器进程互不可见 + 跨容器 kill 拒绝（真实 WC）
4. `npm run build` + check-bundle 通过
5. WebUnix 单测 118 全绿 + host.js 重建 + SunamAI 资产同步

## 提交

- WebUnix：`feat: 进程归属标注（scope/containerId，协议兼容扩展）`
- SunamAI：`feat: 跨容器进程隔离（查询过滤 + kill 拦截 + UI 分组）`
