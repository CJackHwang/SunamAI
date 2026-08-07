# TASK-V1FIX — V1 大审计 H1 修复（真实容器链路闭环）

## 背景

V1 项目大审计（只读终审 agent）发现 M 线 3 个 H1 必修项——真实 WebContainer 链路未达标。全部修复后重跑 runtime 测试确认全绿。

## 物理边界

- `src/shared/contracts/agentRuntime.ts` / `terminal.ts` 一字不改（M/P 全系列已验证 0 改动，保持）
- UI 视觉零改动
- 不新增 npm 依赖
- `.trellis/tasks/archive/` 禁止动

## H1-1：echo 输出 CRLF（Lifo 混合链 shell 语义）

**问题**：`tests/runtime/webcontainer.smoke.spec.ts:192` 断言 `from-agent.txt` = 17 B（`echo shared-agent-file >` 16 字符 + LF），实际 18 B——强烈指向 Lifo 混合链 echo 输出 CRLF（`\r\n`）。影响：任何 `echo > file`/heredoc 落盘的文件每行多 1 字节，破坏校验和/diff/verification。

**定位**：Succinix host 的 Lifo 混合链（`/Users/mac/Desktop/MyProject/WebUnix/src/engine/host.ts:620` 附近，"Lifo sandbox：Unix 工具（echo...）"）——echo 经 Lifo 执行输出 \r\n 而非 \n。

**修复**（WebUnix 侧）：
1. 复现：写个最小测试（真实 WC 或 host 单测）确认 `echo hi > file` 落盘内容字节
2. 修复 Lifo 混合链的输出规范化：Lifo 工具输出/重定向落盘时把 `\r\n` → `\n`（保持真实 POSIX 语义）——**定位到具体转化点**（Lifo 输出写 wc.fs 的地方）
3. WebUnix 侧补单测：echo > file 落盘 = N 字符 + LF（无 CR）
4. 重建 host.js（`node scripts/build-host.mjs`），SunamAI 同步资产（`node scripts/sync-succinix-assets.mjs`）

**注意**：修复点必须在**输出落盘前**（不是显示层），确保文件内容真实 POSIX；显示层的 CRLF 处理不影响文件字节。

## H1-2：前台/Lifo 进程不进进程表（M5 缺口）

**问题**：`WebContainerAgentRuntime.getSuccinixProcesses`（`src/features/runtime/WebContainerAgentRuntime.ts:353-380`）只合并 host ps() + ProcessRegistry（仅 succinixPid 非 null 的）。前台 run_command（`-c` 分支 → createRunShim，succinixPid: null）+ 带 `cd &&` 前缀的命令走 Lifo 混合链 → Lifo 拉起的 node 子进程不登记 host processTable → ps() 查不到。**绝大多数前台 agent 命令在 M5 进程界面不可见**。

**修复**（SunamAI 侧）：
1. 前台 run 的进程也要可观测：run 完成/运行中时，把进程信息补进可观测集合（如 run 返回的 pid/进程行，进 ProcessRegistry 或 UI 进程表）
2. Lifo 混合链的子进程：host 侧 `ps()` 需包含 Lifo 拉起的活跃 node 子进程（WebUnix 侧 host-procs.ts 检查——Lifo 子进程是否可登记）；或 SunamAI 侧如实标注"Lifo 链进程仅显示不管理"
3. **至少**：UI 进程表显示前台 run 进程（有 pid/命令/状态），kill 语义如实（能 kill 的走 kill，Lifo 链不能 kill 的标注）
4. 补 runtime 测试：前台 `run_command npm test`（常驻）后，服务面板进程行 > 0

**诚实边界**：若 Lifo 链子进程在 host 侧确实无法登记（架构限制），如实标注"Lifo 混合链进程不可管理（只读显示或隐藏）"，不硬造 kill 能力——但**前台 run 进程至少要在 UI 可见**。

## H1-3：CI 门禁不覆盖真实容器链

**问题**：`.github/workflows/quality.yml` 无 `test:runtime`；`npm run check` 不含它——真实 WC 链路从未被门禁拦截。`sync-succinix-assets.mjs` 在无 WebUnix 的 CI 克隆静默跳过 exit 0 → CI 构建无 host.js。

**修复**（SunamAI 侧）：
1. `sync-succinix-assets.mjs`：无 WebUnix 检出时**显式 fail**（exit 非 0 + 明确报错）——或从 npm 拉 `@succinix/engine` 资产（`packages/engine/assets/host.js`）——**二选一，优先 npm 资产拉取**（CI 可 install @succinix/engine 拿 ./host.js）
2. `npm run check`（或 check:all）纳入 `test:runtime`——**评估**：runtime 测试慢（真实 WC 40-60s/个 × 4），放进 check:all 合适；若放 check 太慢，至少 check:all 必须含
3. CI workflow 加 runtime job（或并入现有 job，网络允许时）

## 门禁（全部修复后）

1. `npx tsc -b` 0 错（两仓库）
2. `npx vitest run tests/unit/` 全绿（两仓库）
3. **`npx playwright test --config playwright.runtime.config.ts` → 4/4 全绿**（smoke 2 修好 + succinixLayer + containerIsolation）
4. `npm run build` + `check-bundle` 通过
5. WebUnix 侧 `npm run test`（118 单测）全绿 + host.js 重建
6. `git diff --check` 干净

**注意**：e2e/visual 全量仍留 V1 终审后（网络 flake），但 runtime 必须全绿——这是本任务的验收核心。

## 提交

- SunamAI：`fix: V1 审计 H1 修复（CRLF 语义 + 前台进程可见 + CI 容器链门禁）`
- WebUnix：`fix: V1 审计 H1-1 修复（Lifo echo 输出 CRLF → POSIX LF）`
- 跨仓库协作：先 WebUnix 修 CRLF + 重建 host.js → SunamAI 同步资产 → 修 H1-2/H1-3 → 全量 runtime 验证
