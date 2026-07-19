import type { AgentEvent, AgentEventKind, AgentRun } from './types';

export class AgentEventEmitter {
  private sequence = 0;
  private readonly sessionId: string;
  private readonly runId: string;
  private readonly onEvent: (event: AgentEvent) => void | Promise<void>;

  constructor(sessionId: string, runId: string, onEvent: (event: AgentEvent) => void | Promise<void>) {
    this.sessionId = sessionId;
    this.runId = runId;
    this.onEvent = onEvent;
  }

  async emit<K extends AgentEventKind>(kind: K, payload: Omit<Extract<AgentEvent, { kind: K }>, 'id' | 'kind' | 'sessionId' | 'runId' | 'sequence' | 'createdAt'>): Promise<void> {
    const event = {
      id: `${this.runId}:${this.sequence + 1}`,
      kind,
      sessionId: this.sessionId,
      runId: this.runId,
      sequence: ++this.sequence,
      createdAt: Date.now(),
      ...payload,
    } as Extract<AgentEvent, { kind: K }>;
    await this.onEvent(event);
  }

  setSequence(sequence: number): void {
    this.sequence = sequence;
  }

  async start(run: AgentRun): Promise<void> {
    await this.emit('run_started', { run });
  }
}
