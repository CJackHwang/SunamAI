# TASK-M4 — Agent 工具列表重构 22→15（适配 Succinix 执行模型）

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **前端 UI/组件/样式零改动**（工具面板 UI 渲染逻辑不动，只改工具定义）。
- 不新增 npm 依赖。
- `.trellis/tasks/archive/` 禁止动。
- 全英文 UI 文案、无 emoji。

## 背景

M1-M3 完成：SunamAI 执行引擎已切到 Succinix（host.js 常驻 + 文件 RPC + 快照双层）。现在适配 Agent 工具列表——Succinix 提供真实 Unix（node/python/lifo + 进程表 + 端口），很多旧工具可以简化合并。

**现状 22 个工具**（`src/features/agent-core/tools/`）：
- 进程类 6：`shell_run` / `process_list` / `process_observe` / `process_input` / `process_stop` / `read_user_terminal`
- 工作区类 4：`workspace_tree` / `read_file` / `search_workspace` / `apply_patch`
- 资源类 4：`list_resources` / `read_resource_text` / `read_resource_image` / `materialize_resource`
- 控制类 5：`update_plan` / `report_progress` / `ask_user` / `ask_parent` / `complete_task`
- 子 agent 类 3：`spawn_subagent` / `wait_subagents` / `message_subagent`

**目标 15 个工具**：进程类 6→3（run_command / manage_process / read_user_terminal）、工作区类 4→3（删 apply_patch）、资源 4 + 控制 5 + 子agent 3 保留 = 12。

## 需求（逐条、可验收）

### R1. `shell_run` → `run_command`（改名 + 改描述 + 适配 Succinix）

- 名字：`run_command`（旧 `shell_run` 删除/替换）
- 描述改为：`Execute a terminal command in the Succinix sandbox (real Unix tools + Node.js + Python with pip). Foreground commands record their real exit status as verification evidence; choose a truthful, relevant check and never mask failures. Use background only for servers.`
- schema 不变：`{ command: string, mode: 'foreground'|'background', timeout_ms?: number }`
- 执行路径不变（已走 succinixClient.run，M1 完成）；capability 保持 `virtual-container`
- `readOnly: false` / `concurrencySafe: false` / `dataImpact: 'process'` 语义不变

### R2. `process_list` + `process_observe` + `process_input` + `process_stop` → `manage_process`（4合1）

- 新工具 `manage_process`，单一入口管理进程：
  - schema：`{ action: 'list'|'observe'|'stop'|'input', process_id?: string, cursor?: number, input?: string }`
  - `list`：列当前 session/container 的 agent 进程（原 process_list 语义，`accessibleProcesses`）
  - `observe`：增量输出 + 退出状态（原 process_observe，需要 process_id + cursor）
  - `stop`：终止进程（原 process_stop，需要 process_id；走 succinixClient.kill）
  - `input`：向交互进程发输入（原 process_input，需要 process_id + input；**Succinix 无交互 stdin 是物理边界，实现为返回 false/说明**——保持诚实，不假装）
- 描述：`Manage Agent-owned processes in the Succinix sandbox: list, observe output, stop, or send input. Call with action=list to discover process ids first. Note: interactive stdin is not supported in the Succinix sandbox (file-RPC replaces it); input actions return an explanation instead of failing silently.`
- capability：`virtual-container`，dependencies 从 `['shell_run']` 改为 `['run_command']`
- 删除旧 4 个工具的导出

### R3. 删除 `apply_patch`（用 run_command + Unix 工具替代）

- 删除 `apply_patch` 工具定义
- **替代说明**（写进 run_command 描述或工具注释）：文件写入用 `run_command` + heredoc/sed/node fs 更灵活（`cat > file << 'EOF'` / `sed -i` / `node -e "fs.writeFileSync(...)"`）
- **检查 `apply_patch` 的消费面**：grep `apply_patch` 全仓库——若 agent 提示词/工作流/测试引用了它，同步更新为 run_command 用法；若 UI 有 apply_patch 按钮（CapabilityRegistry 动态渲染则自动消失），确认无硬编码引用

### R4. 保留 12 个工具

- 工作区 3：`workspace_tree` / `read_file` / `search_workspace`（**保留不动**——cat/grep 可替代但保留结构化优势：行号/token 预算/结果结构）
- 资源 4：`list_resources` / `read_resource_text` / `read_resource_image` / `materialize_resource`（保留）
- 控制 5：`update_plan` / `report_progress` / `ask_user` / `ask_parent` / `complete_task`（保留）
- 子agent 3：`spawn_subagent` / `wait_subagents` / `message_subagent`（保留）
- `read_user_terminal` 保留（改名不改）

### R5. 工具注册表/依赖引用同步

- `processTools.ts` 里 `VIRTUAL_CONTAINER_WITH_SHELL` 的 dependencies 引用 `shell_run` → 改 `run_command`
- 其他模块若引用 `shell_run` / `apply_patch` / `process_list` 等旧名（prompt.ts / capability registry / 测试），全量 grep 同步更新
- 工具总数断言：注册表最终 = 15（如有静态清单/测试断言工具数，更新为 15）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. 前端 UI 视觉（工具面板/能力库 UI 渲染逻辑，CapabilityRegistry 自动反映工具变化即可）
3. agent 编排（prompt/子agent/资源/checkpoint——只改工具壳，不动引擎）
4. `manage_process` 的 action 语义与旧工具行为对齐（不新增权限/不改变所有权隔离）
5. 零新依赖

## 开发规范（Trellis，必须遵守）

- 读 `.trellis/spec/frontend/agent/capability-library.md`（工具 gate/能力声明/injection invariant）+ `.trellis/spec/frontend/agent/architecture-and-data-flow.md`
- 完成后跑**节选测试**（不跑全量 check:all）：`npx tsc -b` + `npx vitest run tests/unit/`（相关工具/注册表测试）+ 必要冒烟
- task.py 生命周期；代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（重点：capability/工具相关测试）
3. grep 旧工具名残留：`grep -rn "shell_run\|apply_patch" src/` → 0 匹配（除注释说明历史）
4. 工具注册表断言：15 个（如有静态测试）
5. 浏览器冒烟（可选，网络允许时）：dev server 起来 + 能力库面板显示工具数/名字变化
6. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——WebContainer boot 有网络 flake（stackblitz），单独测试过即可，全量留 V1 终审。

## 约束

- 提交信息：`feat: M4 工具列表重构 22→15（run_command / manage_process / 删 apply_patch）`
- 一次提交完成；不确定先读 `tools/` 目录全部文件 + capability-library spec 再动手
- 若发现 apply_patch 有 UI 或工作流硬编码消费（不只工具定义），如实标注并同步改（那属于本任务范围）
