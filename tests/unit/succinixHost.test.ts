import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SuccinixClient } from '@/features/runtime/succinixClient';
import { bootSuccinixHost, waitForHostReady } from '@/features/runtime/succinixHost';

// N3：boot 失败路径（host 未就绪）必须杀掉刚拉起的 host，防止重试时第二个 host 争抢 /cmd.json。
// host.js 资产由 fetch 桩提供；webcontainer.fs 初始为空 → ensureAsset 触发注入。

function createBootFixture() {
  const files = new Map<string, string>();
  const fs = {
    readFile: vi.fn(async (path: string) => {
      if (files.has(path)) return files.get(path);
      throw new Error('ENOENT');
    }),
    writeFile: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
    mkdir: vi.fn(async () => undefined),
  };
  const kill = vi.fn();
  const hostProcess = { kill, exit: Promise.resolve(-1) };
  const spawn = vi.fn(async () => hostProcess);
  const webcontainer = { fs, spawn };
  const client = { ping: vi.fn(async () => false) } as unknown as SuccinixClient;
  return { files, fs, kill, hostProcess, spawn, webcontainer, client };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('waitForHostReady', () => {
  it('returns as soon as the host answers the liveness probe', async () => {
    const client = { ping: vi.fn(async () => true) } as unknown as SuccinixClient;
    await expect(waitForHostReady(client)).resolves.toBeUndefined();
    expect(client.ping).toHaveBeenCalled();
  });

  it('throws within its deadline when the host never becomes ready', async () => {
    const client = { ping: vi.fn(async () => false) } as unknown as SuccinixClient;
    await expect(waitForHostReady(client, 50)).rejects.toThrow('did not become ready');
  });
});

describe('bootSuccinixHost', () => {
  it('injects host.js, spawns the host, and kills it when readiness times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'host-js-content',
      arrayBuffer: async () => new Uint8Array(0),
    })) as never);
    const { files, kill, spawn, webcontainer, client } = createBootFixture();

    await expect(bootSuccinixHost(webcontainer as never, client, 50)).rejects.toThrow('did not become ready');

    expect(files.get('/host.js')).toBe('host-js-content');
    expect(spawn).toHaveBeenCalledWith('node', ['host.js']);
    // 失败路径必须 kill hostProcess，避免重试拉起第二个 host 争抢 /cmd.json。
    expect(kill).toHaveBeenCalledOnce();
  });
});
