/**
 * The app's client data cache (speed pass 2026-11-09, owner: "show the last data at once, then refresh").
 *
 * A page that reads `/api/app/…` from the browser keeps the last answer per address here, for this tab. Opening it
 * again draws that answer at once and asks again behind it (stale-while-revalidate); the fresh answer replaces it in
 * place. A change the person makes calls `revalidate` (or `mutate`) so they never see their own change go missing.
 *
 * - One request per address at a time: a second asker joins the first.
 * - A slower, older answer never overwrites a newer one (each request has a sequence number).
 * - `persist`: the busiest screens keep a copy in sessionStorage, so a reload is instant too.
 * - Signing out (or switching workspace) clears everything: `clearResources()`.
 *
 * No React here, so it can be tested in Node; the hook is in `use-resource.ts`.
 */

export type Entry<T = unknown> = {
  data?: T;
  error?: string;
  /** When `data` was fetched (ms since epoch). */
  at: number;
  /** The request in flight, if any. */
  pending?: Promise<T>;
  /** The newest request's number; an answer from an older one is dropped. */
  seq: number;
};

type Listener = () => void;

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<Listener>>();
const PERSIST_PREFIX = "insurvas:res:";
/**
 * Whose answers these are (the signed-in person and workspace, set by the shell before any page renders). A
 * different scope starts empty, and persisted copies are filed under their scope, so one person's data can never be
 * shown to another in the same browser, whatever way the first session ended.
 */
let scope = "";
export function setResourceScope(next: string) {
  if (next === scope) return;
  entries.clear();
  scope = next;
}
const persistKey = (key: string) => `${PERSIST_PREFIX}${scope}:${key}`;
/** A persisted copy older than this is not shown at all (it would mislead more than help). */
const PERSIST_MAX_AGE = 30 * 60_000;

/** The request that reads a resource. Swappable in tests. */
let fetcher = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" ? (body as { error: string }).error : `Request failed (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status, body });
  }
  return body;
};
export function setFetcher(next: typeof fetcher) { fetcher = next; }

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function subscribe(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(listener);
  return () => { set?.delete(listener); };
}

function readPersisted<T>(key: string): Entry<T> | undefined {
  try {
    if (!scope) return undefined;
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(persistKey(key));
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { data: T; at: number };
    if (Date.now() - saved.at > PERSIST_MAX_AGE) return undefined;
    return { data: saved.data, at: saved.at, seq: 0 };
  } catch {
    return undefined;
  }
}

function writePersisted(key: string, data: unknown, at: number) {
  if (!scope) return;
  try { sessionStorage.setItem(persistKey(key), JSON.stringify({ data, at })); } catch { /* full or blocked: memory only */ }
}

/**
 * The app has hydrated (set once by ResourceScope's effect). Until then a page's first render must match the
 * server's HTML, which never has kept answers, so `seed` gives nothing; the page's mount effect fills in the kept
 * answer a moment later (`peek`), still before the network answers.
 */
let hydrated = false;
export function markHydrated() { hydrated = true; }

/** A page's starting state: the kept answer on a client navigation, nothing while hydrating a fresh document. */
export function seed<T>(key: string, persist = false): Entry<T> | undefined {
  return hydrated ? peek<T>(key, persist) : undefined;
}

/** What is known for `key` now (memory first, then a persisted copy when `persist`). */
export function peek<T>(key: string, persist = false): Entry<T> | undefined {
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit) return hit;
  if (!persist) return undefined;
  const saved = readPersisted<T>(key);
  if (saved) entries.set(key, saved);
  return saved;
}

/**
 * Ask for `key` (its URL unless `url` is given). Joins a request already in flight; otherwise starts one. Resolves
 * with the data; the entry and every subscriber are updated either way.
 */
export function load<T>(key: string, opts: { url?: string; persist?: boolean; read?: (url: string) => Promise<T> } = {}): Promise<T> {
  const current = peek<T>(key, opts.persist) ?? { at: 0, seq: 0 };
  if (current.pending) return current.pending;
  const seq = current.seq + 1;
  const read = opts.read ?? (fetcher as (url: string) => Promise<T>);
  const pending = read(opts.url ?? key).then(
    (data) => {
      const now = entries.get(key) as Entry<T> | undefined;
      if (!now || now.seq === seq) {
        const at = Date.now();
        entries.set(key, { data, at, seq });
        if (opts.persist) writePersisted(key, data, at);
        notify(key);
      }
      return data;
    },
    (error: unknown) => {
      const now = entries.get(key) as Entry<T> | undefined;
      if (!now || now.seq === seq) {
        entries.set(key, { ...(now ?? { at: 0 }), seq, pending: undefined, error: error instanceof Error ? error.message : "Could not load" });
        notify(key);
      }
      throw error;
    },
  );
  entries.set(key, { ...current, seq, pending, error: undefined });
  notify(key);
  return pending;
}

/**
 * A page's own read, through the cache: an answer fetched in the last `freshFor` ms (a hover just warmed it, or a
 * second panel read it) is used as it is; otherwise this asks (joining a request already on its way). For pages
 * that keep their data in their own state: seed that state from `peek(key)?.data`, then call this where they
 * fetched before.
 */
export function readResource<T>(key: string, opts: { url?: string; persist?: boolean; freshFor?: number } = {}): Promise<T> {
  const current = peek<T>(key, opts.persist);
  if (current?.pending) return current.pending;
  if (current?.data !== undefined && Date.now() - current.at < (opts.freshFor ?? 2_000)) return Promise.resolve(current.data);
  return load<T>(key, opts);
}

/** Warm a resource before it is needed (hover on a link): only when nothing fresh is cached or on its way. */
export function prefetch(key: string, opts: { url?: string; persist?: boolean; freshFor?: number } = {}) {
  const current = peek(key, opts.persist);
  if (current?.pending) return;
  if (current?.data !== undefined && Date.now() - current.at < (opts.freshFor ?? 15_000)) return;
  load(key, opts).catch(() => { /* a warm-up failing is not an error the person sees */ });
}

/** Put data in the cache directly (an answer the page already has, an optimistic change). */
export function mutate<T>(key: string, data: T | ((current: T | undefined) => T), persist = false) {
  const current = entries.get(key) as Entry<T> | undefined;
  const next = typeof data === "function" ? (data as (current: T | undefined) => T)(current?.data) : data;
  const at = Date.now();
  entries.set(key, { ...(current ?? { seq: 0 }), data: next, at, pending: current?.pending, error: undefined });
  if (persist) writePersisted(key, next, at);
  notify(key);
}

/** Forget everything: signing out, switching workspace. */
export function clearResources() {
  entries.clear();
  try {
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PERSIST_PREFIX)) sessionStorage.removeItem(key);
      }
    }
  } catch { /* nothing kept */ }
  for (const key of [...listeners.keys()]) notify(key);
}
