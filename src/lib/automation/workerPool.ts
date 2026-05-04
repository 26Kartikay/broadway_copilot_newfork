type Task<T> = () => Promise<T>;

export async function runWithConcurrency<T>(
  tasks: Task<T>[],
  concurrency: number,
  onResult?: (result: T, index: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      if (!task) continue;
      const result = await task();
      results[index] = result;
      onResult?.(result, index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runWithConcurrencyStream<T>(
  tasks: Task<T>[],
  concurrency: number,
  onResult: (result: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      if (!task) continue;
      const result = await task();
      await onResult(result, index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
}
