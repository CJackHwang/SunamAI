import type { ChatAttachment } from '@/entities/message/types';
import { MAX_BINARY_RESOURCE_BYTES, MAX_CHAT_ATTACHMENTS, MAX_IMAGE_RESOURCE_BYTES, MAX_RESOURCE_BATCH_BYTES, MAX_TEXT_RESOURCE_BYTES, resourceKind } from '@/shared/contracts/resourcePolicy';

export { MAX_BINARY_RESOURCE_BYTES, MAX_CHAT_ATTACHMENTS, MAX_IMAGE_RESOURCE_BYTES, MAX_RESOURCE_BATCH_BYTES, MAX_TEXT_RESOURCE_BYTES } from '@/shared/contracts/resourcePolicy';

/** Validates selections without reading file bodies into React state or the prompt. */
export async function readChatAttachments(files: File[]): Promise<ChatAttachment[]> {
  if (files.length > MAX_CHAT_ATTACHMENTS) throw new Error(`Choose at most ${MAX_CHAT_ATTACHMENTS} files.`);
  const total = files.reduce((size, file) => size + file.size, 0);
  if (total > MAX_RESOURCE_BATCH_BYTES) throw new Error('The selected resource batch is larger than 50 MiB.');
  return files.map((file) => {
    const kind = resourceKind(file);
    const limit = kind === 'text' ? MAX_TEXT_RESOURCE_BYTES : kind === 'image' ? MAX_IMAGE_RESOURCE_BYTES : MAX_BINARY_RESOURCE_BYTES;
    if (file.size > limit) throw new Error(`${file.name} is larger than the ${limit / 1024 / 1024} MiB ${kind} resource limit.`);
    return { name: file.name, size: file.size, type: file.type || 'application/octet-stream', file };
  });
}
