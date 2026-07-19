import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/config/models';
import { readAppSettings, saveConnectionSettings, saveSunamModel } from '@/shared/lib/settings';
import { STORAGE_KEYS, ensureStorageSchema, readJson, readText, writeJson } from '@/shared/lib/storage';

describe('storage compatibility', () => {
  beforeEach(() => localStorage.clear());

  it('uses the historical settings keys and defaults', () => {
    expect(readAppSettings()).toEqual({ apiKey: '', ...DEFAULT_SETTINGS });
    saveConnectionSettings({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiModel: 'model-a' });
    saveSunamModel('Sunam 5.14 Saki');
    expect(readAppSettings()).toEqual({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiModel: 'model-a', sunamModel: 'Sunam 5.14 Saki' });
    expect(localStorage.getItem(STORAGE_KEYS.apiKey)).toBe('key');
  });

  it('keeps corrupted data recoverable and continues with a fallback', () => {
    localStorage.setItem('broken', '{not-json');
    expect(readJson('broken', { recovered: true })).toEqual({ recovered: true });
    expect(Object.keys(localStorage).some((key) => key.startsWith('broken_corrupt_'))).toBe(true);
  });

  it('migrates by adding a schema marker without replacing existing values', () => {
    localStorage.setItem(STORAGE_KEYS.apiKey, 'legacy-key');
    ensureStorageSchema();
    expect(readText(STORAGE_KEYS.apiKey)).toBe('legacy-key');
    expect(localStorage.getItem(STORAGE_KEYS.schemaVersion)).toBe('2');
    writeJson('value', { ok: true });
    expect(readJson('value', { ok: false })).toEqual({ ok: true });
  });
});
