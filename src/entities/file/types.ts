export interface FileEntry {
  name: string;
  isDirectory: boolean;
  /** Approximate size in bytes (0 for directories and unreadable binaries). */
  size: number;
}
