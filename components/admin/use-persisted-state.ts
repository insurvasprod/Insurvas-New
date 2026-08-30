"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * React state backed by localStorage.
 *
 * `useSyncExternalStore` rather than "useState plus an effect that reads storage on mount": it is
 * the API built for exactly this, and its server snapshot means hydration is correct by
 * construction instead of needing suppressHydrationWarning. The first paint uses the fallback, then
 * React re-renders with the stored value.
 *
 * Snapshots must be referentially stable or React re-renders forever, so parsed values are cached
 * against the raw string they came from — re-parsing an array on every render would return a new
 * array each time and loop.
 */
const listeners = new Set<() => void>();
const rawCache = new Map<string, string | null>();
const parsedCache = new Map<string, { raw: string | null; value: unknown }>();

function emit() {
  for (const listener of listeners) listener();
}

function onStorageEvent(event: StorageEvent) {
  if (event.key) rawCache.delete(event.key);
  else rawCache.clear();
  emit();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onStorageEvent);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorageEvent);
  };
}

function readRaw(key: string): string | null {
  if (!rawCache.has(key)) {
    try {
      rawCache.set(key, window.localStorage.getItem(key));
    } catch {
      // Private windows and blocked site data throw on access, not just on write.
      rawCache.set(key, null);
    }
  }
  return rawCache.get(key) ?? null;
}

export function usePersistedState<T>(key: string, fallback: T): [T, (next: T) => void] {
  const getSnapshot = useCallback((): T => {
    const raw = readRaw(key);
    const cached = parsedCache.get(key);
    if (cached && cached.raw === raw) return cached.value as T;

    let value = fallback;
    if (raw !== null) {
      try {
        value = JSON.parse(raw) as T;
      } catch {
        value = fallback;
      }
    }
    parsedCache.set(key, { raw, value });
    return value;
  }, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => {
      const raw = JSON.stringify(next);
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // A remembered pane width is not worth breaking the page over — keep it for this session.
      }
      rawCache.set(key, raw);
      parsedCache.set(key, { raw, value: next });
      emit();
    },
    [key],
  );

  return [value, setValue];
}
