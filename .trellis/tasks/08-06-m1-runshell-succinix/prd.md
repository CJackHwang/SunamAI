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
- 请求 id 用项目现有 `createId`（`@/shared/lib/ids`，如 `createId('succ')`）
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
