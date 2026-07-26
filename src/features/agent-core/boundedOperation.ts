export class OperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.ceil(timeoutMs / 1_000)} seconds. The last successful checkpoint was preserved.`);
    this.name = 'OperationTimeoutError';
  }
}

interface BoundedOperationOptions {
  label: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export function runBoundedOperation<T>(operation: (signal: AbortSignal) => Promise<T>, options: BoundedOperationOptions): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const controller = new AbortController();
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
      controller.signal.removeEventListener('abort', onOperationAbort);
      callback();
    };
    const onExternalAbort = () => controller.abort(options.signal?.reason);
    const onOperationAbort = () => finish(() => reject(controller.signal.reason));
    const timer = setTimeout(() => controller.abort(new OperationTimeoutError(options.label, options.timeoutMs)), options.timeoutMs);
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    controller.signal.addEventListener('abort', onOperationAbort, { once: true });
    void operation(controller.signal).then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}
