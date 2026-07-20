export interface ScheduledToolResult<TCall, TResult> { call: TCall; result: TResult }

/** Serializes mutating tools while running adjacent read-only calls in bounded batches. */
export async function scheduleToolBatch<TCall, TResult>(options: {
  calls: TCall[];
  isConcurrencySafe: (call: TCall) => boolean;
  execute: (call: TCall) => Promise<ScheduledToolResult<TCall, TResult>>;
  assertCanContinue: () => void;
  maxConcurrency?: number;
}): Promise<Array<ScheduledToolResult<TCall, TResult>>> {
  const results: Array<ScheduledToolResult<TCall, TResult>> = [];
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
  let index = 0;
  while (index < options.calls.length) {
    options.assertCanContinue();
    const call = options.calls[index]!;
    if (!options.isConcurrencySafe(call)) {
      results.push(await options.execute(call));
      index += 1;
      continue;
    }
    const adjacent: TCall[] = [];
    while (index < options.calls.length && options.isConcurrencySafe(options.calls[index]!)) adjacent.push(options.calls[index++]!);
    for (let cursor = 0; cursor < adjacent.length; cursor += maxConcurrency) {
      options.assertCanContinue();
      results.push(...await Promise.all(adjacent.slice(cursor, cursor + maxConcurrency).map(options.execute)));
    }
  }
  return results;
}
