# 子任务2：容器三态与启动失败流程（container-capability-flow）

> 父任务：`capability-library`。依赖子任务1 `capability-engine` 提供的 `CapabilityAwareRuntime`、`CapabilityAvailability`、`resolveEnabledTools`。本子任务交付容器的可用性状态机与用户知情流程。

## 需求

### F1 容器三态状态机

- F1.1 状态：`已开启`（enabled）/ `已关闭`（disabled，用户偏好）/ `启动受限`（restricted，boot 失败/环境不支持）。
- F1.2 状态分两层：
  - **用户偏好**（持久化，`CapabilityConfig.modules['virtual-container'].enabled`）。
  - **可用性**（会话态，易失）：`enabled`（boot 成功）或 `restricted`（boot 失败）。
  - 有效组合：偏好开 + 可用 → `已开启`；偏好关 → `已关闭`；偏好开 + 不可用 → `启动受限`。
- F1.3 转换：
  - `已开启 → 已关闭`：用户拨开关 → 偏好持久化 + **关闭即释放**：flush 快照落盘 → teardown WebContainer → 清空 boot 单例（释放内存与后台进程）。**Agent run 活跃时该开关禁用**（见子任务3 U4.3）。
  - `已关闭 → 已开启`：用户拨开关 → 触发 `getWorkspaceRuntime()`（重新 boot，工作区从快照恢复）；成功 → `已开启`；失败 → `启动受限`。
  - `启动受限 → 已开启`：用户在受限态重新打开（即重试）→ 重新初始化；成功 → `已开启`，失败回落 `启动受限`。

### F2 boot 失败告知弹窗

- F2.1 容器 boot 失败时展示弹窗（**复用 AppUpdateNotice overlay/卡片样式**），文案说明：容器初始化失败、可能是浏览器环境不支持（如缺少跨域隔离/SharedArrayBuffer）。
- F2.2 弹窗操作：主操作「放弃容器，继续纯聊天」（关闭弹窗并确认进入受限态继续）；可给「重试」次操作（可选，重试按钮与开关重试语义一致，二选一即可，倾向只用开关）。
- F2.3 弹窗不阻断整体使用：关闭后应用以纯聊天模式继续；能力库面板（子任务3）显示「启动受限」。
- F2.4 会话态：同一页面生命周期内**同一次失败不再重复弹窗**（已被告知）。**决策澄清**：`resetForReboot()`（关→开后）重置 `failureNotified`——用户主动重开容器 = **新的尝试周期**，若新 boot 再失败则再次告知是正确产品语义（用户刚主动操作、值得被再次提醒）；F2.4 只约束"同一次 boot 失败不反复打扰"，不约束跨尝试周期。若后续被当 bug 复现，以本澄清为准。

### F3 重试语义

- F3.1 重新初始化复用现有 `getWebContainer()`/`getWorkspaceRuntime()` 的 boot 单例逻辑（失败后 `bootPromise` 已置空，可重试）。
- F3.2 重试由**用户主动触发**（拨开关），不自动重试（避免反复 boot 打爆浏览器）。
- F3.3 **关闭即释放与重建**：关闭容器后单例 `runtimeInstance`/`webcontainerInstance` 一并清空（不复用）；重开 = 全新 boot。工作区无需迁移——快照持久化在 IndexedDB，`ensureContainer` 经 `snapshotCoordinator.restore` 从快照恢复（revision 一并恢复）。

### F4 运行时与 UI 接线

- F4.1 boot 失败时，`WorkspaceRuntimeProvider` 仍提供非空 `CapabilityAwareRuntime`（containerAvailable=false），`isReady` = 聊天可用。
- F4.2 现有 `workspace-runtime-error` 横幅在受限态**不展示**（被弹窗 + 面板受限态替代），仅保留真正运行期错误。
- F4.3 `runtimeSingleton.forceRestartWorkspaceRuntime` 语义兼容：受限态下仍可调用（结果仍是受限则保持）。
- F4.4 **关闭释放流程**：新增 `disposeWorkspaceRuntime()`（或复用 `forceRestartWorkspaceRuntime` 的释放段：`flushSnapshots()` → `runtime.dispose()` → `resetWebContainer()` → 清空 `runtimeInstance/runtimePromise/webcontainerInstance/bootPromise`，并重置 `ContainerAvailabilityController` 的 `booting`）。关闭分支（偏好关、受限态「放弃容器」）调用之；重开走 F3.3 全新 boot。

## 验收

- [ ] 模拟 boot 失败（注入 reject）：弹窗出现，样式与 AppUpdateNotice 一致；「放弃继续」后进入纯聊天，应用可用。
- [ ] 受限态下能力库上下文 `availability = 'restricted'`，`resolveEnabledTools` 排除容器工具。
- [ ] 受限态下再次触发初始化：成功 → `enabled`；再次失败 → 回落 `restricted`，不重复弹窗。
- [ ] 用户关容器：flush 快照落盘 → teardown 释放内存/进程，纯聊天运行；重新开：重新 boot 并从快照恢复工作区。
- [ ] Agent run 活跃时容器开关禁用（禁止关闭/重试操作），run 结束后解除。
- [ ] `workspace-runtime-error` 横幅在受限态不显示；真正 runtime 错误仍显示。
- [ ] 会话持久化：受限态下的对话刷新后可恢复，`interrupted` 续跑正确（哨兵 containerId 承接）。
- [ ] 三语弹窗文案齐备。

## 不在范围

- 能力库面板 UI 本体（子任务3）。
- 弹窗的"永久记住"选择（父任务决策：偏好由能力库面板管理，本子任务不新增额外存储）。
