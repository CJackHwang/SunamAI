import { toErrorMessage } from '@/shared/lib/errors';
import { LLMError } from '@/shared/api/llmError';

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isPromptTooLongModelError(error: unknown): boolean {
  return error instanceof LLMError
    && error.code === 'http_error'
    && [400, 413, 422].includes(error.status ?? 0)
    && /(?:context|token|prompt|length|too large|too long|maximum)/i.test(error.message);
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof LLMError) return error.retryable;
  return /\b429\b|\b5\d\d\b|network|fetch/i.test(toErrorMessage(error));
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Agent stopped by user.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('Agent stopped by user.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retryModelRequest<T>(request: () => Promise<T>, onRetry: (attempt: number, delayMs: number, error: string) => Promise<void>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (!isRetryableModelError(error) || attempt === 2) break;
      const delayMs = Math.min(8_000, 500 * (2 ** attempt)) + Math.round(Math.random() * 150);
      await onRetry(attempt + 1, delayMs, toErrorMessage(error));
      await abortableDelay(delayMs, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(toErrorMessage(lastError));
}
