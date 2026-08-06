import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSystemAPI } from '@webcontainer/api';
import { SuccinixFileSnapshotCoordinator } from '@/features/runtime/succinixFileSnapshot';

// 内存 FS 模拟：Map<path, content>。目录由前缀推导。
class FakeFS {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>(['/']);

  mkdir = vi.fn(async (path: string, _options?: { recursive?: boolean }) => {
    this.dirs.add(path);
    let parent = path.slice(0, path.lastIndexOf('/')) || '/';
    while (parent && parent !== '/') {
      this.dirs.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
    }
    this.dirs.add('/');
  });
  writeFile = vi.fn(async (path: string, content: string | Uint8Array) => {
    this.files.set(path, typeof content === 'string' ? content : new TextDecoder().decode(content));
    await this.mkdir(path.slice(0, path.lastIndexOf('/')) || '/');
  });
  readFile = vi.fn(async (path: string, encoding?: string) => {
    const content = this.files.get(path);
    if (content === undefined) throw new Error('ENOENT');
    return encoding === 'utf-8' || encoding === undefined ? content : new TextEncoder().encode(content);
  });
  readdir = vi.fn(async (path: string) => {
    if (!this.dirs.has(path)) throw new Error('ENOENT');
    const names = new Set<string>();
    const prefix = path === '/' ? '/' : `${path}/`;
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const next = file.slice(prefix.length).split('/')[0];
      if (next) names.add(next);
    }
    for (const dir of this.dirs) {
      if (dir === '/' || !dir.startsWith(prefix)) continue;
      const next = dir.slice(prefix.length).split('/')[0];
      if (next) names.add(next);
    }
    return [...names].map((name) => ({
      name,
      isDirectory: () => this.dirs.has(`${path === '/' ? '' : path}/${name}`),
      isFile: () => this.files.has(`${path === '/' ? '' : path}/${name}`),
    }));
  });
  rm = vi.fn(async (path: string) => { this.files.delete(path); });
  watch = vi.fn(() => ({ close: vi.fn() }));

  has(path: string): boolean { return this.files.has(path); }
  raw(path: string): string | undefined { return this.files.get(path); }
}

function asFileSystemAPI(fs: FakeFS): FileSystemAPI {
  return fs as unknown as FileSystemAPI;
}

async function clearIDB(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('succinix-persist', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('snapshots')) req.result.createObjectStore('snapshots');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

beforeEach(async () => {
  await clearIDB();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('排除规则（R2 职责分离）', () => {
  it('排除 SunamAI 工作区容器目录（c-*）与依赖/构建产物，保留 /etc 与 .pyodide', async () => {
    const src = new FakeFS();
    await src.writeFile('/etc/succinix.env', 'A=1');
    await src.writeFile('/.pyodide/site-packages/purepkg.py', 'x = 1');
    await src.writeFile('/c-1/workspace.txt', 'sunam-workspace');
    await src.writeFile('/c-2/other.txt', 'other-container');
    await src.writeFile('/node_modules/lodash/index.js', 'nope');
    await src.writeFile('/dist/bundle.js', 'nope');
    await src.writeFile('/.git/config', 'nope');
    await src.writeFile('/host.js', 'nope');
    await src.writeFile('/cmd.json', 'nope');
    await src.writeFile('/result-42.json', 'nope');

    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(src));
    const result = await coordinator.flush();
    expect(result.skipped).toBe(false);
    expect(result.meta.fileCount).toBe(2); // /etc/succinix.env + /.pyodide/site-packages/purepkg.py
    coordinator.dispose();

    // 恢复到干净 FS：工作区目录不恢复（v3 负责），系统层全部恢复。
    const dst = new FakeFS();
    const restoreCoordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(dst));
    const meta = await restoreCoordinator.restore();
    restoreCoordinator.dispose();
    expect(meta).not.toBeNull();
    expect(dst.raw('/etc/succinix.env')).toBe('A=1');
    expect(dst.raw('/.pyodide/site-packages/purepkg.py')).toBe('x = 1');
    expect(dst.has('/c-1/workspace.txt')).toBe(false);
    expect(dst.has('/c-2/other.txt')).toBe(false);
    expect(dst.has('/node_modules/lodash/index.js')).toBe(false);
  });

  it('排除 /usr/lib/succinix 资产前缀与 .tinbase 二进制目录', async () => {
    const src = new FakeFS();
    await src.writeFile('/usr/lib/succinix/python/python-daemon.js', 'asset');
    await src.writeFile('/usr/lib/succinix/python/pyodide.asm.wasm', 'binary');
    await src.writeFile('/.tinbase/db', 'pg-data');
    await src.writeFile('/etc/succinix.cwd', '/workspace');
    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(src));
    const result = await coordinator.flush();
    expect(result.skipped).toBe(false);
    expect(result.meta.fileCount).toBe(1); // 仅 /etc/succinix.cwd
    coordinator.dispose();
  });
});

describe('roundtrip', () => {
  it('保存后恢复到干净 FS（含空目录）', async () => {
    const src = new FakeFS();
    await src.writeFile('/etc/succinix.env', 'A=1');
    await src.mkdir('/var/empty', { recursive: true });
    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(src));
    await coordinator.flush();
    coordinator.dispose();

    const dst = new FakeFS();
    const restoreCoordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(dst));
    const meta = await restoreCoordinator.restore();
    restoreCoordinator.dispose();
    expect(meta?.fileCount).toBe(1);
    expect(dst.raw('/etc/succinix.env')).toBe('A=1');
    expect(dst.dirs.has('/var/empty')).toBe(true);
  });

  it('无快照时 restore 返回 null（全新系统）', async () => {
    const fs = new FakeFS();
    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(fs));
    await expect(coordinator.restore()).resolves.toBeNull();
    coordinator.dispose();
  });
});

describe('去重与生命周期', () => {
  it('内容未变的非 force 保存复用上次结果，force 捕获等长内容修改', async () => {
    const src = new FakeFS();
    await src.writeFile('/etc/succinix.env', 'AAAA');
    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(src), 1_000);
    const first = await coordinator.flush(); // force 初次入库

    // 非 force（snapshot）：内容/结构未变 → 复用上次结果，savedAt 不变。
    const dedup = await coordinator.snapshot();
    expect(dedup.meta.savedAt).toBe(first.meta.savedAt);

    // 等长内容修改：readdir 签名不变（无 size），非 force 仍复用旧结果（AAAA）。
    await src.writeFile('/etc/succinix.env', 'BBBB');
    const stale = await coordinator.snapshot();
    expect(stale.meta.savedAt).toBe(first.meta.savedAt);

    // force flush → 全量遍历 → 新内容入库。
    await coordinator.flush();
    coordinator.dispose();

    const dst = new FakeFS();
    const restoreCoordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(dst));
    await restoreCoordinator.restore();
    restoreCoordinator.dispose();
    expect(dst.raw('/etc/succinix.env')).toBe('BBBB');
  });

  it('start 后按间隔自动保存（非 force），dispose 停止定时器', async () => {
    const src = new FakeFS();
    await src.writeFile('/etc/succinix.env', 'A=1');
    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(src), 5);
    coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 30)); // 多个自动 tick
    coordinator.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30)); // dispose 后不再触发

    const dst = new FakeFS();
    const restoreCoordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(dst));
    const meta = await restoreCoordinator.restore();
    restoreCoordinator.dispose();
    expect(meta?.fileCount).toBe(1);
    expect(dst.raw('/etc/succinix.env')).toBe('A=1');
  });

  it('dispose 后 restore/flush 安全返回，不再保存', async () => {
    const src = new FakeFS();
    await src.writeFile('/etc/succinix.env', 'A=1');
    const coordinator = new SuccinixFileSnapshotCoordinator(asFileSystemAPI(src));
    coordinator.dispose();
    await expect(coordinator.restore()).resolves.toBeNull();
    const result = await coordinator.flush();
    expect(result.skipped).toBe(false);
    coordinator.dispose();
  });
});
