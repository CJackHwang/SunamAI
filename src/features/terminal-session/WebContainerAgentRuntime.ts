import type { WebContainer } from '@webcontainer/api';
import type {
  AgentWorkspaceRuntime,
  ProcessStatus,
  RuntimeProcessEvent,
  ShellRunRequest,
  ShellRunResult,
  WorkspaceTreeEntry,
} from '@/shared/contracts/agentRuntime';

const MAX_PROCESS_OUTPUT = 20_000;
const MAX_SEARCH_FILE_BYTES = 200_000;

interface ManagedProcess extends ProcessStatus {
  process: Awaited<ReturnType<WebContainer['spawn']>>;
}

function getContainerRoot(containerId: string): string {
  if (!/^c-[a-z0-9]+$/i.test(containerId)) throw new Error('Invalid container identifier.');
  return `/${containerId}`;
}

function resolvePath(containerId: string, inputPath: string): string {
  const root = getContainerRoot(containerId);
  const relative = inputPath.replace(/^\/+/, '');
  const normalized = relative.split('/').filter(Boolean);
  if (normalized.some((part) => part === '.' || part === '..')) throw new Error('Path escapes the active container.');
  return normalized.length ? `${root}/${normalized.join('/')}` : root;
}

function makeDiff(path: string, previous: string, next: string): string {
  const before = previous.split('\n');
  const after = next.split('\n');
  const removed = before.filter((line, index) => line !== after[index]).slice(0, 12).map((line) => `- ${line}`);
  const added = after.filter((line, index) => line !== before[index]).slice(0, 12).map((line) => `+ ${line}`);
  return [`--- ${path}`, `+++ ${path}`, ...removed, ...added].join('\n');
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Owns Agent-launched processes instead of leaking them through a terminal component.
 * A terminal may observe this class, but process ownership always remains with its Run.
 */
export class WebContainerAgentRuntime implements AgentWorkspaceRuntime {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly listeners = new Set<(event: RuntimeProcessEvent) => void>();
  private readonly webcontainer: WebContainer;

  constructor(webcontainer: WebContainer) {
    this.webcontainer = webcontainer;
  }

  subscribe(listener: (event: RuntimeProcessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(type: RuntimeProcessEvent['type'], process: ManagedProcess, chunk?: string): void {
    const snapshot = this.toSnapshot(process);
    this.listeners.forEach((listener) => listener({ type, process: snapshot, chunk }));
  }

  private toSnapshot(process: ManagedProcess): ProcessStatus {
    const { process: _process, ...snapshot } = process;
    return { ...snapshot };
  }

  async ensureContainer(containerId: string): Promise<void> {
    await this.webcontainer.fs.mkdir(getContainerRoot(containerId), { recursive: true });
  }

  async listWorkspace(containerId: string, maxDepth: number): Promise<WorkspaceTreeEntry[]> {
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

  async readWorkspaceFile(containerId: string, path: string, startLine = 1, endLine = 240): Promise<string> {
    const content = await this.webcontainer.fs.readFile(resolvePath(containerId, path), 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(1, startLine);
    const end = Math.max(start, Math.min(endLine, start + 499));
    return lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(4, ' ')} | ${line}`).join('\n');
  }

  async searchWorkspace(containerId: string, query: string, maxResults: number): Promise<Array<{ path: string; line: number; content: string }>> {
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
          if (bytes.byteLength > MAX_SEARCH_FILE_BYTES) continue;
          const content = new TextDecoder().decode(bytes);
          const relativePath = absolutePath.slice(root.length + 1);
          content.split('\n').forEach((line, index) => {
            if (results.length < maxResults && line.toLowerCase().includes(needle)) results.push({ path: relativePath, line: index + 1, content: line.slice(0, 500) });
          });
        } catch {
          // Binary and special files are intentionally invisible to textual search.
        }
      }
    };
    await visit(root);
    return results;
  }

  async applyWorkspaceChanges(containerId: string, changes: Array<{ path: string; content: string; expectedContent?: string }>): Promise<Array<{ path: string; diff: string }>> {
    const prepared: Array<{ path: string; target: string; previous: string; content: string }> = [];
    for (const change of changes) {
      const target = resolvePath(containerId, change.path);
      let previous = '';
      try {
        previous = await this.webcontainer.fs.readFile(target, 'utf-8');
      } catch {
        // A new file is valid; it is still checked before any write begins.
      }
      if (change.expectedContent !== undefined && change.expectedContent !== previous) throw new Error(`Refusing to overwrite ${change.path}: content changed since it was read.`);
      prepared.push({ path: change.path, target, previous, content: change.content });
    }
    const results: Array<{ path: string; diff: string }> = [];
    for (const change of prepared) {
      const parent = change.target.slice(0, change.target.lastIndexOf('/')) || getContainerRoot(containerId);
      await this.webcontainer.fs.mkdir(parent, { recursive: true });
      await this.webcontainer.fs.writeFile(change.target, change.content);
      results.push({ path: change.path, diff: makeDiff(change.path, change.previous, change.content) });
    }
    return results;
  }

  async runShell(request: ShellRunRequest): Promise<ShellRunResult> {
    await this.ensureContainer(request.containerId);
    const id = `proc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const process = await this.webcontainer.spawn('jsh', ['-c', request.command], { env: {}, cwd: getContainerRoot(request.containerId) });
    const managed: ManagedProcess = {
      id,
      sessionId: request.sessionId,
      runId: request.runId,
      containerId: request.containerId,
      command: request.command,
      isRunning: true,
      output: '',
      cursor: 0,
      process,
    };
    this.processes.set(id, managed);
    this.publish('started', managed);
    void process.output.pipeTo(new WritableStream<string>({
      write: (chunk) => {
        managed.output = `${managed.output}${chunk}`;
        if (managed.output.length > MAX_PROCESS_OUTPUT) managed.output = managed.output.slice(-MAX_PROCESS_OUTPUT);
        managed.cursor += chunk.length;
        this.publish('output', managed, chunk);
      },
    })).catch(() => undefined);
    void process.exit.then((exitCode) => {
      managed.isRunning = false;
      managed.exitCode = exitCode;
      this.publish('exited', managed);
    });

    if (request.mode === 'background') return { process: this.toSnapshot(managed), timedOut: false };

    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 30_000, 1_000), 300_000);
    const deadline = Date.now() + timeoutMs;
    while (managed.isRunning && Date.now() < deadline) await sleep(40);
    return { process: this.toSnapshot(managed), timedOut: managed.isRunning };
  }

  observeProcess(processId: string, cursor = 0): ProcessStatus | null {
    const process = this.processes.get(processId);
    if (!process) return null;
    const snapshot = this.toSnapshot(process);
    const offset = Math.max(0, Math.min(cursor, snapshot.cursor));
    snapshot.output = offset === 0 ? snapshot.output.slice(-10_000) : snapshot.output.slice(Math.max(0, offset - Math.max(0, snapshot.cursor - snapshot.output.length)));
    return snapshot;
  }

  async sendProcessInput(processId: string, input: string): Promise<boolean> {
    const process = this.processes.get(processId);
    if (!process || !process.isRunning) return false;
    const writer = process.process.input.getWriter();
    try {
      await writer.write(input);
      return true;
    } finally {
      writer.releaseLock();
    }
  }

  stopProcess(processId: string): boolean {
    const process = this.processes.get(processId);
    if (!process || !process.isRunning) return false;
    process.process.kill();
    process.isRunning = false;
    this.publish('stopped', process);
    return true;
  }

  stopRun(runId: string): void {
    this.processes.forEach((process) => { if (process.runId === runId) this.stopProcess(process.id); });
  }

  getProcesses(): ProcessStatus[] {
    return Array.from(this.processes.values()).map((process) => this.toSnapshot(process));
  }
}
