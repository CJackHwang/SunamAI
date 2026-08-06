# TASK-M7 — 命名统一：面向用户的 WebContainer 文案 → Succinix

## 物理边界（不许越界硬造）

- **`src/shared/contracts/agentRuntime.ts` 与 `src/shared/contracts/terminal.ts` 接口一字不改**。
- **代码标识符/API/文件名/内部注释一律不改**：`WebContainerAgentRuntime.ts`（文件名）、`webcontainer.workdir`、`getContainerRoot`、`WebContainer.boot` 等——这些是代码事实，改了会破坏引用/契约，**不属于本任务**。
- **只改面向用户（agent 感知/UI 展示）的文案**：能力库描述、i18n 文案、agent 系统提示词中描述"容器环境"的措辞、错误消息、UI 可见文本。
- 前端 UI **样式/布局零改动**（只改文案字符串）。
- 零新依赖。

## 背景

SunamAI 技术栈已切到 Succinix（M1-M6）。但面向用户的文案仍说"WebContainer 环境"——用户感知应统一为 Succinix。命名规则：
- **主品牌**：Succinix（用户可见文案）
- **小字注明**：能力库等位置用括号注明 `(Container environment)` 或中文 `（容器环境）`——因为底层确实是容器，诚实标注

## 需求（逐条、可验收）

### R1. 能力库/工具描述文案

- `prompt.ts` 中描述容器/终端能力的措辞：`WebContainer` → `Succinix`（或合理上下文措辞）
- 工具描述（processTools/workspaceTools 等）里若提到 WebContainer 环境 → Succinix
- 能力库 UI 的"虚拟容器 WebContainer：文件、终端、进程与服务"类描述 → "虚拟容器 Succinix：文件、终端、进程与服务（容器环境）"

### R2. i18n 文案（zh-CN / en-US / ja-JP）

- 三语 i18n 文件（`src/shared/i18n/locales/`）中用户可见的 "WebContainer" → "Succinix"
- 注意：**只改用户可见文案**；若某条 i18n 文案被测试断言，同步更新测试期望

### R3. 错误消息/提示

- 面向 agent/用户的错误消息、提示文本中 "WebContainer" → "Succinix"

### R4. 不改清单（显式排除）

- `WebContainerAgentRuntime.ts` 文件名/类名（代码标识符）
- `webcontainer.` API 调用（@webcontainer/api 是真实依赖）
- `src/shared/lib/webcontainer.ts` 内部实现
- contracts 里的类型/字段名
- 文件/目录名（workspaceFileSystem.ts 等）
- 内部注释中的技术描述（可保留"基于 WebContainer"的诚实说明——实际上 SunamAI 底层仍是 WebContainer，Succinix 跑在 WC 里；**注释保留技术事实，文案面向用户**）

## 保留项（不许改清单）

1. 两个 contracts 文件
2. UI 样式/布局
3. 代码标识符/API/文件名
4. 内部技术注释（如实说明底层仍是 WebContainer 是诚实的——不要过度宣称）
5. 零新依赖

## 开发规范（Trellis，必须遵守）

- 完成后跑**节选测试**：`npx tsc -b` + `npx vitest run tests/unit/`（相关 i18n/测试）
- 代码注释中文、标识符英文、TS strict、无 emoji

## 质量门禁（节选，不跑全量）

1. `npx tsc -b` → 0 错误
2. `npx vitest run tests/unit/` → 全绿（i18n/提示词相关测试）
3. **grep 验证**：`grep -rn "WebContainer" src/features/agent-core/prompt.ts src/shared/i18n/ src/features/runtime/CapabilityAwareRuntime.ts` → 用户可见文案 0 残留（代码标识符/API 调用/技术注释允许）
4. 能力库 UI 描述含 Succinix + （容器环境）小字
5. `git diff --check` 干净

**注意**：e2e/visual 全量不跑——网络 flake 留 V1。

## 约束

- 提交信息：`feat: M7 命名统一（面向用户文案 WebContainer → Succinix，小字注明容器环境）`
- 一次提交完成；**不确定某处该不该改**：问自己"这是用户/agent 看到的吗？"——是→改；否（代码/API/注释技术事实）→留
- 先 grep 全部 WebContainer 引用，逐个分类（用户可见 vs 代码标识符），只改前者
