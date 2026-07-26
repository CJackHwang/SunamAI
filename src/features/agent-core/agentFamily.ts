export class AgentFamilyBudget {
  private modelTurns = 0;
  private toolCalls = 0;
  private readonly startedAt = Date.now();
  readonly maxModelTurns: number;
  readonly maxToolCalls: number;
  readonly maxDurationMs: number;

  constructor(maxModelTurns = 90, maxToolCalls = 225, maxDurationMs = 15 * 60_000) {
    this.maxModelTurns = maxModelTurns;
    this.maxToolCalls = maxToolCalls;
    this.maxDurationMs = maxDurationMs;
  }

  consumeModelTurn(): void {
    this.assertTime();
    if (this.modelTurns >= this.maxModelTurns) throw new Error('Agent family exceeded its model-turn budget.');
    this.modelTurns += 1;
  }

  reserveToolCalls(count: number): void {
    this.assertTime();
    if (this.toolCalls + count > this.maxToolCalls) throw new Error('Agent family exceeded its tool-call budget.');
    this.toolCalls += count;
  }

  remaining(): { modelTurns: number; toolCalls: number; durationMs: number } {
    return { modelTurns: Math.max(0, this.maxModelTurns - this.modelTurns), toolCalls: Math.max(0, this.maxToolCalls - this.toolCalls), durationMs: Math.max(0, this.maxDurationMs - (Date.now() - this.startedAt)) };
  }

  private assertTime(): void {
    if (Date.now() - this.startedAt > this.maxDurationMs) throw new Error('Agent family exceeded its time budget.');
  }
}

export class ContainerMutationLease {
  private static readonly queues = new Map<string, Promise<void>>();

  async run<T>(containerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = ContainerMutationLease.queues.get(containerId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => gate);
    ContainerMutationLease.queues.set(containerId, queued);
    await previous.catch(() => undefined);
    try { return await operation(); }
    finally {
      release();
      if (ContainerMutationLease.queues.get(containerId) === queued) ContainerMutationLease.queues.delete(containerId);
    }
  }
}
