# TASK-DOC1 — SunamAI 文档重建（中英双语 + 贡献指南 + Succinix 链接 + 清冗余）

## 背景（用户明确要求）

项目大改动后（pi 全面切换、独立设置页、Succinix 集成、旧引擎删除），文档需要更新/重写。用户要求：
1. **清理冗余文件**
2. **整理更新文档**（大改动可能需要重写，调整排版）
3. **中英双语文档**（参考 Succinix 的标准）
4. **贡献指南 + 开发文档**
5. **SunamAI 里附上 Succinix 项目链接**

参考标准：Succinix 的文档结构（README.md + README.zh-CN.md + CHANGELOG.md + CHANGELOG.zh-CN.md + CONTRIBUTING.md + CONTRIBUTING.zh-CN.md + AGENTS.md + docs/FEATURES.md + docs/FEATURES.zh-CN.md 等）。

## 物理边界

- **不改代码**（纯文档任务）
- 保留 AGENTS.md（Trellis 托管块不动）
- 不新增依赖
- `.trellis/tasks/archive/` 禁止动（文档可引，不改）

## 需求

### R1. 清理冗余文件（SunamAI 根目录）

- `HeyMean拷貝`（残留目录）→ 删除（确认是冗余拷贝）
- `coverage/`（覆盖率报告产物）→ 确认 .gitignore 后删除或保留（git 管理外）
- `test-results/`（测试产物）→ 同上
- `PLAN-succinix-pi.md`（已完成的执行计划）→ **归档到 .trellis/tasks/archive/**（不直接删，计划是历史记录）
- 检查其他根目录残留（TASK*.md 应 0 残留——之前已归档，确认）

### R2. README 重写（中英双语）

- **README.md**（英文主版，参考 Succinix 排版）：
  - 项目简介（浏览器原生 AI Agent，Succinix 容器环境 + pi Agent 引擎）
  - 核心特性（pi 引擎/独立设置页（供应商+皮套+关于）/Succinix 集成/进程隔离/快照持久化/多语言）
  - 快速开始（dev server 7891、配置供应商、容器使用）
  - **Succinix 项目链接**（github.com/CJackHwang/Succinix，明确标注依赖关系）
  - 技术栈（WebContainers/pi/earendil-works/React 等）
  - 文档索引（docs/ 各文件 + 双语说明）
  - 许可证（AGPL-3.0）
- **docs/README.zh-CN.md**（中文版，与英文对应）

### R3. CHANGELOG（中英双语）

- **CHANGELOG.md**（英文）：记录本项目大版本演进——尤其 2026-08 的 pi 全面切换（M/P/S/UX 系列：Succinix 集成、pi 引擎、设置页、旧引擎删除）
- **CHANGELOG.zh-CN.md**（中文对应）

### R4. CONTRIBUTING（贡献指南，中英双语）

- **CONTRIBUTING.md**（英文）：
  - 开发环境（node 22、npm install、dev 7891）
  - 代码规范（Trellis 工作流、contracts 边界、UI 规范（暗色/全英文/无 emoji））
  - 测试（单测/组件/e2e/runtime——节选 vs check:all）
  - 提 PR 流程（TASK 规格 → 实现 → 审计 → 验收）
- **CONTRIBUTING.zh-CN.md**（中文对应）

### R5. docs/ 更新（大改动后的关键文档）

- `docs/architecture.md`：更新架构图/文字——pi 引擎为唯一引擎（旧 AgentEngine 已删）、设置页三栏目、Succinix 集成面（host/文件 RPC/进程隔离）
- `docs/agent-v2-design.md`：pi 重构后的设计（AgentDriver/PiDriver/piSession/IndexedDB 会话/压缩/子 agent）
- 其他 docs 文件（dependency-advisories/extension-development/refactor-acceptance）：检查是否过时，过时的更新或标注
- **新增 docs/FEATURES.md**（参考 Succinix FEATURES：能力清单 + 边界如实标注）——中英双语

### R6. 链接与一致性

- README/docs 中提及旧引擎（AgentEngine/agentFamily）的地方 → 更新为 pi
- webcontainer 环境表述 → succinix 环境（用户可见处，与代码命名统一一致）
- 所有文档中英文对应（双语文件内容一致，仅语言不同）

## 质量门禁

1. `git diff --check` 干净
2. grep 静态自查：文档中无旧引擎误导表述（AgentEngine 作为现行实现的描述）、无 webcontainer 环境用户可见表述残留
3. 双语对应：每个英文文档有中文版（或说明仅英文原因）
4. `npm run build` 不受影响（纯文档，确认无代码改动）
5. README 含 Succinix 链接（github.com/CJackHwang/Succinix）
6. 根目录 TASK*.md 零残留 + 冗余文件清理

## 提交

`docs: 文档重建（中英双语 + 贡献指南 + Succinix 链接 + 清冗余）`
