/** Safely extracts a chat tool message while its JSON arguments are still streaming. */
export function extractChatContent(argsString: string): string {
  if (!argsString) return '';
  try {
    const parsed = JSON.parse(argsString) as { message?: string; question?: string };
    return parsed.message || parsed.question || '';
  } catch {
    const match = argsString.match(/"message"\s*:\s*"([\s\S]*)/);
    return match ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
  }
}
