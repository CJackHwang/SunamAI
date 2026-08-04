export type TerminalTab = 'ai' | 'user' | 'files' | 'services' | 'capability';
/** Sub-views inside the merged "Sunam的电脑" (ai) container tab. */
export type ContainerSegment = 'ai' | 'user' | 'services' | 'files';
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
