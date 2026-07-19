const CONTAINER_ID_PATTERN = /^c-[a-z0-9_-]+$/i;
const CONTAINER_DIRECTORY = '.sunam/workspaces';

/**
 * The WebContainer FileSystem API and spawn `cwd` are scoped to
 * `webcontainer.workdir`; paths here must therefore be relative, not host-like
 * absolute paths such as `/workspaces/...`.
 */
export function getContainerRoot(containerId: string): string {
  if (!CONTAINER_ID_PATTERN.test(containerId)) throw new Error('Invalid container identifier.');
  return `${CONTAINER_DIRECTORY}/${containerId}`;
}

export function resolveContainerPath(containerId: string, inputPath = ''): string {
  const root = getContainerRoot(containerId);
  const parts = inputPath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Path escapes the active container.');
  return parts.length ? `${root}/${parts.join('/')}` : root;
}

export function relativeContainerPath(containerId: string, absolutePath: string): string {
  const root = getContainerRoot(containerId);
  if (absolutePath === root) return '';
  if (!absolutePath.startsWith(`${root}/`)) throw new Error('Path is outside the active container.');
  return absolutePath.slice(root.length + 1);
}
