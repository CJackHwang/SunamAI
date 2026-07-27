# 技术设计

## 边界与组件

### Shared UI 操作菜单

在 `src/shared/ui/` 增加公共响应式操作菜单。组件接收：

- 打开状态与 viewport 锚点坐标；
- 由调用方提供的类型化动作项（稳定 ID、标签、图标、危险态、分隔标记、禁用态与回调）；
- 关闭回调和可选遮罩强调级别。

组件统一拥有 `createPortal(document.body)`、`usePresence`、遮罩点击、动作后关闭、桌面定位、移动 sheet、退出动画和基础菜单语义。业务组件只组装动作，不再复制菜单 DOM 或 presence 逻辑。

现有 `context-menu` CSS 迁移为该组件的唯一实现样式，删除 `subagent-context-menu` 移动端例外。桌面定位继续使用 CSS 自定义坐标并保留 viewport 安全边距；移动端忽略锚点并固定到底部。

### 调用方迁移

- `SidebarResourceContextMenu` 变为共享菜单的薄业务适配层，保留资源标签和动作回调。
- `FileContextMenu` 变为按文件类型构造动作项的薄适配层。
- `SessionHistoryList` 删除私有 `SubagentContextMenu` portal/presence 实现，直接使用共享菜单。
- `FileManagerToolbar` 管理工具菜单锚点并使用共享菜单呈现四个工具动作。

共享组件不依赖 workspace、file-manager 或 Agent 类型，保持 `shared -> entities -> features -> widgets` 依赖方向。

## 历史对话尾部布局

`SessionHistoryGroup` 为普通态创建一个 `sidebar-session-trailing` 容器，内部按“状态、展开箭头”排列。重命名态不渲染该容器，也不渲染外部更多按钮，并给 summary 增加编辑态类以取消尾部预留空间。

更多按钮仍位于 group 外部，保证折叠的 `<details>` 不会隐藏它；该结构约束保持不变。尾部组使用一个定位锚点和 flex gap，替代状态与箭头各自的绝对坐标。

## 文件大小数据流

`useFileSystem.navigateTo` 在 `readdir(..., { withFileTypes: true })` 后，以固定并发上限读取当前目录的普通文件二进制内容并使用 `byteLength`。目录大小保持 0 且 UI 不渲染目录大小。

单文件读取异常映射为 `null`。列表只有在当前 navigation generation 和 root 仍匹配时提交，沿用现有过期结果门禁。读取完成的大小写入现有路径缓存，预览和原始读取仍可即时更新缓存。

## ZIP 导出数据流

`FileManager` 通过收到的 `WebContainer` 与 `rootDir` 调用：

```ts
await wc.export(rootDir, { format: 'zip' })
```

返回的 `Uint8Array` 包装为 `application/zip` Blob，通过临时 `<a download>` 触发下载。导出不传 `excludes`，以符合“完整容器”语义。导出状态由 FileManager 局部持有，不进入 workspace 持久化，也不改变容器 revision。

文件名使用容器根末段并添加 `.zip`；根名不可用时回退为 `sunam-workspace.zip`。失败进入现有 `operationError` 可见区域，最终释放 busy 状态和对象 URL。

## 兼容性与风险

- 完整导出可能包含大型 `node_modules`，会增加内存与等待时间；这是“完整容器”语义的有意结果。进行中禁用用于避免重复内存压力。
- WebContainer 没有公开 `stat` API，文件大小必须读取内容；固定并发上限控制峰值，但超大单文件仍由底层读取能力决定。
- 共享菜单迁移会改变子 Agent 的移动端视觉基线，这是用户要求的行为变更；普通桌面定位和业务动作不应变化。
- 工作区已有与本任务无关的未提交修改。实施时只增量编辑相关区域，不回退现有改动。

## 回滚

共享菜单迁移可按调用方逐一回滚；文件大小读取和 ZIP 导出彼此独立。若 ZIP 原生导出在真实 WebContainer 测试失败，回滚导出菜单项而不影响菜单标准化和回归修复。
