import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import type { FileEntry } from '@/entities/file/types';
import { mapWithConcurrency } from '@/shared/lib/async';
import { isSafeEntryName } from './fileUtils';

export type { FileEntry } from '@/entities/file/types';

const SIZE_CONCURRENCY = 8;

function joinPath(base: string, name: string): string {
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

function isWithinRoot(path: string, rootDir: string): boolean {
  return rootDir === '/' || path === rootDir || path.startsWith(`${rootDir}/`);
}

async function movePath(wc: WebContainer, source: string, destination: string): Promise<void> {
  await wc.fs.rename(source, destination);
}

/** A root-bounded, watched filesystem facade around WebContainer's API. */
export function useFileSystem(wc: WebContainer | null, rootDir = '/') {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState(rootDir);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPathRef = useRef(currentPath);
  const sizeCacheRef = useRef(new Map<string, number>());
  currentPathRef.current = currentPath;

  const navigateTo = useCallback(async (directory: string) => {
    if (!wc) return;
    if (!isWithinRoot(directory, rootDir)) {
      setError('Cannot navigate outside the container root');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rawEntries = await wc.fs.readdir(directory, { withFileTypes: true });
      const listed = await mapWithConcurrency(rawEntries, SIZE_CONCURRENCY, async (entry): Promise<FileEntry> => {
        const path = joinPath(directory, entry.name);
        if (entry.isDirectory()) return { name: entry.name, isDirectory: true, size: 0 };
        const cachedSize = sizeCacheRef.current.get(path);
        if (cachedSize !== undefined) return { name: entry.name, isDirectory: false, size: cachedSize };
        try {
          const content = await wc.fs.readFile(path);
          const size = content.byteLength;
          sizeCacheRef.current.set(path, size);
          return { name: entry.name, isDirectory: false, size };
        } catch {
          return { name: entry.name, isDirectory: false, size: null };
        }
      });
      listed.sort((left, right) => left.isDirectory !== right.isDirectory ? (left.isDirectory ? -1 : 1) : left.name.localeCompare(right.name));
      setEntries(listed);
      setCurrentPath(directory);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.includes('ENOENT') && directory !== rootDir) {
        const parent = directory.substring(0, directory.lastIndexOf('/')) || rootDir;
        queueMicrotask(() => { void navigateTo(parent); });
      } else {
        setEntries([]);
        setError(`Failed to read directory: ${message}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [rootDir, wc]);

  useEffect(() => { if (wc) { setCurrentPath(rootDir); void navigateTo(rootDir); } }, [navigateTo, rootDir, wc]);
  const refresh = useCallback(() => { void navigateTo(currentPathRef.current); }, [navigateTo]);

  useEffect(() => {
    if (!wc || !currentPath) return;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const watcher = wc.fs.watch(currentPath, () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => { if (currentPathRef.current === currentPath) refresh(); }, 300);
    });
    return () => { if (timeoutId) clearTimeout(timeoutId); watcher.close(); };
  }, [currentPath, refresh, wc]);

  const validate = (name: string) => {
    if (!isSafeEntryName(name)) throw new Error('Invalid file or directory name');
  };
  const run = useCallback(async (operation: () => Promise<void>, fallbackError: string) => {
    try { await operation(); refresh(); }
    catch (caught) { setError(`${fallbackError}: ${caught instanceof Error ? caught.message : String(caught)}`); }
  }, [refresh]);
  const goUp = useCallback(() => {
    if (currentPath === rootDir || currentPath === '/') return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    void navigateTo(rootDir !== '/' && !parent.startsWith(rootDir) ? rootDir : parent);
  }, [currentPath, navigateTo, rootDir]);
  const createFile = useCallback(async (name: string, content = '') => { if (!wc) return; await run(async () => { validate(name); await wc.fs.writeFile(joinPath(currentPathRef.current, name), content); }, 'Failed to create file'); }, [run, wc]);
  const createDir = useCallback(async (name: string) => { if (!wc) return; await run(async () => { validate(name); await wc.fs.mkdir(joinPath(currentPathRef.current, name), { recursive: true }); }, 'Failed to create directory'); }, [run, wc]);
  const remove = useCallback(async (name: string) => { if (!wc) return; await run(async () => { validate(name); await wc.fs.rm(joinPath(currentPathRef.current, name), { recursive: true }); }, 'Failed to delete'); }, [run, wc]);
  const rename = useCallback(async (oldName: string, newName: string) => { if (!wc) return; await run(async () => { validate(oldName); validate(newName); await movePath(wc, joinPath(currentPathRef.current, oldName), joinPath(currentPathRef.current, newName)); }, 'Failed to rename'); }, [run, wc]);
  const moveFile = useCallback(async (sourceName: string, destinationDir: string) => { if (!wc) return; await run(async () => { validate(sourceName); if (!isWithinRoot(destinationDir, rootDir)) throw new Error('Cannot move outside the container root'); await movePath(wc, joinPath(currentPathRef.current, sourceName), joinPath(destinationDir, sourceName)); }, 'Failed to move'); }, [rootDir, run, wc]);
  const readFile = useCallback(async (name: string) => { if (!wc) return ''; validate(name); return wc.fs.readFile(joinPath(currentPathRef.current, name), 'utf-8'); }, [wc]);
  const readFileRaw = useCallback(async (name: string) => { if (!wc) return new Uint8Array(); validate(name); return wc.fs.readFile(joinPath(currentPathRef.current, name)); }, [wc]);
  const uploadFile = useCallback(async (file: File) => { if (!wc) return; await run(async () => { validate(file.name); await wc.fs.writeFile(joinPath(currentPathRef.current, file.name), new Uint8Array(await file.arrayBuffer())); }, 'Failed to upload'); }, [run, wc]);
  const uploadFiles = useCallback(async (files: FileList | File[]) => { for (const file of Array.from(files)) await uploadFile(file); }, [uploadFile]);

  return { entries, currentPath, isLoading, error, clearError: () => setError(null), navigateTo, refresh, goUp, createFile, createDir, remove, rename, moveFile, readFile, readFileRaw, uploadFile, uploadFiles };
}
