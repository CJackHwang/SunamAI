# 分层整理 Trellis Spec 目录

## Goal

整理整个 `.trellis/spec/` 文件夹，使目录层级反映 SunamAI 的真实代码边界，索引只承担路由职责，每个 leaf 只包含一个可独立选择的合同或思考主题。减少未来任务读取无关上下文，并在本次纯文档重构中避免频繁重复验证。

## Background

- 项目是单仓库 React/WebContainer 应用，生产依赖层级为 `shared -> entities -> features -> widgets -> pages -> app`。
- 当前 Spec 只有 `frontend/` 和 `guides/` 两个目录，缺少根级路由和领域分层。
- `frontend/agent-runtime-and-persistence.md` 有 643 行并混合九类可独立适用合同。
- `component-guidelines.md` 同时包含组件组合、样式/动效、退出保护、输入交互、disclosure 和 action menu 合同。
- `state-management.md` 同时包含状态归属、workspace store、localized defaults 和分页投影合同。
- `quality-guidelines.md` 同时包含门禁、测试分层、错误策略和 review policy。
- `guides/index.md` 与 `frontend/index.md` 包含 leaf 正文而不是纯路由，且当前 context-curation 相对链接失效。
- `cross-layer-thinking-guide.md` 存在重复章节；两个 thinking guide 还包含针对 Trellis 模板仓库、而非 SunamAI 源码的规则。

## Requirements

- 保留 `.trellis/spec/context-curation.md` 为根级治理 leaf，并新增 `.trellis/spec/index.md` 作为 Spec 总路由。
- 使用最多三层的稳定层级：根路由 -> 类型/代码层 -> 领域目录 -> leaf。
- 将 Spec 分为：
  - `frontend/foundation/`：依赖架构、目录边界、类型安全；
  - `frontend/react/`：组件组合、hooks、样式/动效、交互/无障碍、disclosure/action menu；
  - `frontend/state/`：状态归属、workspace store、localized defaults、派生/分页投影；
  - `frontend/agent/`：架构、模型上下文、资源、工作区、修订/完成、进程、checkpoint、子 Agent、持久化；
  - `frontend/quality/`：验证门禁、测试策略、错误与 review policy；
  - `guides/`：代码复用、跨层思考和 Sunam Agent checklist。
- 所有 `index.md` 只包含 scope、适用性问题、leaf 链接和验证入口，不复制合同或历史说明。
- leaf 按独立适用性拆分，不按行数机械切块；短且同一所有者的规则保持合并。
- 保留现有 SunamAI 源码、测试或项目文档支撑的规范性内容、签名、错误行为、案例和验证断言。
- 删除重复段落、占位内容、泛化模板建议，以及只适用于 Trellis 自身模板/多平台发布而不适用于 SunamAI 的规则。
- 更新 `.trellis/spec/` 内所有活动链接；adoption marker 之前的归档任务和历史审计记录保持冻结，不回写旧路径。
- 不修改产品源码、测试配置、`.agents/skills/`、Trellis runtime 或产品设计文档。
- 实施过程中不逐文件运行验证。全部重组完成后集中执行一次结构/链接/占位/重复检查，再执行一次 `git diff --check` 和完整 diff review。

## Acceptance Criteria

- [x] `.trellis/spec/index.md` 能路由到根级 context-curation leaf、frontend 和 guides，所有下级索引均为 router-only。
- [x] 最终目录不超过约定层级，并与 SunamAI 的代码/知识所有权匹配。
- [x] 每个 leaf 对应一个可独立选择的合同或思考主题，未通过文件数量制造新重复。
- [x] 原有 SunamAI 规范性合同、关键签名、错误矩阵、案例和测试断言均有唯一权威归属。
- [x] Agent、React、State 和 Quality 聚合文件已按独立适用性拆分。
- [x] cross-layer guide 的重复章节被消除，项目外 Trellis 模板规则不再混入 SunamAI Spec。
- [x] 本次新增或修改的相对 Markdown 链接全部解析到现存文件，且没有 TBD/placeholder。
- [x] 归档任务、产品源码、测试配置和运行时行为保持不变。
- [x] 仅在最终文件状态集中执行一次结构检查和一次 diff 检查，没有反复运行 `npm run check` / `npm run check:all`。

## Out of Scope

- 修改任何 `src/`、`tests/`、`scripts/` 或 `docs/` 内容。
- 改变 Agent、workspace、UI、持久化或验证门禁的产品语义。
- 为历史归档任务迁移旧 Spec 路径。
- 创建 package/layer 结构与真实单仓库前端架构不一致的目录。
- 使用子 Agent 或并行 review worker 执行本任务。

## Key Decisions

- “agent任务”指交给当前 agent 的整理任务，不是 SunamAI 的 Agent 产品模块。
- 目录最大深度以可发现性为上限，领域目录只在存在多个独立 leaf 时创建。
- 旧聚合文件迁移完成后删除，不用大量兼容路由重新制造目录噪音；冻结的历史任务保留原始路径文本。
- 这是复杂的纯文档治理重构，需要更新 `design.md` 和 `implement.md`，但不需要产品测试套件。

当前没有阻塞规划的产品、兼容性或风险决策。
