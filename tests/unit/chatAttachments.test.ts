import { describe, expect, it } from 'vitest';
import { MAX_CHAT_ATTACHMENT_BYTES, readChatAttachments } from '@/features/chat/lib/chatAttachments';

describe('chat attachments', () => {
  it('reads textual chat context without touching the workspace', async () => {
    await expect(readChatAttachments([new File(['hello'], 'notes.md', { type: 'text/markdown' })])).resolves.toEqual([
      { name: 'notes.md', size: 5, content: 'hello' },
    ]);
  });

  it('rejects binary and oversized attachments', async () => {
    await expect(readChatAttachments([new File(['binary'], 'photo.png', { type: 'image/png' })])).rejects.toThrow('supported text file');
    await expect(readChatAttachments([new File([new Uint8Array(MAX_CHAT_ATTACHMENT_BYTES + 1)], 'large.txt', { type: 'text/plain' })])).rejects.toThrow('larger than 500 KB');
  });
});
