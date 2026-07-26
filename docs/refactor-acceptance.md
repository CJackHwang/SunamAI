# 发布与优化冻结验收

本清单用于影响 Agent、资源、持久化、WebContainer、子 Agent 或交互布局的发布。只有所有冻结门槛通过，才可认定基础接近当前可接受极限并进入独立功能开发。

## 1. 自动化门禁

`npm run check` 必须通过，顺序包括：

1. strict TypeScript；
2. Oxlint；
3. 架构边界检查；
4. 全核心覆盖率；
5. 生产构建；
6. 初始/总 JS 与 dist 包体检查。

`npm run check:all` 在此基础上继续执行 E2E、视觉、真实 WebContainer 和生产依赖审计。优化冻结要求连续两次完整通过。

阈值：

- statements/functions/lines ≥85%，branches ≥80%；
- 初始 JS ≤90 KiB gzip；
- 总 JavaScript ≤320 KiB gzip；
- 生产 `dist` ≤1.8 MiB；
- 视觉最大像素差异比 0.2%。

## 2. Context

- [x] 已知模型使用明确 profile，未知模型使用保守 32k。
- [x] 有效窗口扣除输出、summary reserve、安全缓冲、system prompt、tool schema 和媒体估算。
- [x] assistant tool call 与匹配结果不被拆散。
- [x] micro-compaction 按 tool_call_id 归属；只有相同 digest 且期间无相关写入的读取可去重。
- [x] 失败、写入、验证、用户反馈和最新路径读取保留。
- [x] summary 请求 tools 为空，输入不含图片正文、Blob、附件正文或 Base64。
- [x] semantic PTL 最多三次，每次删除最旧 20% 完整组；网络/429 不额外裁历史。
- [x] 主请求 PTL 最多三次；连续失败写入 deterministic fallback 和 circuit reason，不进行第四次模型调用。
- [x] 相同工具与参数连续重复时只允许一次恢复提示；继续重复立即熔断，不耗尽整个 tool/model budget。
- [x] 中文、emoji、混合代码和超大单轮按真实 estimator 裁剪，`afterTokens` 不超过有效窗口。
- [x] compact 后重注入 Task、Plan、evidence、workspace revision、event tail、最多 5 个文件片段、资源和子任务状态。
- [x] compact 后立即保存 Run summary/checkpoint；恢复能看到 checkpoint 后的最新 run sequence。
- [x] UI 不提供上下文管理负担，只显示非打扰状态。

## 3. v3 持久化与恢复

- [x] 生产只使用 `sunam-v3`；旧 v2 生产实现已删除，`sunam-v2` 只由 raw IndexedDB 隔离测试建立，生产不打开、不读、不迁移、不删除。
- [x] 每 Run 最多一个覆盖式 checkpoint。
- [x] 初始只读最近 250 events，上滚自动分页；同 timestamp 无遗漏/重复。
- [x] 普通 workspace save、session/container 删除和 reset 共用串行队列；reload 不越过尚未完成的写入。
- [x] session/container 删除先取消并等待范围内活动 Run，再与 workspace 元数据在同一事务内完成，删除后不会被旧 execution 写回复活。
- [x] session 删除同步处理 Run、event、checkpoint、resource、agent task 和 terminal history；container 删除处理 container-scoped Run 数据、资源归属和 snapshot，跨容器共享资源在仍被引用时不得误删。
- [x] malformed record 进入 quarantine，原值保留。
- [x] Run/Event/Checkpoint/Message/Resource/AgentTask 嵌套字段均执行深层 schema 校验。
- [x] active parent/child Run 和 task 刷新后标记 interrupted；resume 创建新 Run。
- [x] event tail 和 workspace revision drift 都使用持久化真实值检测。
- [x] Run/checkpoint/terminal/snapshot 写入队列互不重叠，错误进入可恢复状态。

## 4. 快照

- [x] `node_modules`、`.git`、dist、coverage、Playwright 输出和常见缓存不进入快照。
- [x] 上限 10,000 文件/100 MiB；文件数和字节数均有回归测试。
- [x] 超限或写入失败保留上一份完整快照，不写半份。
- [x] 活动快照失败时，已经排队的 follow-up 会自动继续，不因前一次 rejection 永久滞留。
- [x] Agent checkpoint、进程结束、`pagehide` 和 runtime dispose 会 flush；显式 flush 取消未触发 debounce，不重复保存。
- [x] 真实 WebContainer 测试按 active containerId 读取 IndexedDB snapshot，并检查 revision/fileCount/byteSize。

## 5. 资源与多模态

- [x] UI 与 ResourceProcessor 核心都执行 8 文件、2/10/20 MiB 和 50 MiB 限制；持久化 resource ID 同样计数计量，整批原子失败。
- [x] 同 session SHA-256 去重；跨 session 不去重、不读取。
- [x] MIME 欺骗和伪装文本二进制被拒绝。
- [x] 图片最长边 ≤2048，模型副本 ≤1.5 MiB，原图仍可 materialize；无法解码验证尺寸时 fail closed。
- [x] 文本按行/token 范围读取。
- [x] event/message/checkpoint 不包含资源正文、Blob、File、ArrayBuffer、data URL 或长 Base64。
- [x] OpenAI adapter 只在视觉请求时生成 data URL；仅明确视觉不支持错误会使用资源引用重试并缓存能力，无关 400/422 不重试。
- [x] `materialize_resource` 推进真实 workspace revision，并受 write scope 和 container lease 保护。

## 6. 子 Agent

- [x] 最大深度 1、每 root 最多 6 个、最多 3 路 explore。
- [x] implement 与 verify 独占；不同 root family 对同一 container 也不能并发 mutation。
- [x] explore/implement/verify 工具白名单符合设计；verify 只运行识别出的 foreground 验证命令。
- [x] write scope 同时限制 apply_patch 和 materialize。
- [x] 子 Run 20 turns/50 tools/5 分钟，root family 90/225/15 分钟。
- [x] 模型 taskId 重复不会覆盖 persisted delegated task。
- [x] notification 包含状态、摘要、证据、路径、验证、真实 revision 和 usage。
- [x] 子 Run transcript 只在展开时按 run 加载最近 250 条事件，不进入主聊天。
- [x] child 写入使父旧验证失效；child failed verification 也撤销旧 pass。
- [x] root complete 时重新读取当前 runtime revision。
- [x] shell 进程结束显式推进 runtime revision；验证记录不能绑定命令执行前的 revision。
- [x] Agent 对用户终端只有有界只读缓冲；所有命令使用 Agent-owned `shell_run`，不存在绕过 lease 的终端注入工具。
- [x] 父取消等待所有 child terminal、task 持久化和 owned process 停止。

## 7. 性能

- [x] 5,000-event 会话首屏只读 250，DOM 固定为当前 250-message 窗口。
- [x] tool result projection 使用一次性索引，为 O(n)。
- [x] 1,000 个 SSE delta 最多 30 次/秒更新，最终文本完全一致；buffer 上限 1 MiB。
- [x] OpenAI-compatible SSE 的 nullable content/reasoning 字段在边界规范化，思考过程不会因 `content: null` 被整帧丢弃。
- [x] 聊天自动跟底使用无动画校正，只有用户显式“回到底部”才启用 smooth scroll；任务条和输入区高度变化不重启连续滚动动画。
- [x] 思考过程使用紧凑的内部滚动区；普通工具调用默认折叠并保留运行/完成状态，`ask_user` 继续直接展示；工具 disclosure 使用固有宽高非线性动画、底部锚定、四边对称 padding 和 reduced-motion 回退。
- [x] 全局 motion token 按反馈/空间/退场角色使用；移动菜单 presence 覆盖完整 sheet exit，模型选择器有退场动画，终端标签不再动画 font-size。
- [x] 历史 Markdown 使用 `content-visibility`。
- [x] 文件列表不读取全文求大小。
- [x] workspace selector 和相同 status 写入短路有效。

## 8. Playwright 场景

E2E：配置门禁、设置与 session/container CRUD、图片视觉 fallback、自动 compact、真实 checkpoint resume、用户取消、root/subagent 委派与 revision 完成门。

Visual：配置页与资源卡/子任务树，桌面 1440×900、移动 390×844，差异 0.2%。新增截图必须先用匹配版本 Chromium 更新基线，再运行一次不带 update 的验证。

Runtime：真实 WebContainer 进程/端口/服务面板、资源 materialize、快照导出排除、父取消级联到 verify child 和 PID 清理。

## 9. 依赖与资产

- [x] `npm run check:audit` 证明生产依赖 high/critical 为零。
- [x] development-only PWA/Workbox advisory 例外按 [策略](dependency-advisories.md) 记录并定期复查。
- [x] README 头图不进入 `public`，PWA 不声明无效 asset。
- [x] 只保留实际使用的 normal 400/500/600/700 与 italic 400 字体；发布目标格式为 WOFF2。

## 10. 冻结判定

以下条件全部满足才通过：无已知 P0/P1 数据损坏、死循环、越界写入或恢复错误；`check:all` 连续两次通过；所有新增视觉基线已人工检查；生产 audit 可验证；剩余问题仅为上游限制，或基准收益低于 10% 且复杂度显著增加。

任何缺少 Chromium、网络或转换工具的检查都必须记录为“未执行/外部阻塞”，不能标记为通过。发布说明应列出实际命令、结果和未执行原因。

## 11. 当前工作区验证记录（2026-07-26）

- 优化冻结状态：**通过**。最终代码状态下 `npm run check:all` 已连续两次完整通过；每次都包含 `npm run check`、E2E、visual、runtime 和 production audit。
- 核心自动化：36 个测试文件、175 个测试，连续两次全绿。
- 覆盖率：statements 91.24%、branches 83.05%、functions 90.40%、lines 94.97%。
- 包体：初始 84.94 KiB gzip、总 JS 314.09 KiB gzip、dist 1.34 MiB。v3 数据层从首屏拆出并在 hydrate 时懒加载。
- Playwright 实际执行结果：E2E 7/7、visual 4/4、runtime 3/3；资源卡/子任务树的桌面与移动基线已经生成、人工检查，并在不更新截图的两次完整门禁中通过。
- Runtime 证据包括：桌面切换到移动端后 Agent 后台进程和端口保持；资源 materialize 后 snapshot 仅保留源数据并排除 `node_modules`/dist；父取消会级联停止 verify 子任务进程。
- `npm run check:audit` 在两次完整门禁中均返回 `found 0 vulnerabilities`。完整 development audit 仍有 8 个 high，全部属于 `vite-plugin-pwa@1.3.0` / `workbox-build@7.4.1` 构建链；不兼容 Vite 8 的 1.2.0 降级不作为修复，详见 [依赖策略](dependency-advisories.md)。
- 字体已转换并只保留 WOFF2：normal 400/500/600/700 与 italic 400；README 头图已移出 `public`，无效生产图标和 PWA asset 声明已删除。

因此当前基础已达到本计划定义的可接受优化冻结线，可以进入后续功能开发。后续变更仍需满足本清单，且不得把 development-only advisory 例外扩展到生产依赖。
