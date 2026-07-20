export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNotFoundError(error: unknown): boolean {
  return /(?:ENOENT|not found|does not exist)/i.test(toErrorMessage(error));
}
