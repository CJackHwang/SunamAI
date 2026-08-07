/**
 * 容器变更串行化租约（R4：自 agentFamily.ts 迁出）。
 *
 * 原 agentFamily.ts 里的 AgentFamilyBudget 是旧引擎（AgentEngine）的家族预算；
 * R4 删除旧引擎后仅保留仍被 pi 通道（PiSession）与现有工具执行（pi 适配器复用的
 * materialize_resource/run_command 串行化）使用的 ContainerMutationLease。同一容器
 * 的并发写操作在此串行排队，避免竞态。
 */
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
