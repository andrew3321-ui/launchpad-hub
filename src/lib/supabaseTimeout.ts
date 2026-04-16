/**
 * Wraps a Supabase query promise with a timeout.
 * If the query doesn't resolve within `ms` milliseconds, rejects with an error.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms = 15000, label = "Request"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]) as Promise<T>;
}
