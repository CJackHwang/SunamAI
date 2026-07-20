export const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'php', 'sql', 'graphql', 'vue', 'svelte', 'env', 'gitignore', 'dockerignore', 'editorconfig', 'prettierrc', 'eslintrc', 'babelrc', 'lock', 'log']);
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

export function getExtension(name: string): string {
  const parts = name.split('.');
  return parts.length < 2 ? '' : parts.at(-1)!.toLowerCase();
}

export function isPreviewableFile(name: string): boolean {
  const extension = getExtension(name);
  return name.startsWith('.') || TEXT_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension);
}

export function formatSize(bytes: number | null, unknownLabel = '未知'): string {
  if (bytes === null) return unknownLabel;
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSafeEntryName(name: string): boolean {
  return Boolean(name.trim()) && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}
