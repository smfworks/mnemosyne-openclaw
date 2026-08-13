/**
 * Shared retry utilities for SQLITE_BUSY handling.
 * Used by both tools and hooks so that ALL database writes get transient-error retry.
 */

/** Sleep synchronously without a CPU spin loop, using Atomics.wait on a throwaway buffer. */
export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer unavailable (rare hardened runtime) — fall back to a bounded spin.
    const start = Date.now();
    while (Date.now() - start < ms) { /* fallback */ }
  }
}

/** Check if an error is a transient SQLITE_BUSY (WAL contention) */
export function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("SQLITE_BUSY") || (err as unknown as Record<string, unknown>).code === "SQLITE_BUSY";
}

/** Retry a synchronous operation up to maxRetries times with exponential backoff for SQLITE_BUSY */
export function withRetry<T>(fn: () => T, maxRetries = 3): T {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return fn();
    } catch (err) {
      if (i === maxRetries || !isBusyError(err)) throw err;
      // Non-blocking-of-CPU backoff: park the thread without burning a spin loop.
      const ms = Math.min(100 * Math.pow(2, i), 500);
      sleepSync(ms);
    }
  }
  throw new Error("unreachable");
}