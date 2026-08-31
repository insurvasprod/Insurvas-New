export type FallbackVendor = { id: string; endpoint: string; credentials: string | null };

/**
 * Shared ordered fallback loop. The database-backed service supplies enabled vendors in priority
 * order; the callback is deliberately injected so the behavior can be tested without an outbound
 * request. `onFallback` is where the caller records the sanitized fallback event.
 */
export async function runOrderedFallback<T>(
  vendors: readonly FallbackVendor[],
  operation: (vendor: FallbackVendor) => Promise<T>,
  onFallback: (from: FallbackVendor, to: FallbackVendor) => Promise<void>,
): Promise<T> {
  let lastError: unknown = null;
  for (let index = 0; index < vendors.length; index++) {
    const current = vendors[index];
    try {
      return await operation(current);
    } catch (error) {
      lastError = error;
      const next = vendors[index + 1];
      if (next) await onFallback(current, next);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No fallback vendor is available");
}
