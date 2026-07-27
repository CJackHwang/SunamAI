# Implementation Plan

## 1. Create Router Skeleton

- [x] 创建根、frontend 各领域和 guides 子领域索引；根索引直接路由到 context-curation leaf。
- [x] 每个索引只包含 scope、适用性路由、leaf 链接和验证入口。
- [x] 明确 task manifest 只引用 leaf。

## 2. Route Governance And Migrate Frontend Foundation

- [x] 保留根级 context-curation 合同并从根索引路由。
- [x] 迁移 architecture、directory 和 type-safety 到 foundation。
- [x] 保留项目真实依赖图、目录职责、边界检查和 TypeScript/runtime validation 合同。

## 3. Split React And State Specs

- [x] 将 component composition、hooks、styling/motion、interaction/accessibility、disclosure/action-menu 分到独立 React leaf。
- [x] 将状态归属/workspace store、localized defaults、derived/paged projection 分到独立 State leaf。
- [x] 确保每个签名、错误行为、交互断言和测试要求有唯一归属。

## 4. Split Agent And Quality Specs

- [x] 将 Agent 聚合文件拆为架构、模型上下文、资源、工作区、修订/完成、进程、checkpoint、子 Agent、持久化九个合同。
- [x] 将 validation gates、test strategy、error/review policy 拆为独立 Quality leaf。
- [x] 保留必要签名、错误矩阵、案例、tests required 和 wrong/correct 示例。

## 5. Clean Thinking Guides

- [x] 拆分代码复用的搜索/抽象与批量/exhaustive 主题。
- [x] 拆分跨层 data-flow/contracts 与 event-log/projection 主题。
- [x] 删除重复章节和仅适用于 Trellis 模板仓库的内容。
- [x] 保持 Sunam Agent checklist 简短，并链接到精确 Agent leaf。

## 6. Remove Old Aggregates

- [x] 更新全部活动 Spec 链接到新路径。
- [x] 删除迁移完成的旧聚合文件，不创建大批兼容路由。
- [x] 保持归档任务、产品源码、测试和 docs 不变。

## 7. One Concentrated Validation Pass

全部编辑完成后一次性执行：

- [x] 目录/标题/router-only/placeholder 检查。
- [x] 全量相对 Markdown 链接解析。
- [x] 旧活动引用、重复标题和项目外模板术语检查。
- [x] 旧主题/签名到新 leaf 的完整性对照。
- [x] 一次 `git diff --check` 和完整 diff review。

不运行 `npm run check` 或 `npm run check:all`，除非实施范围意外扩展到产品源码或可执行配置。

## 8. Review Gate

- [x] PRD 每项验收标准均有对应证据。
- [x] `git status` 只包含任务产物和计划内 `.trellis/spec/` 文档。
- [x] 完成前确认最终树没有空 leaf、重复权威或超过需要的目录层级。
