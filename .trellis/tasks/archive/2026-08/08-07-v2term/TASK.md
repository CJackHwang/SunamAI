# TASK-V2TERM — 用户终端接入 Succinix 完整系统界面（自检 + guest 提示符 + 可输入）

## 背景（用户反馈的核心问题）

用户实测反馈：**SunamAI 容器启动后，用户终端不是 Succinix 的 guest 用户界面**——没有自检、没有系统界面、无法输入任何内容、无法操作。期望：终端启动时和 Succinix 项目看到的一致（boot 自检 → guest@succinix:~$ 提示符 → 可输入命令操作），只不过 SunamAI 里初始进入对应容器目录（c-<id>）。"Sunam的电脑"（AI 终端视图）才是专门显示 Agent 的操作和输出。

**现状根因**（已定位）：
- `WebContainerAgentRuntime.ts:36` `USER_SHELL_COMMAND = "node -e console.log('Succinix terminal ready');setInterval(()=>{},1e9)"`——用户终端 spawn 的是**假占位进程**（打印一行后空转 setInterval），不读 stdin、不执行任何命令 → 无法输入、无法操作
- 服务面板里的 `succinix-11` 进程就是这个占位进程（"Succinix terminal ready" 探活）

**目标**：用户终端 = 完整 Succinix 系统界面（整行命令模式，非 REPL stdin）：
1. boot 时显示 Succinix 系统横幅/自检（对齐 Succinix 项目：banner + self-test 摘要）
2. 显示 `guest@succinix:~$ ` 提示符（容器内）
3. **可输入**：整行命令（Enter 执行）→ 走 succinixClient.run（文件 RPC，复用 M1 链路）→ 输出回显 → 下一行提示符
4. 支持基础编辑：退格、Ctrl+C（中断/清行）、Ctrl+L（清屏）、空命令换行（对齐 Succinix main.ts handleData 逻辑）
5. 初始 cwd = 容器根（getContainerPublicPath(c-<id>)），cd 后提示符目录变化（如有）

**为什么可行**：Succinix 的终端是**整行命令模式**（每条命令独立 exec 文件 RPC，不是 REPL 进程等待 stdin）——这正是 AGENTS.md 说的 "Interactive stdin unreliable; file-based RPC replaces it" 的语义。SunamAI 的用户终端应该用同样的模式（xterm onData 整行 → succinixClient.run → 回显），而不是 spawn 假进程。

## 物理边界

- `src/shared/contracts/agentRuntime.ts` / `terminal.ts` 一字不改
- **UI 视觉零改动**（TerminalView 组件本身不动，只改数据源/交互逻辑；如需要微调对齐 Succinix 主题色，需谨慎——保持现有暗色主题，不引入大改）
- 不新增 npm 依赖
- `.trellis/tasks/archive/` 禁止动
- **不改 Succinix 侧**（WebUnix 不动；host 已支持 run/ps/cwd/setCwd，够用）

## 需求

### R1. 用户终端数据源替换（核心）

`WebContainerAgentRuntime.spawnUserShell` 不再 spawn 假占位进程——改为**暴露 Succinix 终端交互通道**：
- 新增（或改造）：用户终端输入整行命令 → `succinixClient.run(cmd, { cwd: 容器根 })`（复用 M1 链路）→ 返回 stdout/stderr/exitCode → 回显
- 提示符管理：`guest@succinix:<cwd>$ `（cwd 短路径如 `~` 或容器名）——**对齐 Succinix 的 promptStr 风格**
- 终端生命周期：容器 boot 后终端就绪（非 spawn 进程）；切换容器/刷新后重置

### R2. 终端交互逻辑（对齐 Succinix main.ts handleData）

在 TerminalView（或用户终端 hook）实现 Succinix 式交互：
- Enter：执行整行（`succinixClient.run`）→ 输出回显 → 提示符
- Backspace：删字符
- Ctrl+C：命令运行中标记 / 空闲清行
- Ctrl+L：清屏
- 空命令：换行提示符（不发 host）
- 命令运行中（busy）再输入：排队或提示（对齐 Succinix queue 语义，简化版）
- Tab 补全：暂不支持（对齐 Succinix）

### R3. boot 横幅 + 自检（对齐 Succinix 启动体验）

- 终端就绪时显示 Succinix 系统横幅（版本 `Succinix 0.2.0 — kernel...`，对齐 main.ts:32 风格）
- 自检摘要：Succinix self-test（76 passed）——容器内 `succinix` 自检命令或 host 就绪信号，**显示摘要**（如 `[  OK  ] 76 checks passed`）——**评估**：自检是否已在 host boot 时跑（M3 的 succinixLayer 测试提到 host 就绪），若 host boot 已自检则直接显示结果，否则触发一次
- 提示符随后出现

### R4. 初始目录 = 容器根

- 终端初始 cwd = `getContainerPublicPath(containerId)`（`/home/workspace/c-<id>`）
- `cd` 命令改变后续命令的 cwd（succinixClient 的 setCwd 或每命令 cwd 参数）
- 提示符显示当前目录（短路径）

### R5. 边界如实

- REPL 类交互进程（python 交互式、node REPL）仍不可用（WC 物理边界，AGENTS.md 明确）——**如实标注**：终端是整行命令模式，交互式 REPL 进程不支持（输入 python 会进入但无法交互，标注说明）
- 若某些 Succinix 命令（Lifo 链）输出带 \r\n，走 V1 H1-1 已修的 POSIX 规范（host 侧已修）

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（新增：终端交互逻辑单测——整行命令路由、提示符生成、cwd 跟随、Ctrl+C/L 处理）
3. `npm run build` + check-bundle 通过
4. **浏览器实测（核心验收）**：dev server 起 → 容器 boot → 终端视图显示 Succinix 横幅/自检/`guest@succinix` 提示符 → **输入命令（ls/cd/echo/node --version）→ 输出回显** → 提示符跟随 cwd
5. runtime 测试不回归（`npx playwright test --config playwright.runtime.config.ts` 关键用例）

## 提交

`fix: 用户终端接入 Succinix 完整系统界面（自检 + guest 提示符 + 可输入命令）`
