/**
 * What the two load-ahead runners share (2026-11-12): the app's after-sign-in warm-up (components/app/warm-app.tsx)
 * and the page's own (components/app/warm-page.tsx).
 *
 * - **The page goes first.** While the page on screen is loading its own links ahead, the app's warm-up waits
 *   (`pageWarmIdle`), so the link you are about to click is never queued behind a page you may never open.
 * - **Never twice in a row.** A page loaded ahead in the last WARM_MEMORY_MS is not asked for again — the router keeps
 *   a dynamic page that long (`experimental.staleTimes.dynamic`, next.config.ts).
 */

/** As long as the router keeps a prefetched dynamic page (next.config.ts `staleTimes.dynamic`, 30 s). */
export const WARM_MEMORY_MS = 30_000;

const warmedAt = new Map<string, number>();

/** Loaded ahead within the last WARM_MEMORY_MS. */
export function recentlyWarmed(href: string, now = Date.now()): boolean {
  const at = warmedAt.get(href);
  return at !== undefined && now - at < WARM_MEMORY_MS;
}

export function markWarmed(href: string, now = Date.now()) {
  warmedAt.set(href, now);
  if (warmedAt.size > 500) for (const [key, at] of warmedAt) if (now - at >= WARM_MEMORY_MS) warmedAt.delete(key);
}

// ─── the page's run goes first ─────────────────────────────────────────────────────────────────────

let current = 0;
let active = false;
let waiters: Array<() => void> = [];

/** A new page's run starts; the one before it (another page) is over. Returns this run's id. */
export function beginPageWarm(): number {
  current += 1;
  active = true;
  return current;
}

/** Still the page on screen: a newer navigation ends the older page's run. */
export function isCurrentPageWarm(id: number): boolean {
  return id === current;
}

/** This run is done (or was replaced): the app's warm-up may go on. */
export function endPageWarm(id: number) {
  if (id !== current || !active) return;
  active = false;
  const resume = waiters;
  waiters = [];
  for (const go of resume) go();
}

/** Resolves once no page is loading its own links ahead. */
export function pageWarmIdle(): Promise<void> {
  if (!active) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}
