import { describe, expect, it } from 'vitest';
import { MAX_BINARY_RESOURCE_BYTES, MAX_CHAT_ATTACHMENTS, MAX_IMAGE_RESOURCE_BYTES, MAX_RESOURCE_BATCH_BYTES, MAX_TEXT_RESOURCE_BYTES, readChatAttachments } from '@/features/chat/lib/chatAttachments';

describe('chat attachments', () => {
  it('keeps file handles without reading bodies into prompt state', async () => {
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    await expect(readChatAttachments([file])).resolves.toEqual([
      { name: 'notes.md', size: 5, type: 'text/markdown', file },
    ]);
  });

  it('accepts binary resources and rejects oversized text resources', async () => {
    await expect(readChatAttachments([new File(['binary'], 'archive.zip', { type: 'application/zip' })])).resolves.toHaveLength(1);
    await expect(readChatAttachments([new File([new Uint8Array(MAX_TEXT_RESOURCE_BYTES + 1)], 'large.txt', { type: 'text/plain' })])).rejects.toThrow('2 MiB text resource limit');
  });

  it('enforces count, image, binary, and aggregate resource budgets before processing bodies', async () => {
    const tiny = () => new File(['x'], 'x.txt', { type: 'text/plain' });
    await expect(readChatAttachments(Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, tiny))).rejects.toThrow('at most 8');
    await expect(readChatAttachments([new File([new Uint8Array(MAX_IMAGE_RESOURCE_BYTES + 1)], 'large.png', { type: 'image/png' })])).rejects.toThrow('10 MiB image');
    await expect(readChatAttachments([new File([new Uint8Array(MAX_BINARY_RESOURCE_BYTES + 1)], 'large.zip', { type: 'application/zip' })])).rejects.toThrow('20 MiB binary');
    const batch = Array.from({ length: 3 }, (_, index) => new File([new Uint8Array(Math.floor(MAX_RESOURCE_BATCH_BYTES / 3) + 1)], `${index}.zip`, { type: 'application/zip' }));
    await expect(readChatAttachments(batch)).rejects.toThrow('larger than 50 MiB');
  });
});
