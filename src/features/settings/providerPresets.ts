import type { ProviderApi } from '@/shared/config/providers';

/**
 * R4：供应商预设清单（派生自 `@earendil-works/pi-ai` 的 provider 工厂）。
 * 只在设置页「供应商」栏目消费，故放在 feature 内随设置页懒加载，不进初始 bundle。
 */

export interface ProviderPreset {
  id: string;
  name: string;
  defaultBaseUrl: string;
  api: ProviderApi;
  defaultModel: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', defaultModel: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', api: 'openai-completions', defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', defaultModel: 'claude-sonnet-4-5' },
  { id: 'openrouter', name: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', defaultModel: 'openai/gpt-4o-mini' },
  { id: 'groq', name: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', defaultModel: 'llama-3.3-70b-versatile' },
  { id: 'mistral', name: 'Mistral', defaultBaseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions', defaultModel: 'mistral-large-latest' },
  { id: 'xai', name: 'xAI', defaultBaseUrl: 'https://api.x.ai/v1', api: 'openai-completions', defaultModel: 'grok-2-latest' },
  { id: 'cerebras', name: 'Cerebras', defaultBaseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions', defaultModel: 'llama-3.3-70b' },
  { id: 'together', name: 'Together', defaultBaseUrl: 'https://api.together.ai/v1', api: 'openai-completions', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'fireworks', name: 'Fireworks', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  { id: 'moonshotai', name: 'Moonshot AI', defaultBaseUrl: 'https://api.moonshot.ai/v1', api: 'openai-completions', defaultModel: 'moonshot-v1-8k' },
  { id: 'minimax', name: 'MiniMax', defaultBaseUrl: 'https://api.minimax.io/anthropic', api: 'anthropic-messages', defaultModel: 'MiniMax-Text-01' },
  { id: 'zai', name: 'Z.AI', defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4', api: 'openai-completions', defaultModel: 'zai-v4' },
  { id: 'huggingface', name: 'Hugging Face', defaultBaseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions', defaultModel: 'microsoft/phi-4' },
  { id: 'nvidia', name: 'NVIDIA', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', defaultModel: 'meta/llama-3.3-70b-instruct' },
  { id: 'kimi-coding', name: 'Kimi For Coding', defaultBaseUrl: 'https://api.kimi.com/coding', api: 'openai-completions', defaultModel: 'kimi-coding-v2' },
] as const;

export function getProviderPreset(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId);
}
