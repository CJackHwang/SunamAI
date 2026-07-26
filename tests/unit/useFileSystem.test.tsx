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
    expect(fixture.fs.readFile).not.toHaveBeenCalled();
    expect(result.current.entries.find((entry) => entry.name === 'existing.txt')?.size).toBeNull();
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
});
