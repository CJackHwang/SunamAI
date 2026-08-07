# TASK-UX3 — 独立设置页（供应商 / 皮套 / 关于）+ 命名统一 + 配置地址修复

## 背景（用户明确要求）

1. **命名统一**：SunamAI 里 webcontainer 环境相关表述全部改为 succinix 环境
2. **配置地址问题**：部署后，配置渠道地址是本机的或带端口的链接时，获取模型和请求有问题（要排查修复）
3. **独立设置页**（不是弹窗，为以后扩展）分三大栏目：
   - **供应商**：配置不同供应商渠道（集成 pi-ai providers 获得更多支持）；每次选一个供应商中的一个模型作为**全局对话模型**，随时灵活更换
   - **皮套**：管理可热插拔的 Agent 配置（现"Sunam 6.9 Pron"是硬编码雏形——`models.ts` 的 SunamModel + `prompt.ts` 的系统提示词）：新建皮套、自定义系统提示词、自定义皮套模型名称、自定义该皮套使用的模型参数（供应商支持时）、皮套指定某供应商某模型或**自动绑定**（默认自动，跟随全局对话模型）
   - **关于**：布局参考项目内 HeyMean 产品线的 AboutPage（头像 + 标题 + 描述 + 开发者 + GitHub/License 按钮，简洁卡片式）
4. **聊天页顶部模型选择栏**：只有有皮套，才能在顶部模型选择栏中选择（皮套列表出现在顶部选择器）

## 物理边界

- contracts 一字不改
- 界面设计按现有标准（暗色主题/专业克制/全英文/无 emoji）
- pi-ai 已装（P1 依赖），不新增运行时依赖
- `.trellis/tasks/archive/` 禁止动

## 需求

### R1. 命名统一（webcontainer → succinix 环境表述）

- grep `webcontainer 环境|WebContainer 环境|webcontainer environment` 类**用户可见表述**（i18n/提示/UI 文案）→ 改 succinix 环境
- 代码标识符/API（webcontainer.workdir/@webcontainer/api）保留

### R2. 配置地址问题（本机/带端口地址）

排查并修复：配置渠道地址是本机（localhost/127.0.0.1）或带端口时，"获取模型"和请求失败。可能原因：CORS/混合内容/端口校验——**实测复现后定位修复**。测试：本机地址 + 端口地址 → 获取模型成功、对话成功。

### R3. 独立设置页（新页面，替代弹窗）

- 新增独立设置页（路由/页面组件），入口从侧边栏"全局设置"进入
- **三栏目布局**（侧边 tab 或顶部 tab：供应商 / 皮套 / 关于），为未来扩展预留（栏目可加）
- 样式对齐现有设计规范（暗色/专业/全英文/无 emoji），参考 HeyMean 的整体风格

### R4. 供应商栏目（集成 pi-ai providers）

- **分析 pi-ai 能力**：`@earendil-works/pi-ai` 的 providers（openaiProvider/anthropicProvider/bedrockProvider 等）——确认支持的供应商清单 + 配置形态
- 供应商列表管理：添加/编辑/删除供应商渠道（名称、baseUrl、apiKey、默认模型）
- **全局对话模型选择**：从已配置的供应商中选择一个模型作为全局对话模型，随时切换
- 配置驱动：现有 modelClient/piSession 从供应商配置读取（**兼容现有配置结构**，localStorage 迁移）
- 保留：现有 API key 配置兼容（用户已有配置不丢）

### R5. 皮套栏目（可热插拔 Agent 配置）

- **皮套数据模型**（对齐现有 SunamModel/prompt.ts 结构，但可配置化）：
  - 皮套名（显示名，如 "Sunam 6.9 Pron"）
  - 系统提示词（自定义）
  - 模型名称（自定义显示名）
  - 模型参数（温度/top_p/max_tokens 等——**供应商支持时**，不支持的供应商如实标注不可用）
  - **模型绑定模式**：指定某供应商某模型 / **自动绑定**（默认，跟随全局对话模型）
- 皮套 CRUD：新建 / 编辑 / 删除 / 启用（热插拔——切换即时生效）
- 默认皮套保留（现有 Sunam 6.9 Pron 等迁移为内置皮套）
- **聊天页顶部模型选择栏**：只显示已启用的皮套（点选切换皮套 → 该皮套的系统提示词/模型配置生效）

### R6. 关于栏目

- 布局参考 HeyMean AboutPage：头像（GitHub 头像）+ 项目名 + 描述 + 开发者 + GitHub/License 按钮
- 内容：SunamAI 项目信息 + **附 Succinix 项目链接**（github.com/CJackHwang/Succinix，用户明确要求）+ AGPL 许可证

### R7. 配置迁移兼容

- 现有配置（baseUrl/apiKey/model + SunamModel 硬编码）→ 新结构映射
- 旧 localStorage 读取兼容

## 质量门禁（节选）

1. `npx tsc -b` 0 错
2. `npx vitest run tests/unit/` 全绿（新增：供应商配置解析、皮套 CRUD、模型绑定）
3. `npm run build` + check-bundle 通过
4. **浏览器实测**：
   - 设置页三栏目切换正常
   - 供应商：配置 → 选全局模型 → 对话走该供应商（真实 API）
   - 皮套：新建（提示词/名称/参数/自动绑定）→ 顶部选择器出现 → 切换生效
   - 本机/端口地址 → 获取模型 + 对话成功
   - 关于页显示 + Succinix 链接
5. `git diff --check` 干净

## 提交

- `feat: 命名统一 succinix 环境 + 配置地址修复`
- `feat: 独立设置页（供应商 + 皮套 + 关于，集成 pi-ai providers）`
