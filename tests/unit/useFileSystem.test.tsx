import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { useFileSystem } from '@/features/file-manager/useFileSystem';

type Node = { directory: boolean; content?: Uint8Array };

function createWebContainerFixture() {
  const nodes = new Map<string, Node>([
    ['/c', { directory: true }], ['/c/existing.txt', { directory: false, content: new TextEncoder().encode('old') }], ['/c/target', { directory: true }],
  ]);
  const children = (directory: string) => Array.from(nodes.entries()).flatMap(([path, node]) => {
    const prefix = directory === '/' ? '/' : `${directory}/`;
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    return rest && !rest.includes('/') ? [{ name: rest, isDirectory: () => node.directory, isFile: () => !node.directory }] : [];
  });
  const fixture = {
    fs: {
      readdir: async (path: string) => children(path),
      readFile: vi.fn(async (path: string, encoding?: string | null) => {
        const content = nodes.get(path)?.content;
        if (!content) throw new Error('ENOENT');
        return encoding ? new TextDecoder().decode(content) : content;
      }),
      writeFile: async (path: string, data: string | Uint8Array) => { nodes.set(path, { directory: false, content: typeof data === 'string' ? new TextEncoder().encode(data) : data }); },
      mkdir: async (path: string) => { nodes.set(path, { directory: true }); return path; },
      rm: async (path: string) => { for (const key of Array.from(nodes.keys())) if (key === path || key.startsWith(`${path}/`)) nodes.delete(key); },
      rename: async (oldPath: string, newPath: string) => {
        const replacements = Array.from(nodes.entries()).filter(([path]) => path === oldPath || path.startsWith(`${oldPath}/`));
        for (const [path, node] of replacements) { nodes.delete(path); nodes.set(`${newPath}${path.slice(oldPath.length)}`, node); }
      },
      watch: () => ({ close: () => undefined }),
    },
  };
  return { fixture: fixture as unknown as WebContainer, nodes };
}

describe('useFileSystem', () => {
  it('creates, renames, moves and removes files without escaping its root', async () => {
    const { fixture, nodes } = createWebContainerFixture();
    const { result } = renderHook(() => useFileSystem(fixture, '/c'));
    await waitFor(() => expect(result.current.entries.map((entry) => entry.name)).toEqual(['target', 'existing.txt']));
    expect(fixture.fs.readFile).toHaveBeenCalledWith('/c/existing.txt');
    expect(result.current.entries.find((entry) => entry.name === 'existing.txt')?.size).toBe(3);
    await act(async () => { await result.current.readFileRaw('existing.txt'); });
    expect(result.current.entries.find((entry) => entry.name === 'existing.txt')?.size).toBe(3);
    await act(async () => { await result.current.createFile('new.txt', 'new'); });
    await waitFor(() => expect(nodes.has('/c/new.txt')).toBe(true));
    await act(async () => { await result.current.rename('new.txt', 'renamed.txt'); });
    await waitFor(() => expect(nodes.has('/c/renamed.txt')).toBe(true));
    await act(async () => { await result.current.moveFile('renamed.txt', '/c/target'); });
    await waitFor(() => expect(nodes.has('/c/target/renamed.txt')).toBe(true));
    await act(async () => { await result.current.navigateTo('/c/target'); });
    expect(result.current.parentPath).toBe('/c');
    await act(async () => { await result.current.moveFile('renamed.txt', result.current.parentPath!); });
    await waitFor(() => expect(nodes.has('/c/renamed.txt')).toBe(true));
    act(() => { result.current.goUp(); });
    await waitFor(() => expect(result.current.currentPath).toBe('/c'));
    await act(async () => { await result.current.remove('existing.txt'); });
    await waitFor(() => expect(nodes.has('/c/existing.txt')).toBe(false));
    await act(async () => { await result.current.createFile('../escape.txt'); });
    await waitFor(() => expect(result.current.error).toContain('Invalid file or directory name'));
    expect(nodes.has('/escape.txt')).toBe(false);
    await act(async () => { await result.current.navigateTo('/outside'); });
    expect(result.current.error).toContain('Cannot navigate outside the container root');
  });

  it('ignores a stale directory read after switching container roots', async () => {
    let resolveOld!: (entries: Array<{ name: string; isDirectory: () => boolean }>) => void;
    const fixture = {
      fs: {
        readdir: vi.fn((path: string) => path === '/old'
          ? new Promise<Array<{ name: string; isDirectory: () => boolean }>>((resolve) => { resolveOld = resolve; })
          : Promise.resolve([{ name: 'current.txt', isDirectory: () => false }])),
        watch: () => ({ close: () => undefined }),
      },
    } as unknown as WebContainer;
    const { result, rerender } = renderHook(({ root }) => useFileSystem(fixture, root), { initialProps: { root: '/old' } });

    rerender({ root: '/new' });
    await waitFor(() => expect(result.current.currentPath).toBe('/new'));
    await waitFor(() => expect(result.current.entries.map((entry) => entry.name)).toEqual(['current.txt']));
    await act(async () => { resolveOld([{ name: 'stale.txt', isDirectory: () => false }]); await Promise.resolve(); });

    expect(result.current.currentPath).toBe('/new');
    expect(result.current.entries.map((entry) => entry.name)).toEqual(['current.txt']);
  });

  it('limits concurrent size reads and preserves unknown size for one unreadable file', async () => {
    let activeReads = 0;
    let peakReads = 0;
    const files = Array.from({ length: 12 }, (_, index) => ({ name: `file-${index}.txt`, isDirectory: () => false }));
    const fixture = {
      fs: {
        readdir: vi.fn(async () => files),
        readFile: vi.fn(async (path: string) => {
          activeReads += 1;
          peakReads = Math.max(peakReads, activeReads);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeReads -= 1;
          if (path.endsWith('file-11.txt')) throw new Error('EACCES');
          return new Uint8Array([1, 2, 3, 4]);
        }),
        watch: () => ({ close: () => undefined }),
      },
    } as unknown as WebContainer;

    const { result } = renderHook(() => useFileSystem(fixture, '/c'));
    await waitFor(() => expect(result.current.entries).toHaveLength(12));
    expect(peakReads).toBeLessThanOrEqual(8);
    expect(peakReads).toBeGreaterThan(1);
    expect(result.current.entries.find((entry) => entry.name === 'file-0.txt')?.size).toBe(4);
    expect(result.current.entries.find((entry) => entry.name === 'file-11.txt')?.size).toBeNull();
  });

  it('ignores stale file sizes when a newer directory navigation finishes first', async () => {
    let resolveSlowRead!: (content: Uint8Array) => void;
    let markSlowReadStarted!: () => void;
    const slowReadStarted = new Promise<void>((resolve) => { markSlowReadStarted = resolve; });
    const fixture = {
      fs: {
        readdir: vi.fn(async (path: string) => path === '/c'
          ? []
          : [{ name: path.endsWith('/slow') ? 'stale.txt' : 'current.txt', isDirectory: () => false }]),
        readFile: vi.fn((path: string) => {
          if (path.endsWith('/stale.txt')) {
            markSlowReadStarted();
            return new Promise<Uint8Array>((resolve) => { resolveSlowRead = resolve; });
          }
          return Promise.resolve(new Uint8Array([1, 2, 3]));
        }),
        watch: () => ({ close: () => undefined }),
      },
    } as unknown as WebContainer;
    const { result } = renderHook(() => useFileSystem(fixture, '/c'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let slowNavigation!: Promise<void>;
    act(() => { slowNavigation = result.current.navigateTo('/c/slow'); });
    await slowReadStarted;
    await act(async () => { await result.current.navigateTo('/c/current'); });
    expect(result.current.currentPath).toBe('/c/current');
    expect(result.current.entries).toEqual([{ name: 'current.txt', isDirectory: false, size: 3 }]);

    await act(async () => {
      resolveSlowRead(new Uint8Array([1, 2, 3, 4, 5]));
      await slowNavigation;
    });
    expect(result.current.currentPath).toBe('/c/current');
    expect(result.current.entries).toEqual([{ name: 'current.txt', isDirectory: false, size: 3 }]);
  });
});
