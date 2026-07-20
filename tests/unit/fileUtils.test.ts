import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '@/shared/lib/async';
import { formatSize, getExtension, isPreviewableFile, isSafeEntryName } from '@/features/file-manager/fileUtils';

describe('file helpers', () => {
  it('formats and validates file metadata', () => {
    expect(getExtension('photo.JPG')).toBe('jpg');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(0)).toBe('—');
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(null)).toBe('未知');
    expect(isPreviewableFile('README.md')).toBe(true);
    expect(isPreviewableFile('.env')).toBe(true);
    expect(isPreviewableFile('photo.png')).toBe(true);
    expect(isPreviewableFile('archive.zip')).toBe(false);
    expect(isSafeEntryName('../secret')).toBe(false);
    expect(isSafeEntryName('')).toBe(false);
    expect(isSafeEntryName('src')).toBe(true);
  });

  it('limits async work while preserving source order', async () => {
    let active = 0;
    let maxActive = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });
    expect(values).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
