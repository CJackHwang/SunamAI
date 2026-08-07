import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearContainerUnavailable,
  isContainerUnavailable,
  markContainerUnavailable,
} from '@/features/runtime/containerUnavailable';
import { STORAGE_KEYS } from '@/shared/lib/storage';

// R2：受限环境持久化标记 —— localStorage round-trip。真实 localStorage（jsdom）验证
// 标记写入/读取/清除，覆盖"触发一次 → 下次不自动开启 → 手动重试清除"的持久化行为。

describe('container unavailable marker (R2 persistence)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts unrecorded (no marker)', () => {
    expect(isContainerUnavailable()).toBe(false);
  });

  it('records the marker after a restricted trigger and reads it back', () => {
    markContainerUnavailable();
    expect(localStorage.getItem(STORAGE_KEYS.containerUnavailable)).toBe('1');
    expect(isContainerUnavailable()).toBe(true);
  });

  it('clears the marker on manual retry so the next detection re-checks', () => {
    markContainerUnavailable();
    expect(isContainerUnavailable()).toBe(true);
    clearContainerUnavailable();
    expect(isContainerUnavailable()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.containerUnavailable)).toBeNull();
  });

  it('clearing a non-existent marker is a no-op', () => {
    expect(() => clearContainerUnavailable()).not.toThrow();
    expect(isContainerUnavailable()).toBe(false);
  });
});
