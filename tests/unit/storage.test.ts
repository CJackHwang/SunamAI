import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/config/models';
import { readAppSettings, saveConnectionSettings, saveSunamModel } from '@/shared/lib/settings';
import { STORAGE_KEYS, readJson, writeJson } from '@/shared/lib/storage';

describe('v2 settings storage', () => {
  beforeEach(() => localStorage.clear());

  it('uses the fresh v2 keys and defaults', () => {
    expect(readAppSettings()).toEqual({ apiKey: '', ...DEFAULT_SETTINGS });
    saveConnectionSettings({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiModel: 'model-a' });
    saveSunamModel('Sunam 5.14 Saki');
    expect(readAppSettings()).toEqual({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiModel: 'model-a', sunamModel: 'Sunam 5.14 Saki' });
    expect(localStorage.getItem(STORAGE_KEYS.apiKey)).toBe('key');
  });

  it('ignores malformed values and continues with a fallback', () => {
    localStorage.setItem('broken', '{not-json');
    expect(readJson('broken', { recovered: true })).toEqual({ recovered: true });
    expect(Object.keys(localStorage).some((key) => key.startsWith('broken_corrupt_'))).toBe(false);
  });

  it('does not import settings from legacy keys', () => {
    localStorage.setItem('sunam_api_key', 'old-key');
    expect(readAppSettings().apiKey).toBe('');
    localStorage.setItem(STORAGE_KEYS.apiKey, 'v2-key');
    expect(readAppSettings().apiKey).toBe('v2-key');
    writeJson('value', { ok: true });
    expect(readJson('value', { ok: false })).toEqual({ ok: true });
  });
});
