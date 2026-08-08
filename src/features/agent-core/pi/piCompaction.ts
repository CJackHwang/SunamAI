import {
  buildSessionContext,
  compact,
  createCompactionSummaryMessage,
  estimateContextTokens,
  shouldCompact,
  type AgentMessage as PiAgentMessage,
  type CompactionPreparation,
  type CompactionSettings,
  type CompactResult,
  type Entry,
} from '@earendil-works/pi-agent-core';
import type { Api, Model, Models } from '@earendil-works/pi-ai';
import { profileForModel, type ModelContextProfile } from '../modelClient';

/**
 * P5 pi 上下文压缩：对齐 SunamAI 现有引擎的 90% 压缩语义。
 *
 * 现有引擎（context.ts）语义：
 * - 触发：上下文估算达到 effectiveTokens * COMPACTION_TRIGGER_RATIO（0.9），
 *   effectiveTokens = contextWindow - defaultOutput - summaryReserve - safetyBuffer；
 * - 目标：90% 压缩 → 保留 ~10% 关键上下文（摘要 + 近期保留尾）；
 * - 摘要保留内容：任务目标 / 已完成 / 待办 / 关键约束 / 决策 / 文件路径 / 未解决风险。
 *
 * pi 通道（PiSession）本身没有自动压缩管线，本模块把 pi 的 compaction API
 * （shouldCompact / prepareCompaction / compact / createCompactionSummaryMessage）
 * 编排成与现有引擎一致的「触发 → 摘要 → 裁剪 → 继续」语义：
 * - 阈值：reserveTokens 使 pi 触发点 = 现有引擎触发点（二者仅取整方式不同，见下）；
 * - 保留：keepRecentTokens = floor(effectiveTokens * 0.1)，即 ~10% 上下文保留（90% 压缩）；
 * - 摘要：pi 默认结构化摘要 + 自定义附加指令，保留任务目标/已完成/待办/关键约束；
 * - 持久化：压缩结果写回 pi 会话（compaction entry），刷新后 buildSessionContext
 *   只重建「最新摘要 + 保留尾 + 后续消息」，不重新灌入全量历史（R4）。
 *
 * 差异（R3 如实标注，不隐藏）：
 * - 兜底策略：现有引擎在语义压缩失败时有「确定性兜底摘要」（裁剪完整轮次 + 摘要）；pi 的
 *   compact() 只走 LLM 摘要，失败时本模块选择跳过压缩继续对话（不阻断 prompt），由模型自行处理超限。
 * - UI 事件：现有引擎会发 context_compacted UI 事件（非 transient，进 v3 事件流）；pi 通道只发
 *   transient 的 context_compaction_status（驱动现有压缩指示），前后 token 统计仅在 PiSession
 *   内部记录，不发射 context_compacted（UI 视觉零改动）。
 * - 缓冲语义：现有引擎把 defaultOutput/summaryReserve/safetyBuffer 作为独立缓冲参与
 *   effectiveTokens 计算；pi 的 reserveTokens 只承担「窗口 - 触发点」的差值，并同时充当摘要预算。
 * - 轮次裁剪：现有引擎按「完整工具调用轮次」裁剪（groupCompleteRounds，不拆轮次）；pi 的
 *   findCutPoint 支持「跨轮次剪切」（isSplitTurn：被截断的 turn 前缀单独摘要），保留量更激进。
 * - token 估算：现有引擎用 modelClient 的 estimateTextTokens；pi 用保守字符启发式 estimateTokens
 *   （约 chars/4）。二者都只用于触发与统计，不改变发送给模型的真实上下文。
 */

/** 对齐现有 engine.ts 的触发比例（context.ts COMPACTION_TRIGGER_RATIO = 0.9）。 */
export const PI_COMPACTION_TRIGGER_RATIO = 0.9;
/** 对齐现有引擎的 90% 压缩语义：只保留 ~10% 近期上下文。 */
export const PI_COMPACTION_RETENTION_RATIO = 0.1;

/** 自定义摘要附加指令：对齐现有引擎摘要语义（任务目标 / 已完成 / 待办 / 关键约束）。
 *  R6：采用旧引擎 context.ts 的原文措辞（含 e2e 语义压缩探测锚点），使 pi 通道的
 *  压缩请求与旧引擎保持同一契约。 */
export const PI_COMPACTION_CUSTOM_INSTRUCTIONS =
  'Create a compact factual continuation record. Preserve the task, constraints, decisions, file changes, failed attempts, verification evidence, user feedback, active processes, resources by ID, and unresolved risks. Never include hidden reasoning. Tools are disabled.';

/** 派生的 pi 压缩配置：阈值对齐现有引擎触发点，保留量对齐 ~10%。 */
export interface PiCompactionConfig {
  settings: CompactionSettings;
  /** 传给 shouldCompact 的上下文窗口（对齐现有引擎的 profile.contextWindowTokens）。 */
  contextWindow: number;
  profile: ModelContextProfile;
}

/**
 * 按现有引擎的上下文 profile 派生 pi 压缩设置。
 * reserveTokens 额外 +1：现有引擎用 `beforeTokens < trigger` 判定「不压缩」（即 `>= trigger` 触发），
 * pi 用 `contextTokens > contextWindow - reserveTokens` 判定，+1 使两者触发点完全一致。
 */
export function buildPiCompactionConfig(apiModel: string): PiCompactionConfig {
  const profile = profileForModel(apiModel);
  const effectiveTokens = Math.max(
    4_096,
    profile.contextWindowTokens - profile.defaultOutputTokens - profile.summaryReserveTokens - profile.safetyBufferTokens,
  );
  const triggerTokens = Math.floor(effectiveTokens * PI_COMPACTION_TRIGGER_RATIO);
  const reserveTokens = profile.contextWindowTokens - triggerTokens + 1;
  const keepRecentTokens = Math.max(512, Math.floor(effectiveTokens * PI_COMPACTION_RETENTION_RATIO));
  return {
    profile,
    contextWindow: profile.contextWindowTokens,
    settings: { enabled: true, reserveTokens, keepRecentTokens },
  };
}

/** 会话条目是否已达到压缩阈值（pi shouldCompact 语义，contextWindow 传入对齐引擎的有效窗口）。 */
export function isCompactionNeeded(entries: Entry[], contextWindow: number, settings: CompactionSettings): boolean {
  if (entries.length === 0 || !settings.enabled) return false;
  const messages = buildSessionContext(entries).messages;
  const estimate = estimateContextTokens(messages);
  return shouldCompact(estimate.tokens, contextWindow, settings);
}

/** 压缩结果 → agent 转录（摘要消息 + 保留尾），供后续 prompt 基于压缩上下文继续。 */
export function buildCompactedAgentMessages(result: CompactResult): PiAgentMessage[] {
  return [createCompactionSummaryMessage(result.summary, result.tokensBefore, Date.now()), ...result.retainedTail];
}

/** 压缩执行器：输入 prepared 历史，输出摘要 + 保留尾（默认走 pi compact() 真实 LLM 摘要）。 */
export type PiCompactionRunner = (preparation: CompactionPreparation) => Promise<CompactResult>;

/** 默认压缩执行器：pi compact()，真实 LLM 摘要（浏览器端纯 JS，复用现有 pi-ai provider）。 */
export function createDefaultCompactionRunner(
  models: Models,
  model: Model<Api>,
  customInstructions: string,
  signal?: AbortSignal,
): PiCompactionRunner {
  return async (preparation) => {
    const result = await compact(preparation, models, model, customInstructions, signal, 'off');
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}
