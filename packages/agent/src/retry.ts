export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Return false to stop retrying (permanent error). Default: retry everything. */
  retryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2)); // full-ish jitter
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 5, baseMs = 1_000, maxMs = 60_000, retryable = () => true, onRetry } = opts;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!retryable(err) || i === attempts - 1) throw err;
      const delay = backoffDelay(i, baseMs, maxMs);
      onRetry?.(err, i + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
