# Technical Design

## 1. Target Tree

```text
.trellis/spec/
|-- index.md
|-- context-curation.md
|-- frontend/
|   |-- index.md
|   |-- foundation/
|   |   |-- index.md
|   |   |-- architecture-and-boundaries.md
|   |   |-- directory-structure.md
|   |   `-- type-safety.md
|   |-- react/
|   |   |-- index.md
|   |   |-- component-composition.md
|   |   |-- hooks.md
|   |   |-- styling-and-motion.md
|   |   |-- interaction-and-accessibility.md
|   |   `-- disclosures-and-action-menus.md
|   |-- state/
|   |   |-- index.md
|   |   |-- ownership-and-workspace-store.md
|   |   |-- localized-creation-defaults.md
|   |   `-- derived-and-paged-state.md
|   |-- agent/
|   |   |-- index.md
|   |   |-- architecture-and-data-flow.md
|   |   |-- model-context-and-messages.md
|   |   |-- resources.md
|   |   |-- workspace-namespace.md
|   |   |-- revision-verification-and-completion.md
|   |   |-- process-lifecycle.md
|   |   |-- checkpoint-and-recovery.md
|   |   |-- subagents-and-cancellation.md
|   |   `-- persistence-and-snapshots.md
|   `-- quality/
|       |-- index.md
|       |-- validation-gates.md
|       |-- test-strategy.md
|       `-- error-and-review-policy.md
`-- guides/
    |-- index.md
    |-- code-reuse/
    |   |-- index.md
    |   |-- search-and-abstraction.md
    |   `-- batch-and-exhaustive-changes.md
    |-- cross-layer/
    |   |-- index.md
    |   |-- data-flow-and-contracts.md
    |   `-- event-log-and-projection-boundaries.md
    `-- sunam-agent-cross-layer-checklist.md
```

如果迁移证据表明某个计划 leaf 没有独立适用性，则合并回同一所有者 leaf；不得为了严格匹配树图保留空文件或重复内容。

## 2. Routing Model

- 根 `index.md` 只回答应该读取 context-curation、frontend 还是 guides。
- `frontend/index.md` 只回答 foundation、react、state、agent 或 quality 哪个领域适用。
- 领域 `index.md` 通过任务触发条件选择精确 leaf，并列出该领域的最终验证入口。
- `guides/index.md` 只选择思考主题，不承载 checklist 正文。
- task manifest 只能引用 leaf，不能引用任何 index。

## 3. Migration Ownership

| Current file | Target ownership |
| --- | --- |
| `context-curation.md` | 保持为根级治理 leaf，由根索引路由 |
| `architecture-and-boundaries.md`, `directory-structure.md`, `type-safety.md` | `frontend/foundation/` |
| `component-guidelines.md`, `hook-guidelines.md` | `frontend/react/` 的五个独立合同 |
| `state-management.md` | `frontend/state/` 的三个独立合同 |
| `agent-runtime-and-persistence.md` | `frontend/agent/` 的九个独立合同 |
| `quality-guidelines.md` | `frontend/quality/` 的三个独立合同 |
| `code-reuse-thinking-guide.md` | `guides/code-reuse/` 的两个主题 |
| `cross-layer-thinking-guide.md` | `guides/cross-layer/` 的两个 SunamAI 适用主题 |
| `sunam-agent-cross-layer-checklist.md` | 保持为短 checklist leaf，并更新精确合同链接 |

## 4. Content Rules

- 每条重要规范保留真实源码、测试或项目文档证据。
- code-spec leaf 包含适用性、必需行为、禁止行为、验证和相关合同；跨层/infra leaf 继续保留必要签名、错误矩阵、案例和 wrong/correct 断言。
- guide leaf 只保留思考问题、触发条件和指向 code-spec 的链接，不复制实现合同。
- 内容只在唯一所有者处定义。跨领域依赖使用相对链接。
- 删除 cross-layer guide 中第二次出现的 cross-platform/runtime-template/mode-detection 重复段落。
- 删除仅描述 Trellis 模板注册、跨平台命令模板同步等项目外内容；不把这些内容迁入 governance。

## 5. Compatibility

`.trellis/spec/` 的活动入口全部更新到新路径。历史归档任务属于 adoption marker 之前的冻结审计记录，不修改，也不要求其旧路径在新树中继续存在。`AGENTS.md` 只引用 `.trellis/spec/` 目录级入口，不需要路径兼容修改。

## 6. Validation Strategy

全部文件迁移完成前不运行检查。最终集中验证：

1. 枚举目录和标题，确认索引只含允许的 router 内容，leaf 无占位。
2. 解析所有相对 Markdown 链接并确认目标存在。
3. 检查旧聚合路径不再被活动 Spec 引用，重复 guide 标题消失。
4. 对照旧文件的规范主题和关键签名，确认唯一归属。
5. 运行一次 `git diff --check` 并完整审阅 diff。

由于不修改产品源码，不运行 `npm run check` 或 `npm run check:all`。若实施中触达产品文件，必须先回到规划升级门禁。

## 7. Rollback

这是纯 Markdown 迁移。回滚只需恢复旧 Spec 树；没有数据库、生成物、依赖或运行时迁移。
