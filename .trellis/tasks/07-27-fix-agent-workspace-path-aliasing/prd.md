# 修复 Agent 工作区路径平行世界

## Goal

让主 Agent、子 Agent、用户终端和文件管理器在同一个真实、稳定、可操作的容器目录中工作，消除“展示路径”和“实际写入路径”分离造成的平行目录与不可见交付。

## Background

- 严重性为 P0：当前缺陷会让 Agent 声称已写入文件，但用户在本容器终端的目标目录中看不到结果，直接破坏任务交付可信度。
- 截图中的 Agent 进程位于 `/home/sunam/.sunam/workspaces/c-<id>`，却把目标 `home/user/story-project` 作为相对路径写入，最终形成 `<containerRoot>/home/user/story-project`；用户终端访问 `/home/user/story-project` 时看到的是另一份目录。
- 当前实现把 `.sunam/workspaces/<containerId>` 作为真实根，却把用户终端输出替换成不存在的 `/containers/<容器名>`。文件管理器也只显示该逻辑路径。显示路径不能被 shell 真实访问，是根因而不只是提示词问题。
- `resolveContainerPath()` 还会无条件剥掉任意前导 `/`，因此 `/home/user/a` 会被静默解析成 `<containerRoot>/home/user/a`；现有测试没有覆盖伪绝对路径或重复根。
- WebContainer 只允许进程 `cwd` 位于其 workdir 内，不能把项目真实根直接放在系统级 `/containers/...`。项目必须在 WebContainer workdir 下建立公开且真实的规范根。
- 多个 Sunam 容器可以同时保留 Agent 进程和快照，因此公开路径必须绑定不可变 `containerId`，不能绑定可重命名或可能重复的容器名称。

## Requirements

### R1. 真实且统一的公开根

- WebContainer 的公开 workdir 使用 `workspace`，每个容器的唯一规范路径为 `/home/workspace/<containerId>`。
- `/home/workspace/<containerId>` 必须是真实文件系统路径，不是 UI 字符串替换；Agent shell 与用户终端中的 `pwd`、绝对路径和相对路径必须指向同一目录。
- 主 Agent、探索型子 Agent、任务型子 Agent、用户终端、文件管理器、资源物化、快照、服务进程和 revision watcher 必须共享该容器根。
- 容器名称只作为人类可读标签显示；重命名容器不能改变路径、终止进程或迁移文件。

### R2. 路径边界与工具语义

- Agent 文件工具接受工作区相对路径，以及当前容器规范绝对路径 `/home/workspace/<currentContainerId>/...`。
- Agent 文件工具拒绝 `/home/user/...`、`home/user/...`、旧 `.sunam/workspaces/...`、旧伪路径 `/containers/...`、其他容器根及任何 `..` 路径，不得将其静默重解释为当前根下的普通目录。
- 拒绝信息必须返回当前规范根和可操作的相对路径修复方式。
- 工具结果、Agent 系统提示词、Agent 终端和用户终端不得暴露旧内部项目根 `.sunam/workspaces/<id>`。

### R3. Shell 环境一致性

- 主 Agent、任务型子 Agent和用户终端均以当前容器真实根作为 `cwd`，将 `SUNAM_WORKSPACE` 设置到同一规范根；`HOME` 统一指向共享运行时家目录 `/home/workspace`，不得让 shell 启动文件污染项目根。
- Agent 提示词明确声明规范绝对路径与相对路径规则，禁止猜测 `/home/user`、旧 `/containers/<名称>` 或 `.sunam/workspaces/...`。
- `shell_run` 不进行不可靠的通用 shell 字符串改写；规范绝对路径由真实文件系统直接解析，相对命令由统一 `cwd` 解析。
- 不削弱 shell 进程所有权、取消、端口管理、mutation lease、revision 或验证语义。

### R4. 数据兼容与恢复

- IndexedDB 快照继续按 `containerId` 保存内容树，不修改持久化 schema；已有快照可直接挂载到新规范根。
- 首次使用新运行时布局时，不自动删除旧运行时目录或用户创建的 `/home/user` 内容；页面重启后的持久化快照是恢复权威。
- 旧终端历史仅作为文本保留，不参与路径解析或恢复。
- 容器删除、强制重启与快照 flush 继续以 `containerId` 为所有权边界。

### R5. 回归保护

- 单元测试覆盖相对路径、当前规范绝对路径、前导 `/`、旧根、伪根、其他容器、重复根和 `..`。
- runtime 单元测试覆盖 shell `cwd`/`SUNAM_WORKSPACE` 使用同一项目根、共享 `HOME`、文件工具、资源物化、快照 mount/export/watch 使用同一根。
- 真实 WebContainer 回归必须证明 Agent 文件写入、Agent shell 读取以及用户终端 shell 读取命中同一个文件，并证明旧平行根不会被创建。
- 更新 Agent runtime、架构和验收文档，明确公开根与内部 runtime 文件边界。

## Acceptance Criteria

- [x] 在同一容器中，Agent 与用户终端执行 `pwd` 均得到 `/home/workspace/<同一 containerId>`，且文件管理器展示同一规范路径。
- [x] Agent 通过相对路径或当前规范绝对路径写入后，文件管理器、Agent `shell_run` 和用户终端立即读取到同一 inode 语义下的内容。
- [x] `apply_patch`、`read_file` 或 `materialize_resource` 收到 `/home/user/foo`、`home/user/foo`、旧 `.sunam/workspaces/...`、旧 `/containers/...`、其他容器路径或 `..` 时，在写入前失败且不产生重复目录树。
- [x] 容器重命名后规范路径保持不变；容器切换、快照恢复、后台进程和子 Agent 并发仍使用各自 `containerId` 对应的真实根。
- [x] Agent 提示词与所有 Agent/终端可见输出不再包含旧项目根 `.sunam/workspaces/<id>`，也不再把不存在的路径展示成可执行路径。
- [x] 现有 `sunam-v3` 快照无需 schema 迁移即可恢复到新根，快照导出不包含 `.sunam/runtime`。
- [x] 真实 WebContainer 端到端测试覆盖“Agent 写入 -> Agent shell 读取 -> 用户终端读取 -> 文件管理器可见”的完整链路。
- [x] `npm run check:all` 通过。

## Out of Scope

- 自动搬迁或删除此前已经写入 `/home/user` 或旧平行目录中的文件。
- 将每个 Sunam 容器改为独立 WebContainer 实例；WebContainer 平台当前只允许页面内单实例运行。
- 把用户终端改成安全沙箱，或阻止用户主动访问 WebContainer 的系统目录。
- 实现通用 shell AST 重写或依据命令文本判定验证有效性。

规划阶段已无产品决策阻塞。
