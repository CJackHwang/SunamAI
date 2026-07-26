import { redactSecrets } from '@/shared/lib/errors';

export type LLMErrorCode = 'http_error' | 'invalid_response' | 'stream_error' | 'stream_buffer_limit' | 'network_error';

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(code: LLMErrorCode, message: string, options: { status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'LLMError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export function sanitizeProviderError(value: string): string {
  return redactSecrets(value.slice(0, 2_000));
}
