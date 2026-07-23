import { callLLM } from '@/shared/api/llm';

interface TitleConfig { apiKey: string; baseUrl: string; model: string; }

const TITLE_PROMPT = '请根据用户的这句话总结一个会话标题，字数不超过15个字。标题必须精准、专业地概括用户的核心意图。直接输出标题文本，不要包含任何多余的标点符号或解释说明。用户的话是：';

export async function generateTitle(input: string, config: TitleConfig): Promise<string> {
  const response = await callLLM([{ role: 'user', content: `${TITLE_PROMPT}${input}` }], config);
  return response.content.trim().replace(/^"|"$/g, '');
}

export async function generateAutoTitle(input: string, config: TitleConfig): Promise<string> {
  const response = await callLLM([{ role: 'user', content: `请根据以下提示总结一个会话标题，字数不超过15个字。标题必须精准、专业地概括任务的核心意图。直接输出标题文本，不要包含任何多余的标点符号或解释说明。提示是：${input}` }], config);
  return response.content.trim().replace(/^"|"$/g, '');
}
