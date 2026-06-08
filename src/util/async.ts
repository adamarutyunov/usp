export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function pollUntil<T>({
  attempts,
  delayMs,
  poll,
  isDone,
  onPending,
}: {
  attempts: number;
  delayMs: number | ((attempt: number) => number);
  poll: (attempt: number) => Promise<T>;
  isDone: (value: T) => boolean;
  onPending?: (value: T, attempt: number) => Promise<void> | void;
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await poll(attempt);
    if (isDone(value)) {
      return value;
    }
    await onPending?.(value, attempt);
    await sleep(typeof delayMs === "function" ? delayMs(attempt) : delayMs);
  }
  return undefined;
}
