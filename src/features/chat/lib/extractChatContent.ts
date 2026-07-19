/** Safely extracts a chat tool message while its JSON arguments are still streaming. */
export function extractChatContent(argsString: string): string {
  if (!argsString) return '';
  try {
    return JSON.parse(argsString).message || '';
  } catch {
    const match = argsString.match(/"message"\s*:\s*"([\s\S]*)/);
    return match ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
  }
}
