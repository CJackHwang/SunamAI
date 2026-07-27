# 实施计划

## 1. 建立共享菜单

- [x] 在 `src/shared/ui/` 新增类型化响应式操作菜单与组件测试。
- [x] 集中 portal、遮罩、presence、动作关闭、危险态、分隔线、桌面定位与移动 sheet 行为。
- [x] 清理 `menus.css` 中子 Agent 专属例外并保留 reduced-motion/退出时长契约。

## 2. 迁移现有菜单

- [x] 将会话/容器菜单迁移为共享组件适配层。
- [x] 将文件条目菜单迁移为共享组件适配层。
- [x] 将子 Agent 删除菜单迁移到共享组件，保留失败语义并改为移动 sheet。
- [x] 更新组件与视觉测试，证明四类菜单的 portal 和响应式形态。

## 3. 修复历史对话布局

- [x] 重命名态隐藏状态、箭头和更多按钮，释放尾部空间。
- [x] 将状态与展开箭头放入统一尾部 flex 组。
- [x] 覆盖有/无子 Agent、状态组合、编辑态与移动宽度测试。

## 4. 修复文件大小

- [x] 为目录普通文件恢复固定并发上限的字节读取。
- [x] 保留单文件失败回退与 navigation generation/root 防陈旧提交。
- [x] 更新 hook 单测，覆盖首次大小、二进制、失败与根切换竞态。

## 5. 文件工具菜单与 ZIP 导出

- [x] 将三个工具栏按钮合并为一个更多入口，保留独立刷新。
- [x] 增加新建文件、新建文件夹、上传与完整工作区导出动作及三语言文案。
- [x] 使用 `WebContainer.export(rootDir, { format: 'zip' })` 下载完整容器，处理 busy、错误和 URL 释放。
- [x] 增加组件与真实 WebContainer 测试，证明从子目录导出根目录且 ZIP 包含隐藏/依赖内容。

## 6. 规范与验证

- [x] 更新 `.trellis/spec/frontend/component-guidelines.md`，移除子 Agent 菜单例外并记录统一操作菜单契约。
- [x] 视实现边界更新架构/验收文档，避免把完整导出与持久化快照排除规则混淆。
- [x] 运行针对性 Vitest、E2E、视觉与 runtime 测试并检查截图。
- [x] 运行 `npm run check:all` 和 `git diff --check`。
- [x] 审核最终 diff，确认没有覆盖工作区原有未提交修改。

## 风险文件与回滚点

- `src/shared/styles/menus.css`：全局响应式菜单样式，迁移后逐类验证。
- `src/widgets/sidebar/SessionHistoryList.tsx` 与 `Sidebar.css`：details 语义、状态和 hover action 必须同时保持。
- `src/features/file-manager/useFileSystem.ts`：异步导航竞态与目录加载性能。
- `src/features/file-manager/FileManager.tsx`：下载生命周期与当前/根目录边界。
- `tests/visual/*-snapshots`：只接受与新标准化行为一致的有意像素变化。
