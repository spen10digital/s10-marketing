/**
 * Aurora Serverless v2 at 0 ACU pauses when idle; the first Data API call afterwards fails with
 * `DatabaseResumingException` while the cluster wakes (~15 s, longer after a day idle; 05 §10).
 * Retrying with backoff makes that first request slow instead of failed.
 */
export interface ResumeRetryOptions {
  /** Total time budget for retries. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function isDatabaseResuming(err: unknown): boolean {
  // Drizzle wraps driver errors (DrizzleQueryError.cause), so walk the cause chain.
  for (let e: unknown = err, depth = 0; e && depth < 5; depth += 1) {
    if ((e as { name?: unknown }).name === 'DatabaseResumingException') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function withResumeRetry<T>(fn: () => Promise<T>, options: ResumeRetryOptions = {}): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? 45_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  let delay = 1_000;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isDatabaseResuming(err) || waited + delay > maxWaitMs) throw err;
      await sleep(delay);
      waited += delay;
      delay = Math.min(delay * 2, 8_000);
    }
  }
}
