export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_TEXT_RESOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_RESOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_BINARY_RESOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_RESOURCE_BATCH_BYTES = 50 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'jsonl', 'csv', 'tsv', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'graphql', 'vue', 'svelte', 'log']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function resourceKind(file: { name: string; type: string }): 'text' | 'image' | 'binary' {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.type.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(file.type) || TEXT_EXTENSIONS.has(extension)) return 'text';
  if (IMAGE_TYPES.has(file.type)) return 'image';
  return 'binary';
}
