import type { ChatAttachment } from '@/entities/message/types';

export const MAX_CHAT_ATTACHMENT_BYTES = 512_000;
export const MAX_CHAT_ATTACHMENTS = 8;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'jsonl', 'csv', 'tsv', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'graphql', 'vue', 'svelte', 'log']);

function isTextFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(file.type) || TEXT_EXTENSIONS.has(extension);
}

export async function readChatAttachments(files: File[]): Promise<ChatAttachment[]> {
  if (files.length > MAX_CHAT_ATTACHMENTS) throw new Error(`Choose at most ${MAX_CHAT_ATTACHMENTS} files.`);
  return Promise.all(files.map(async (file) => {
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 500 KB.`);
    if (!isTextFile(file)) throw new Error(`${file.name} is not a supported text file.`);
    return { name: file.name, size: file.size, content: await file.text() };
  }));
}
