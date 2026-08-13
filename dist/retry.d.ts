/**
 * Shared retry utilities for SQLITE_BUSY handling.
 * Used by both tools and hooks so that ALL database writes get transient-error retry.
 */
/** Sleep synchronously without a CPU spin loop, using Atomics.wait on a throwaway buffer. */
export declare function sleepSync(ms: number): void;
/** Check if an error is a transient SQLITE_BUSY (WAL contention) */
export declare function isBusyError(err: unknown): boolean;
/** Retry a synchronous operation up to maxRetries times with exponential backoff for SQLITE_BUSY */
export declare function withRetry<T>(fn: () => T, maxRetries?: number): T;
//# sourceMappingURL=retry.d.ts.map