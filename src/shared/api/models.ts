import { LLMError, sanitizeProviderError } from './llmError';

function modelIds(value: unknown): string[] | null {
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data)) return null;
  const ids: string[] = [];
  for (const entry of value.data) {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string') return null;
    ids.push(entry.id);
  }
  return ids;
}

export async function listModels(apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LLMError('network_error', 'The model list request could not reach the provider.', { retryable: true, cause: error });
  }
  if (!response.ok) throw new LLMError('http_error', `Model API Error (${response.status}): ${sanitizeProviderError(await response.text())}`, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
  let payload: unknown;
  try { payload = await response.json(); }
  catch (error) { throw new LLMError('invalid_response', 'The model provider returned invalid model-list JSON.', { cause: error }); }
  const ids = modelIds(payload);
  if (!ids) throw new LLMError('invalid_response', 'The model provider returned an invalid model-list schema.');
  return ids;
}
