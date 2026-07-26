export function redactSecrets(value: string): string {
  return value
    .replace(/\b(sk-[a-zA-Z0-9_-]{8,})\b/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["'\s:=]+)[^\s,"'}]+/gi, '$1[REDACTED]');
}

export function toErrorMessage(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

export function isNotFoundError(error: unknown): boolean {
  return /(?:ENOENT|not found|does not exist)/i.test(toErrorMessage(error));
}
