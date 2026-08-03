export type TerminalTab = 'ai' | 'user' | 'files' | 'services' | 'capability';
export type TerminalLayout = 'half' | 'full' | 'collapsed';

export type RuntimePortState = 'identifying' | 'managed' | 'orphaned' | 'stopping';
export type RuntimeServiceSource = 'agent' | 'terminal';

export interface RuntimePortStatus {
  port: number;
  url: string;
  state: RuntimePortState;
  source?: RuntimeServiceSource;
  containerId?: string;
  launchId?: string;
  processId?: string;
  pid?: number;
}
