export const WEB_CONTAINER_WORKDIR_NAME = 'workspace';
export const WEB_CONTAINER_HOME = `/home/${WEB_CONTAINER_WORKDIR_NAME}`;

// 多工作区隔离语义（M6 R3 边界）：SunamAI 的"虚拟容器"是文件系统级隔离——每个容器是
// /home/workspace/c-<id> 下的独立目录，agent 命令在各自根目录执行（cd 前缀 / setCwd），
// 容器 A 建的文件容器 B 不可见。进程级隔离（独立 PID 命名空间 / 进程树）在 Succinix 执行模型
// 下不成立：host 进程表全局可见（ps 显示所有容器进程），此为 Succinix 宿主 OS 语义，如实标注
// 而非硬造。路径解析（本文件）与 cwd 竞态防护（succinixClient.execWithContext）共同保证文件隔离。

const CONTAINER_ID_PATTERN = /^c-[a-z0-9_-]+$/i;

function assertContainerId(containerId: string): void {
  if (!CONTAINER_ID_PATTERN.test(containerId)) throw new Error('Invalid container identifier.');
}

function invalidPath(containerId: string, inputPath: string, reason: string): Error {
  return new Error(`Invalid workspace path "${inputPath}": ${reason} Use a path relative to ${getContainerPublicPath(containerId)}.`);
}

/** WebContainer APIs resolve this path relative to `webcontainer.workdir`. */
export function getContainerRoot(containerId: string): string {
  assertContainerId(containerId);
  return containerId;
}

/** The real absolute path shared by Agent processes and the user terminal. */
export function getContainerPublicPath(containerId: string): string {
  return `${WEB_CONTAINER_HOME}/${getContainerRoot(containerId)}`;
}

export function resolveContainerPath(containerId: string, inputPath = ''): string {
  const root = getContainerRoot(containerId);
  const publicRoot = getContainerPublicPath(containerId);
  if (!inputPath) return root;
  if (inputPath.includes(String.fromCharCode(0)) || inputPath.includes('\\')) {
    throw invalidPath(containerId, inputPath, 'control characters and backslashes are not allowed.');
  }

  let relativePath = inputPath;
  if (inputPath === publicRoot) return root;
  if (inputPath.startsWith(`${publicRoot}/`)) relativePath = inputPath.slice(publicRoot.length + 1);
  else if (inputPath.startsWith('/')) throw invalidPath(containerId, inputPath, 'absolute paths must target the active container root.');

  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw invalidPath(containerId, inputPath, 'empty, dot, and parent segments are not allowed because the path escapes the active workspace.');
  }
  const legacyPrefix = parts.slice(0, 2).join('/').toLowerCase();
  if (legacyPrefix === 'home/user' || legacyPrefix === 'home/workspace' || legacyPrefix === '.sunam/workspaces' || parts[0]?.toLowerCase() === 'containers') {
    throw invalidPath(containerId, inputPath, 'legacy and display-only workspace roots are not writable locations.');
  }
  if (CONTAINER_ID_PATTERN.test(parts[0] ?? '')) {
    throw invalidPath(containerId, inputPath, parts[0] === root ? 'do not repeat the active container root.' : 'another container root is outside the active workspace.');
  }
  return `${root}/${parts.join('/')}`;
}

export function relativeContainerPath(containerId: string, containerPath: string): string {
  const root = getContainerRoot(containerId);
  if (containerPath === root) return '';
  if (!containerPath.startsWith(`${root}/`)) throw new Error('Path is outside the active container.');
  return containerPath.slice(root.length + 1);
}
