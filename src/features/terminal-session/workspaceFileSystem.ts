import type { WebContainer } from '@webcontainer/api';
import type { WorkspaceChangeSummary, WorkspaceTreeEntry } from '@/shared/contracts/agentRuntime';
import { isNotFoundError } from '@/shared/lib/errors';
import { getContainerRoot, relativeContainerPath, resolveContainerPath } from '@/shared/lib/containerPaths';

const MAX_SEARCH_FILE_BYTES = 200_000;

export class WorkspaceFileSystem {
  private readonly webcontainer: WebContainer;

  constructor(webcontainer: WebContainer) {
    this.webcontainer = webcontainer;
  }

  async list(containerId: string, maxDepth: number): Promise<WorkspaceTreeEntry[]> {
    const root = getContainerRoot(containerId);
    const entries: WorkspaceTreeEntry[] = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
      const children = await this.webcontainer.fs.readdir(directory, { withFileTypes: true });
      for (const child of children) {
        if (child.name === 'node_modules' || child.name === '.git') continue;
        const path = directory === root ? child.name : `${directory.slice(root.length + 1)}/${child.name}`;
        entries.push({ path, isDirectory: child.isDirectory() });
        if (child.isDirectory() && depth < maxDepth) await visit(`${directory}/${child.name}`, depth + 1);
      }
    };
    await visit(root, 0);
    return entries.slice(0, 500);
  }

  async read(containerId: string, path: string, startLine = 1, endLine = 240): Promise<string> {
    const content = await this.webcontainer.fs.readFile(resolveContainerPath(containerId, path), 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(1, startLine);
    const end = Math.max(start, Math.min(endLine, start + 499));
    return lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(4, ' ')} | ${line}`).join('\n');
  }

  async search(containerId: string, query: string, maxResults: number): Promise<Array<{ path: string; line: number; content: string }>> {
    const root = getContainerRoot(containerId);
    const results: Array<{ path: string; line: number; content: string }> = [];
    const needle = query.toLowerCase();
    const visit = async (directory: string): Promise<void> => {
      if (results.length >= maxResults) return;
      const children = await this.webcontainer.fs.readdir(directory, { withFileTypes: true });
      for (const child of children) {
        if (results.length >= maxResults || child.name === 'node_modules' || child.name === '.git') continue;
        const absolutePath = `${directory}/${child.name}`;
        if (child.isDirectory()) {
          await visit(absolutePath);
          continue;
        }
        try {
          const bytes = await this.webcontainer.fs.readFile(absolutePath);
          if (bytes.byteLength > MAX_SEARCH_FILE_BYTES || bytes.includes(0)) continue;
          const content = new TextDecoder().decode(bytes);
          const relativePath = relativeContainerPath(containerId, absolutePath);
          content.split('\n').forEach((line, index) => {
            if (results.length < maxResults && line.toLowerCase().includes(needle)) results.push({ path: relativePath, line: index + 1, content: line.slice(0, 500) });
          });
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      }
    };
    await visit(root);
    return results;
  }

  async apply(containerId: string, changes: Array<{ path: string; content: string; expectedContent?: string }>): Promise<WorkspaceChangeSummary[]> {
    const prepared: Array<{ path: string; target: string; previous: string; content: string; kind: 'created' | 'updated' }> = [];
    const uniquePaths = new Set<string>();
    for (const change of changes) {
      const target = resolveContainerPath(containerId, change.path);
      if (uniquePaths.has(target)) throw new Error(`Workspace update contains duplicate path: ${change.path}.`);
      uniquePaths.add(target);
      let previous = '';
      let kind: 'created' | 'updated' = 'updated';
      try {
        previous = await this.webcontainer.fs.readFile(target, 'utf-8');
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        kind = 'created';
      }
      if (change.expectedContent !== undefined && change.expectedContent !== previous) {
        throw new Error(`Refusing to overwrite ${change.path}: content changed since it was read.`);
      }
      prepared.push({ path: change.path, target, previous, content: change.content, kind });
    }
    const results: WorkspaceChangeSummary[] = [];
    const applied: typeof prepared = [];
    try {
      for (const change of prepared) {
        const parent = change.target.slice(0, change.target.lastIndexOf('/')) || getContainerRoot(containerId);
        await this.webcontainer.fs.mkdir(parent, { recursive: true });
        applied.push(change);
        await this.webcontainer.fs.writeFile(change.target, change.content);
        results.push({ path: change.path, kind: change.kind, beforeBytes: new Blob([change.previous]).size, afterBytes: new Blob([change.content]).size });
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const change of applied.reverse()) {
        try {
          const current = await this.webcontainer.fs.readFile(change.target, 'utf-8');
          if (change.kind === 'updated' && current === change.previous) {
            continue;
          } else if (current !== change.content) {
            rollbackErrors.push(`${change.path}: file changed concurrently; preserved newer content`);
          } else if (change.kind === 'created') {
            await this.webcontainer.fs.rm(change.target);
          } else {
            await this.webcontainer.fs.writeFile(change.target, change.previous);
          }
        } catch (rollbackError) {
          if (change.kind === 'created' && isNotFoundError(rollbackError)) continue;
          rollbackErrors.push(`${change.path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }
      if (rollbackErrors.length) throw new Error(`Workspace update failed and rollback was incomplete (${rollbackErrors.join('; ')}). Original error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return results;
  }
}
