export interface FileEntry {
  name: string;
  isDirectory: boolean;
  /** Approximate size in bytes, or null when the runtime cannot read it. */
  size: number | null;
}
