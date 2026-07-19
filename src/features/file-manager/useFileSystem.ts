import { useState, useCallback, useRef, useEffect } from 'react';
import { WebContainer } from '@webcontainer/api';

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  /** Approximate size in bytes (0 for directories) */
  size: number;
}

/**
 * Hook that wraps WebContainer's filesystem API with convenient operations.
 * All paths are absolute (e.g. '/src/index.ts').
 */
export function useFileSystem(wc: WebContainer | null, rootDir: string = '/') {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState(rootDir);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  /** Join path segments cleanly */
  const joinPath = (base: string, name: string): string => {
    if (base === '/') return `/${name}`;
    return `${base}/${name}`;
  };

  /** Navigate to a directory and list its contents */
  const navigateTo = useCallback(async (dirPath: string) => {
    if (!wc) return;
    setIsLoading(true);
    setError(null);

    try {
      const rawEntries = await wc.fs.readdir(dirPath, { withFileTypes: true });
      const fileEntries: FileEntry[] = [];

      for (const entry of rawEntries) {
        const isDir = entry.isDirectory();
        let size = 0;

        if (!isDir) {
          try {
            const content = await wc.fs.readFile(joinPath(dirPath, entry.name), 'utf-8');
            size = new Blob([content]).size;
          } catch {
            // Binary or unreadable — estimate as 0
          }
        }

        fileEntries.push({
          name: entry.name,
          isDirectory: isDir,
          size,
        });
      }

      // Sort: directories first, then alphabetically
      fileEntries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setEntries(fileEntries);
      setCurrentPath(dirPath);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes('ENOENT') && dirPath !== '/') {
        // If current directory was deleted, fallback to parent
        const parent = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
        setTimeout(() => navigateTo(parent), 0);
      } else {
        setError(`Failed to read directory: ${err}`);
        setEntries([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [wc]);

  useEffect(() => {
    if (wc) {
      setCurrentPath(rootDir);
      navigateTo(rootDir);
    }
  }, [rootDir, navigateTo, wc]);

  /** Refresh the current directory listing */
  const refresh = useCallback(() => {
    navigateTo(currentPathRef.current);
  }, [navigateTo]);

  /** Watch for file changes in the current directory */
  useEffect(() => {
    if (!wc || currentPath === '') return;
    
    let watcher: any = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      watcher = wc.fs.watch(currentPath, () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (currentPathRef.current === currentPath) {
            refresh();
          }
        }, 500); // 500ms debounce
      });
    } catch (err) {
      console.warn('Failed to watch directory:', err);
    }

    return () => {
      clearTimeout(timeoutId);
      if (watcher && typeof watcher.close === 'function') {
        watcher.close();
      }
    };
  }, [wc, currentPath, refresh]);

  /** Go up one directory level */
  const goUp = useCallback(() => {
    if (currentPath === rootDir || currentPath === '/') return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    if (!parent.startsWith(rootDir) && rootDir !== '/') {
      navigateTo(rootDir);
    } else {
      navigateTo(parent);
    }
  }, [currentPath, navigateTo, rootDir]);

  /** Create a new file */
  const createFile = useCallback(async (name: string, content: string = '') => {
    if (!wc) return;
    const filePath = joinPath(currentPathRef.current, name);
    try {
      await wc.fs.writeFile(filePath, content);
      refresh();
    } catch (err) {
      setError(`Failed to create file: ${err}`);
    }
  }, [wc, refresh]);

  /** Create a new directory */
  const createDir = useCallback(async (name: string) => {
    if (!wc) return;
    const dirPath = joinPath(currentPathRef.current, name);
    try {
      await wc.fs.mkdir(dirPath, { recursive: true });
      refresh();
    } catch (err) {
      setError(`Failed to create directory: ${err}`);
    }
  }, [wc, refresh]);

  /** Delete a file or directory */
  const remove = useCallback(async (name: string) => {
    if (!wc) return;
    const targetPath = joinPath(currentPathRef.current, name);
    try {
      await wc.fs.rm(targetPath, { recursive: true });
      refresh();
    } catch (err) {
      setError(`Failed to delete: ${err}`);
    }
  }, [wc, refresh]);

  /** Rename a file or directory (read → write → delete) */
  const rename = useCallback(async (oldName: string, newName: string) => {
    if (!wc) return;
    const base = currentPathRef.current;
    const oldPath = joinPath(base, oldName);
    const newPath = joinPath(base, newName);

    try {
      // Check if it's a directory
      const entries = await wc.fs.readdir(base, { withFileTypes: true });
      const entry = entries.find(e => e.name === oldName);

      if (entry?.isDirectory()) {
        // For directories, we need to recursively copy contents
        await copyDirRecursive(wc, oldPath, newPath);
        await wc.fs.rm(oldPath, { recursive: true });
      } else {
        const content = await wc.fs.readFile(oldPath);
        await wc.fs.writeFile(newPath, content);
        await wc.fs.rm(oldPath);
      }
      refresh();
    } catch (err) {
      setError(`Failed to rename: ${err}`);
    }
  }, [wc, refresh]);

  /** Move a file/directory to a new parent directory */
  const moveFile = useCallback(async (sourceName: string, destDir: string) => {
    if (!wc) return;
    const sourcePath = joinPath(currentPathRef.current, sourceName);
    const destPath = joinPath(destDir, sourceName);

    try {
      const entries = await wc.fs.readdir(currentPathRef.current, { withFileTypes: true });
      const entry = entries.find(e => e.name === sourceName);

      if (entry?.isDirectory()) {
        await copyDirRecursive(wc, sourcePath, destPath);
        await wc.fs.rm(sourcePath, { recursive: true });
      } else {
        const content = await wc.fs.readFile(sourcePath);
        await wc.fs.writeFile(destPath, content);
        await wc.fs.rm(sourcePath);
      }
      refresh();
    } catch (err) {
      setError(`Failed to move file: ${err}`);
    }
  }, [wc, refresh]);

  /** Read file content as string */
  const readFile = useCallback(async (name: string): Promise<string> => {
    if (!wc) return '';
    const filePath = joinPath(currentPathRef.current, name);
    try {
      return await wc.fs.readFile(filePath, 'utf-8');
    } catch {
      throw new Error('Cannot read file (possibly binary)');
    }
  }, [wc]);

  /** Read file content as Uint8Array (for binary files) */
  const readFileRaw = useCallback(async (name: string): Promise<Uint8Array> => {
    if (!wc) return new Uint8Array();
    const filePath = joinPath(currentPathRef.current, name);
    return await wc.fs.readFile(filePath);
  }, [wc]);

  /** Upload a browser File object into the container */
  const uploadFile = useCallback(async (file: File) => {
    if (!wc) return;
    const filePath = joinPath(currentPathRef.current, file.name);
    try {
      const buffer = await file.arrayBuffer();
      await wc.fs.writeFile(filePath, new Uint8Array(buffer));
      refresh();
    } catch (err) {
      setError(`Failed to upload: ${err}`);
    }
  }, [wc, refresh]);

  /** Upload multiple files */
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }, [uploadFile]);

  return {
    entries,
    currentPath,
    isLoading,
    error,
    navigateTo,
    refresh,
    goUp,
    createFile,
    createDir,
    remove,
    rename,
    moveFile,
    readFile,
    readFileRaw,
    uploadFile,
    uploadFiles,
  };
}

/** Helper: recursively copy a directory */
async function copyDirRecursive(wc: WebContainer, src: string, dest: string) {
  await wc.fs.mkdir(dest, { recursive: true });
  const entries = await wc.fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = src === '/' ? `/${entry.name}` : `${src}/${entry.name}`;
    const destPath = dest === '/' ? `/${entry.name}` : `${dest}/${entry.name}`;

    if (entry.isDirectory()) {
      await copyDirRecursive(wc, srcPath, destPath);
    } else {
      const content = await wc.fs.readFile(srcPath);
      await wc.fs.writeFile(destPath, content);
    }
  }
}
