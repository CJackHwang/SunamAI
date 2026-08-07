export { estimateTextTokens } from '@/shared/lib/tokenEstimate';

/**
 * 模型上下文 profile 派生（R4：modelClient.ts 旧路径删除后仅保留此工具）。
 *
 * 旧引擎的 OpenAIChatModelClient / AgentModelClient（llm.ts 的 OpenAI 兼容客户端）
 * 已随旧引擎删除——pi 通道用 pi-ai 的 provider 直连，不再经此客户端。保留
 * profileForModel（pi 压缩阈值对齐现有引擎 90% 语义用）与 estimateTextTokens 透传。
 */
export interface ModelContextProfile { contextWindowTokens: number; defaultOutputTokens: number; summaryReserveTokens: number; safetyBufferTokens: number; }

export function profileForModel(model: string): ModelContextProfile {
  const normalized = model.toLowerCase().trim().split('/').at(-1) ?? '';
  if (/^(?:gpt-4\.1(?:-|$)|gpt-5(?:[.-]\d+)*(?:-|$))/.test(normalized)) return { contextWindowTokens: 1_000_000, defaultOutputTokens: 32_768, summaryReserveTokens: 16_384, safetyBufferTokens: 16_384 };
  if (/^(?:claude-(?:3|4)|o1(?:-|$)|o3(?:-|$)|o4(?:-|$))/.test(normalized)) return { contextWindowTokens: 200_000, defaultOutputTokens: 16_384, summaryReserveTokens: 12_000, safetyBufferTokens: 8_000 };
  if (/^(?:gpt-4o(?:-|$)|deepseek-|qwen(?:\d|2|3|-)|gemini-)/.test(normalized)) return { contextWindowTokens: 128_000, defaultOutputTokens: 8_192, summaryReserveTokens: 8_192, safetyBufferTokens: 4_096 };
  return { contextWindowTokens: 32_768, defaultOutputTokens: 4_096, summaryReserveTokens: 4_096, safetyBufferTokens: 2_048 };
}
