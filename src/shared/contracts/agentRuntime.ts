export interface ProcessStatus {
  isRunning: boolean;
  output: string;
}

/** Runtime boundary consumed by the Agent; implemented by the terminal feature. */
export interface AgentRuntime {
  spawnAiProcess(command: string, containerId: string): Promise<string>;
  getAiProcessStatus(processId: string): ProcessStatus | null;
  sendAiProcessInput(processId: string, input: string): Promise<boolean>;
  killAiProcess(processId: string): void;
}
