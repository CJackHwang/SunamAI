export interface ProcessStatus {
  id: string;
  sessionId: string;
  runId: string;
  containerId: string;
  command: string;
  isRunning: boolean;
  output: string;
  cursor: number;
  exitCode?: number;
}

export interface RuntimeProcessEvent {
  type: 'started' | 'output' | 'exited' | 'stopped' | 'error';
  process: ProcessStatus;
  chunk?: string;
}

export interface WorkspaceChangeSummary {
  path: string;
  kind: 'created' | 'updated';
  beforeBytes: number;
  afterBytes: number;
}

export interface WorkspaceTreeEntry {
  path: string;
  isDirectory: boolean;
}

export interface ShellRunRequest {
  command: string;
  containerId: string;
  sessionId: string;
  runId: string;
  mode: 'foreground' | 'background';
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ShellRunResult {
  process: ProcessStatus;
  timedOut: boolean;
}

export interface ProcessOwnership {
  sessionId: string;
  runId: string;
  containerId: string;
}

/** Browser-safe boundary between the Agent Core and WebContainer. */
export interface AgentWorkspaceRuntime {
  ensureContainer(containerId: string): Promise<void>;
  listWorkspace(containerId: string, maxDepth: number): Promise<WorkspaceTreeEntry[]>;
  readWorkspaceFile(containerId: string, path: string, startLine?: number, endLine?: number): Promise<string>;
  searchWorkspace(containerId: string, query: string, maxResults: number): Promise<Array<{ path: string; line: number; content: string }>>;
  applyWorkspaceChanges(containerId: string, changes: Array<{ path: string; content: string; expectedContent?: string }>): Promise<WorkspaceChangeSummary[]>;
  runShell(request: ShellRunRequest): Promise<ShellRunResult>;
  observeProcess(processId: string, ownership: ProcessOwnership, cursor?: number): ProcessStatus | null;
  sendProcessInput(processId: string, ownership: ProcessOwnership, input: string): Promise<boolean>;
  stopProcess(processId: string, ownership: ProcessOwnership): boolean;
  stopRun(ownership: ProcessOwnership): void;
  getProcesses(ownership?: Partial<ProcessOwnership>): ProcessStatus[];
  subscribe(listener: (event: RuntimeProcessEvent) => void): () => void;
  getUserTerminalBuffer(): string;
  appendUserTerminalBuffer(data: string): void;
  sendUserTerminalInput(data: string): Promise<boolean>;
  onUserTerminalInput(listener: (data: string) => void): void;
}
