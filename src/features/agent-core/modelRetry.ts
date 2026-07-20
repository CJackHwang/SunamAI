import { toErrorMessage } from '@/shared/lib/errors';

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRetryableModelError(error: unknown): boolean {
  return /\b429\b|\b5\d\d\b|network|fetch/i.test(toErrorMessage(error));
}

export async function retryModelRequest<T>(request: () => Promise<T>, onRetry: (attempt: number, delayMs: number, error: string) => Promise<void>): Promise<T> {
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(toErrorMessage(lastError));
}
