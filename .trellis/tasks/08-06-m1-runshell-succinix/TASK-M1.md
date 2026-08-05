# TASK-M1 — SunamAI runShell 底层替换：WebContainer jsh → Succinix TerminalExecutor

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 的 `AgentWorkspaceRuntime` 接口一字不改**（含 `ShellRunRequest`/`ShellRunResult`/`ProcessStatus`/`ProcessOwnership` 全部类型）——这是 SunamAI 架构的唯一边界（`.trellis/spec/frontend/foundation/architecture-and-boundaries.md`：Agent Core 不得 import `@webcontainer/api`、终端组件或具体 runtime 类）。
- **前端 UI/组件/样式零改动**（不碰 widgets/、xterm 相关、CSS）。
- 不新增 npm 依赖（纯 TypeScript 实现，文件 RPC 用现有 `@webcontainer/api` 的 `wc.fs`）。
- 不删改 SunamAI 现有 agent 编排逻辑（prompt/子agent/压缩/checkpoint 均不动——那是后续 TASK）。
- `.trellis/tasks/archive/` 历史记录禁止动。
- 全英文 UI 文案、无 emoji（遵循 SunamAI 现有规范）。

## 背景

SunamAI 目前用裸 WebContainer 执行 agent 命令：`WebContainerAgentRuntime.runShell()` → `serviceRegistry.spawn()` → `this.webcontainer.spawn('jsh', ['-c', cmd])`。jsh 是 WebContainer 的 JS shell（模拟 POSIX，能力弱、与真实 Linux 语义有差异）。

Succinix（浏览器原生 Linux，`~/Desktop/MyProject/WebUnix`，MIT）提供成熟的执行引擎：WebContainer 内常驻 `node host.js`（TerminalExecutor），通过**文件 RPC** 协议执行命令，统一路由 node|npm|npx → 真 Node 子进程、python|python3 → Pyodide daemon、其余 → Lifo Unix 沙箱，含 shell 融合（`&&`/`|`/`>`/`2>&1` 等元字符按 Linux 语义解析）。

**本任务：把 SunamAI 的执行引擎从裸 jsh 换成 Succinix TerminalExecutor，用户/agent 可见行为不变。**

## 文件 RPC 协议（Succinix 权威契约，来自 docs/PROTOCOL.md，不要改）

- **通道**：浏览器写 `/cmd.json`（单文件信箱，一次一个请求）→ host 轮询（50ms）→ 写 `/result-<id>.json`（**每请求独立结果文件**）→ 浏览器读到即删。
- **请求格式**（`/cmd.json`）：
```json
{ "id": "<uuid>", "cmd": "run", "opts": { "command": "ls -la", "timeout": 30000 } }
```
  - `cmd` ∈ `run | spawn | ps | kill | cwd | setCwd | ping | exit`
  - `run`：执行一条命令（统一路由）；`spawn`：后台长驻进程（node 系）；`ps`：进程表；`kill`：终止真实子进程（opts.pid）；`cwd`：会话工作目录；`setCwd`：显式设置（opts.cwd）；`ping`：存活探测。
- **响应格式**（`/result-<id>.json`）：
```json
{ "id": "<uuid>", "ok": true, "exitCode": 0, "stdout": "...", "stderr": "...", "runtime": "node|lifo|python" }
```
  - `run` → `{ ok, exitCode, stdout, stderr, runtime }`
  - `spawn` → `{ ok: true, pid, runtime: "node" }`（立即返回，子进程退出时异步再写 result）
  - `ps` → `{ ok, kind: "ps", processes: [{ pid, cmd, status, startTime, exitCode?, outputTail? }] }`
  - `kill` → `{ ok, killed, message }`
  - `cwd` → `{ ok, kind: "cwd", cwd }`
- **写入路径**：浏览器 `wc.fs` 根 == node 进程 cwd。**文件 RPC 文件写在容器根**（即 `/cmd.json`、`/result-<id>.json`，通过 `wc.fs.writeFile('/cmd.json', ...)` 写入，浏览器视角的 `/` 就是容器根）。
- **超时**：`opts.timeout` 毫秒，host 侧超时杀进程（不给时用 host 默认：node 系 NODE_TIMEOUT_MS、python PYTHON_TIMEOUT_MS、其余 LIFO_TIMEOUT_MS）。
- **清理**：host 定期 prune 陈旧 result-*.json（TTL ~120s）。

## 需求（逐条、可验收）

### R1. 新增 `src/features/runtime/succinixClient.ts`

文件 RPC 客户端，封装 Succinix TerminalExecutor 协议。导出：

```ts
export interface SuccinixRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  runtime?: 'node' | 'lifo' | 'python';
  timedOut: boolean;
}

export interface SuccinixProcessEntry {
  pid: number;
  cmd: string;
  status: string;
  startTime: number;
  exitCode?: number;
  outputTail?: string;
}

export class SuccinixClient {
  constructor(fs: FileSystemAPI); // wc.fs

  /** 执行命令（统一路由），等待完成返回 */
  async run(command: string, opts?: { timeoutMs?: number }): Promise<SuccinixRunResult>;

  /** 后台启动 node 系长驻进程，立即返回 pid */
  async spawn(command: string, opts?: { timeoutMs?: number }): Promise<{ ok: boolean; pid: number }>;

  /** 进程表 */
  async ps(): Promise<SuccinixProcessEntry[]>;

  /** 终止进程 */
  async kill(pid: number): Promise<{ ok: boolean; killed: boolean; message: string }>;

  /** 会话工作目录 */
  async cwd(): Promise<string>;

  /** 显式设置会话工作目录 */
  async setCwd(cwd: string): Promise<{ ok: boolean }>;
}
```

实现要点：
- 请求 id 必须数字且严格递增（host 忽略非数字 id——`typeof req.id !== 'number'` 直接 return，权威协议 docs/PROTOCOL.md:38；不要用 `createId` 字符串）。`SuccinixClient` 内部维护自增数字 id，并做单实例共享注释（/cmd.json 单槽信箱，同一容器多个 client 实例会丢请求）。
- 写 `/cmd.json` → 轮询 `/result-<id>.json`（间隔 50ms，超时 = opts.timeoutMs + 缓冲 5s）→ 读到后 `wc.fs.rm` 删除结果文件
- `run` 的 `timedOut` 判定：host 返回 timeout 相关 stderr/exitCode 或轮询超时 → `timedOut: true`
- 写请求前先清理可能残留的旧 `/cmd.json`（`wc.fs.rm('/cmd.json', { force: true })` 容错）
- 注意 `wc.fs` API 是 SunamAI 现有用法（`workspaceFileSystem.ts` 里已有 `readFile/writeFile/readdir/rm/mkdir` 用法可参考）

### R2. 改 `src/features/runtime/serviceRegistry.ts` 的 spawn 对接

现状：`spawn()` 用 `this.webcontainer.spawn(request.command, request.args, { env, cwd })`（jsh 进程 + NODE_OPTIONS hook 注入）。

需求：**`ManagedSpawnRequest` 语义保留**（source/containerId/command/args/cwd/env/processId/sessionId/runId），但底层执行改为：
- `run` 语义请求（`source: 'agent'` + args 含 `-c` 组合的命令）：组装完整命令字符串 → `succinixClient.run(cmd)` → 返回适配后的进程对象（见 R3 适配层）
- `spawn` 语义请求（后台 node 服务）：`succinixClient.spawn(cmd)` → 返回 `{ launchId, pid }` 结构
- **端口事件**（`server-ready`/`port` 监听、openPort/closePort、stopPort）**本任务保留不动**（端口对齐是 M2，别提前改）

### R3. 改 `src/features/runtime/WebContainerAgentRuntime.ts`

现状：
- `runShell()`（163-200行）：`services.spawn({ command: 'jsh', args: ['-c', request.command], ... })` → `process.output.pipeTo(...)` 累积输出 → `process.exit` → ProcessStatus
- `spawnUserShell()`（131-140行）：`services.spawn({ command: 'jsh', ... })` 返回用户终端进程
- `stopProcess()` / `sendProcessInput()` / `observeProcess()`：走 ProcessRegistry + WebContainerProcess

需求（**AgentWorkspaceRuntime 契约不变**）：
- `runShell(request)`：底层换 `succinixClient.run(request.command, { timeoutMs })`。返回 `{ process: ProcessStatus, timedOut }`——ProcessStatus 字段语义保持：`id`（用 request 现有 createId('proc') 流程）、`command`、`isRunning: false`、`output`（stdout+stderr 合并，截断 MAX_PROCESS_OUTPUT=20000）、`exitCode`、`cursor`
- `spawnUserShell(containerId)`：保持返回结构（launchId + process），但 process 底层是 Succinix 后台进程——用户终端交互能力受限为"读输出"（Succinix 无交互 stdin，物理边界）；实现为 spawn 后通过 `succinixClient.ps()` 观察
- `stopProcess`：`succinixClient.kill(pid)` 替代 `process.kill()`
- `sendProcessInput`：**Succinix 文件 RPC 不支持交互 stdin（已验证物理边界）**——返回 `false`（进程已退出/不可输入），进程工具层已有对应容错（M4 才改工具，本任务保持 observe 语义）
- `observeProcess` / `getProcesses`：ProcessRegistry 数据源改为 Succinix `ps()` 映射（进程 id 用 SunamAI 侧 launchId 对应 host pid 的映射表，或直接映射 host pid——实现自定但保持 ProcessStatus 字段）
- 进程注册表（ProcessRegistry）保留：它承载 session/run 所有权隔离，不能删

### R4. `WorkspaceFileSystem`（`workspaceFileSystem.ts`）不动

文件系统层继续用 `wc.fs`（Succinix 与浏览器共享同一文件系统树），**零改动**——这是迁移的最小化关键。

## 保留项（不许改清单）

1. `src/shared/contracts/agentRuntime.ts` 全部类型/接口
2. 前端 UI/组件/样式（widgets/、terminal-session/）
3. `WorkspaceFileSystem` 文件系统层
4. snapshotCoordinator / snapshotScheduler / v3Repository（快照双层是 M3）
5. agent-core 编排（prompt、subagent、compaction、resources）
6. serviceRegistry 的端口监听/预览 URL 逻辑（M2 再做）
7. 不新增 npm 依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/foundation/architecture-and-boundaries.md` + `.trellis/spec/frontend/agent/process-lifecycle.md` + `.trellis/spec/frontend/agent/workspace-namespace.md`，按叶子规范实现
- 完成后跑 `npm run check`（如涉及 release 级变更则 `npm run check:all`）
- 遵循 `.trellis/workflow.md`：任务生命周期用 `python3 ./.trellis/scripts/task.py`（create/start/finish）管理（如平台可用）
- 代码注释中文、标识符英文、TS strict、无 emoji、全英文 UI 文案

## 质量门禁

1. `npm run check` 通过（含 typecheck/lint/architecture/coverage/build/bundle）
2. **本地 `npm run dev` 可启动**（浏览器环境）
3. agent 任务实测（dev server + 浏览器或 headless）：
   - `node --version` → 22.x
   - `npm install && npm run build`（小型项目）成功
   - `python -c "print(6*7)"` → 42（如 python 资产可注入）
   - `node -e "console.log(21*2)" | grep 42` → 42（管道融合）
4. exit code / stdout / stderr / 超时语义正确（foreground 命令记录真实 exit）
5. 既有 Vitest 单测全绿（如测试涉及 runtime 需适配的，改测试断言但**不改被测契约语义**）
6. `git diff --check` 无空白错误

## 约束

- 提交信息：`feat: runShell 底层替换为 Succinix TerminalExecutor（jsh → 文件 RPC）`
- 一次提交完成；如拆多 commit 按逻辑分（client 新增 / registry 对接 / runtime 替换）
- **不确定的地方先看现有代码**（serviceRegistry.ts 全文、WebContainerAgentRuntime.ts 全文、workspaceFileSystem.ts 用法），再动手；不要凭想象实现

## 复审修复项（2026-08 只读审查 agent 发现，H1 必修）

编码 agent 完成初版（commit 16c25da）后，只读审查 agent 核对发现以下问题。**全部修复后再提交**：

### H1-1. Succinix host 守护进程从未被 boot（最高优先）

**问题**：全仓库没有任何代码在 WebContainer 里启动 `node host.js`（TerminalExecutor）——`succinixClient` 写 `/cmd.json` 但没有任何进程消费它。真实环境所有 run/spawn/ps/kill 轮询到超时（`timedOut:true`），端到端功能不存在。

**修复**：
- 参考 `~/Desktop/MyProject/WebUnix` 的 boot 流程：host.js + lifo-core.js 是构建产物（`public/host.js`、`public/lifo-core.js`），浏览器侧把 host.js 注入容器后 `spawn('node', ['host.js'])` 启动常驻进程
- SunamAI 侧新增 host 注入/启动逻辑（可在 `webcontainer.ts` 的 `WebContainer.boot` 之后，或 `WebContainerAgentRuntime` 构造时）：把 Succinix host.js 资产写入容器（`wc.fs`），spawn node 进程常驻，等待 `/cmd.json` 可被消费（ping 探活）
- host.js 资产来源：构建时从 `~/Desktop/MyProject/WebUnix/public/host.js` 复制到 SunamAI 的 public 资产目录（或本地路径），boot 时懒注入
- **门禁**：真实浏览器环境（非 mock）`succinixClient.run('node --version')` 返回真实版本号而非 timedOut

### H1-2. Lifo 路由命令的 timedOut 判定为假

**问题**：客户端只在 stderr 上跑正则 `/timed out|timeout/i`，没看 exitCode。Lifo 超时以 `exitCode: 130` + 空 stderr 结算（`@lifo-sh/core` AbortError → 130，host 原样透传），导致任何非 node/python 前缀命令或含管道的 node 命令超时后 `timedOut:false`。

**修复**：`succinixClient.run` 的 `timedOut` 判定加入 exitCode 分支——`exitCode === 130` 或 stderr 含 timeout 消息或轮询超时 → `timedOut: true`。对齐 TASK-M1 R1 "timeout 相关 stderr/exitCode 或轮询超时 → timedOut:true"。

### M-1. cwd/env 被静默丢弃（agent 命令在错误目录执行）

**问题**：原 jsh 路径 `spawn('jsh', ['-c', cmd], { cwd: getContainerRoot(containerId), env: { HOME, SUNAM_WORKSPACE } })`。现路径用 host 单一会话 cwd（= workdir 根），`ManagedSpawnRequest.cwd/env` 保留在接口但执行时丢弃——多容器隔离被打破。

**修复**：run 前按 containerId `setCwd(getContainerRoot(containerId))`（succinixClient 加 setCwd 调用；或 run 命令前缀 `cd <containerRoot> &&`）；env 至少透传 SUNAM_WORKSPACE（可通过 setCwd 后 host 合并 env 或命令内 export）。

### M-2. spawnUserShell 退化为死终端（与规格不符）

**问题**：实现是 spawn 常驻 `node -e "...setInterval..."` + 输出流只放 "Succinix terminal ready." 后立即 close，没有按 R3 用 `succinixClient.ps()` 轮询观察。

**修复**：按 R3 实现 ps() 输出轮询（轮询 host 进程表观察用户 shell 进程输出尾部）；或明确降级为"横幅终端"并在代码注释标注（Succinix 无交互 stdin 是物理边界，但机制要与规格一致）。

### M-3. 后台进程输出为空 + NODE_OPTIONS hook 死代码

**问题**：后台 spawn 输出流立即 close，outputTail 为空（注释推给 M5）；NODE_OPTIONS hook 注入已从 spawn 移除但 SERVICE_HOOK_SOURCE/event watcher 整套保留成死代码。

**修复**：后台进程输出同步 outputTail（或用 host ps() 的 outputTail 字段映射）；清理死掉的 hook 机制或注释注明 M2 再动。

### L-1/L-2. 记录 id 数字化正确性 + 多 client 防护

**修复**：TASK 记录注明"请求 id 必须数字且严格递增（host 忽略非数字 id，权威协议 docs/PROTOCOL.md:38）"；SuccinixClient 加单实例共享注释（多 client 同容器会丢请求）。

修复后重跑全部质量门禁（`npm run check` + 真实浏览器实测：node --version / npm install / python / 管道 / 超时判定 / 多容器目录隔离），再提交。提交信息：`fix: TASK-M1 复审修复（host boot + timedOut 判定 + cwd/env 透传 + 终端观察）`

## 复审二轮修复项（2026-08 复审 agent 再发现，N1/N2 必修）

初版修复（5a8629b）已通过复审确认 5 项全落实 + 端到端 boot 实证，但复审又发现以下问题。**全部修复后再提交**：

### N1. 运行时冒烟测试为红（门禁不绿，必修）

**问题**：用户终端交互 stdin 是 no-op（物理边界），`test:runtime` 的 `webcontainer.smoke.spec.ts:160-162` 向终端输入 `pwd` 期望输出路径——实测 100s 超时，`check:all` 门禁红。

**修复**：更新冒烟测试以匹配"读输出"边界——断言终端横幅 "Succinix terminal ready" 出现 + 用 agent 路径（runShell）验证 cwd/env 语义；或显式标注跳过终端交互段（注明物理边界原因）。

### N2. sync-succinix-assets 未接线（部署/全新克隆链路断，必修）

**问题**：`scripts/sync-succinix-assets.mjs` 未挂进 `predev`/`prebuild`/CI（package.json scripts、`.github/workflows/quality.yml` 均无引用），且 `public/succinix/` 被 gitignore。全新克隆/部署 → `/succinix/host.js` 404 → boot 直接抛错。

**修复**：把 sync-succinix-assets 接进 `predev`/`prebuild` 脚本 + CI（quality.yml 的 check/build 步骤前）；确保全新克隆后 `npm install && npm run dev` 能自动同步资产并 boot 成功。

### N3. boot 失败路径：超时数学错 + host 泄漏（低-中，建议修）

**问题**：`succinixHost.ts:56-62` `attempts=60` 意图 6s，但每次 ping 走 doExec 截止 = 5s+5s = 10s/次，最坏挂 ~600s；`waitForHostReady` 抛错时 `hostProcess` 未被 kill，重试会拉起第二个 host 争抢 `/cmd.json`（id 冲突）。

**修复**：修正超时数学（ping 用短超时或独立 deadline 6s）；抛错路径 kill hostProcess 防重复 host。

### N4/N5/N6（低，尽力修）

- **N4**：host 崩溃看门狗自动重启（运行中 host 死 → 全部 RPC 超时，只能整体重启 runtime）
- **N5**：cd 前缀使 run 全部走 Lifo 混合链（runtime 标 'lifo'、node 默认超时 25s），代码注释说明
- **N6**：`tailDelta` 补单测；后台服务端口检测补实证

修复后重跑 `npm run check:all`（含 `test:runtime` 必须绿）。提交信息：`fix: TASK-M1 复审二轮（冒烟测试对齐读输出边界 + 资产同步接线 + boot 失败路径）`
