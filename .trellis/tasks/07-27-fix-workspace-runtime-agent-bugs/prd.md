# 修复工作区服务 i18n 与 Agent 卡死问题

## Goal

修复 WebContainer 工作区中的四类低频高干扰缺陷：文件页偶发显示错误/内部目录、开放端口无法由用户关闭、跨语言创建资源仍使用中文默认名，以及 Agent 工具结果返回后静默卡住不进入下一轮。

## Background

- `.sunam/workspaces/c-<uuid>` 是合法内部容器根目录（`src/shared/lib/containerPaths.ts:1-13`），截图中的 `css/`、`js/`、`index.html` 是正常项目内容。缺陷是异步导航竞争或展示兜底可能让文件面包屑泄漏内部/旧根路径；终端与进程区已经使用 `/containers/<容器名>` 展示规则（`src/features/file-manager/FileManagerToolbar.tsx:16-24`、`src/features/terminal-session/displayPaths.ts:1-18`）。
- 服务面板直接监听 WebContainer 全局 `server-ready`/`port` 事件，而停止能力来自另一套只记录 Agent `shell_run` 顶层句柄的内存 `ProcessRegistry`。用户终端绕过该注册表，端口与进程没有统一所有者，因此会出现“端口存在、进程数为 0”（`src/widgets/workspace/DualTerminal.tsx:78-121,129-141`、`src/features/runtime/processRegistry.ts:10-99`）。
- 会话、容器和首次工作区默认名硬编码为中文；空会话复用与首次消息判断也只识别中文名称（`src/entities/workspace/sessionStore.ts:5-37`、`src/entities/workspace/containerStore.ts:9-33`、`src/entities/workspace/repository.ts:4-13`、`src/widgets/workspace/Workspace.tsx:87-103`）。
- 工具结果持久化后，`AgentEngine.reflectTask()` 会同步等待工作区快照 flush、Run/计划事件和检查点保存，完成后才进入下一模型轮。该阶段没有独立超时竞速，运行总计时器也无法打断已经悬挂的 snapshot/IndexedDB await，所以 UI 可长期保持运行中（`src/features/agent-core/engine.ts:177-209,432-462`）。

## Requirements

### R1. 文件根目录一致性

- 保留现有容器隔离目录和快照格式，不迁移用户项目内容。
- 文件系统异步读取必须防止旧容器/旧目录请求在切换后覆盖新状态。
- 文件面包屑只能显示容器名称和项目相对路径；检测到越界或过期路径时回到当前容器根，而不是展示内部实现路径。

### R2. 可管理的服务与端口

- 服务生命周期由 runtime 统一管理，端口事件和进程记录不得继续分散在 UI 与 Agent runtime 两套状态中。
- 应用启动的 Agent 进程和用户终端 shell 必须登记启动 ID、来源、容器、句柄、状态、时间及关联端口。
- 对 Node 服务进行启动期端口登记：通过受控的 runtime preload 记录实际监听进程 PID、启动 ID、容器 ID、端口及关闭事件，不使用端口号猜测 OS 进程。
- 端口状态分为识别中、可管理、来源失联和停止中。正常停止使用已登记句柄或已登记 PID；若正常停止后端口未关闭，则转为来源失联。
- 来源失联端口显示明确警告和“强制重启关闭”动作。用户确认文案必须说明：将先保存工作区快照，再重启全局 WebContainer，并同时终止所有端口、终端进程和 Agent 后台进程。
- 强制重启不得静默执行；快照保存失败时必须中止重启并显示错误。

### R3. 本地化默认名称

- 中文、英文、日文分别定义默认会话名和默认容器名。
- 首次工作区、重置工作区、后续新建会话和容器均使用创建当下的界面语言。
- 空会话复用识别所有历史支持语言的默认名；用户自定义名称永不因切换语言而改变。
- 首次消息自动标题逻辑不能再依赖中文字符串比较。

### R4. Agent 轮次 watchdog

- 工具结果后的快照/Run/事件/检查点同步必须具有独立、有限、可取消的 watchdog。
- 同步成功时正常进入下一模型轮；同步失败或超时时进入带明确原因的可恢复失败终态，并保留最后成功的检查点。
- 失败状态必须先投影到 UI，再进行尽力而为的持久化，避免持久化本身悬挂时继续向用户显示运行中。
- 不削弱当前 completion gate、权威 revision、验证证据、进程所有权或取消边界。

### R5. 质量与兼容性

- 不新增数据库版本或迁移现有 `sunam-v3` 工作区记录。
- 服务登记中的进程句柄/PID 仅属于当前 WebContainer 生命周期，不作为可跨重启恢复的持久化权威信息。
- 补充单元、组件和真实 WebContainer 回归覆盖；更新架构、Agent runtime 规范和验收文档。

## Acceptance Criteria

- [x] 快速切换容器或目录、刷新和恢复后，文件列表与面包屑始终属于当前容器；用户界面不出现 `.sunam/workspaces/c-*` 或 `/home/sunam`。
- [x] Agent 启动和用户终端启动的 Node 服务能够被识别到实际监听进程，并在端口行通过停止按钮关闭；端口关闭事件后从列表移除。
- [x] 无法关联有效启动记录的端口被标记为来源失联，不伪装成普通可管理服务。
- [x] 来源失联端口的强制重启确认明确说明全局影响；快照成功后重启并关闭全部端口，快照失败时不重启且错误可见。
- [x] 中文、英文、日文下首次创建及后续新建的会话/容器使用对应语言；切换语言不改写已有自定义名称。
- [x] 延迟或永久悬挂工具后同步时，Agent 在 watchdog 到期后显示明确失败原因并允许恢复，不会无限保持运行中。
- [x] 正常“工具结果 → 检查点 → 下一模型轮”链路、completion gate、revision 验证及进程隔离回归保持通过。
- [x] `npm run check:all` 通过。

## Key Decisions

- 启动即登记是正常服务管理路径；全局 WebContainer 重启仅用于智能识别后的来源失联端口。
- 服务列表中的正常服务必须存在完整启动记录和停止所有权；来源失联属于历史遗留或异常损坏恢复状态，不能作为日常可接受状态。
- 使用 Node runtime preload 记录实际监听 PID/端口与启动 ID，而不是解析命令文本或依据端口猜 PID。
- runtime 与 WebContainer 生命周期保持单例一致，避免 React remount 产生空注册表包裹仍在运行的全局实例。
- 强制重启先 flush 全部快照；无法证明保存成功时 fail closed。
- 默认名称在工作区 store 中作为非持久化创建配置注入，持久化的仍只是最终字符串，保持 schema 兼容。
- Agent watchdog 覆盖整段轮次间同步，并优先更新内存/UI 失败状态。

## Out of Scope

- 不迁移或重命名已有用户资源。
- 不为非 Node 的未知监听器承诺精确 PID 管理；它们按来源失联流程处理。
- 不重新设计 Agent completion protocol、模型供应商协议或整个终端 shell 语义。
- 不允许未确认的全局 runtime 重启。

规划阶段已无阻塞问题。
