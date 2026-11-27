import { readSecret, writeSecret } from "./secure";

/**
 * Board L4 · Working offline (rules: "Offline only where it is safe"). Notes, call outcomes and application
 * answers given with no signal wait on the phone and are sent in the order they were given once a request
 * gets through again. Claiming, dialing and approving always need the server, so they never queue.
 *
 * What waits is client data, so it lives in the Keychain / Keystore (lib/secure.ts) like the session: an index
 * entry lists the items, each item is its own entry (SecureStore keeps small values), and an item's entry is
 * deleted the moment it is sent. Signing out empties it (lib/session.tsx), so the next person to sign in on
 * the phone never sends — or sees — someone else's notes.
 *
 * Each item carries whose it is (the user and the workspace it was given in, `setOutboxOwner`). Only the
 * current owner's items are counted, read and sent: after a workspace switch the other workspace's items wait
 * until it is entered again, and a session that ended without signing out (Use password on the lock, "Keep me
 * signed in" off, a refused refresh) keeps its person's items for when they sign back in. A different person
 * signing in drops them (`adoptOutboxOwner`), and so does Sign out (`clearOutbox`).
 *
 *   note     POST /api/app/leads/:id/notes (the request carries its idempotency key, so a resend is safe)
 *   outcome  POST /api/app/dialer/attempt/:id/disposition
 *   answer   PUT  /api/app/applications/cases/:id/interview (one per question; components/applications/answer-queue)
 */
export type OutboxKind = "note" | "outcome" | "answer";
export type OutboxMethod = "POST" | "PUT" | "PATCH";
export type OutboxItem = {
  id: string;
  kind: OutboxKind;
  method: OutboxMethod;
  path: string;
  body: unknown;
  /** When it was given (ms). */
  at: number;
  /** Items of one group replace each other by `key` (an application's answers: one per question). */
  group?: string;
  key?: string;
  /** Whose it is: the user and the workspace (tenant) it was given in. */
  user?: string;
  tenant?: string;
};
type IndexEntry = Pick<OutboxItem, "id" | "kind" | "group" | "key" | "user" | "tenant">;
export type OutboxOwner = { user: string; tenant: string };

const INDEX = "insurvas.outbox";
const ITEM = (id: string) => `insurvas.outbox.${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

const ELIGIBLE: { kind: OutboxKind; method: OutboxMethod; path: RegExp }[] = [
  { kind: "note", method: "POST", path: /^\/api\/app\/leads\/[^/?]+\/notes$/ },
  { kind: "outcome", method: "POST", path: /^\/api\/app\/dialer\/attempt\/[^/?]+\/disposition$/ },
];

/** Whether a write may wait on the phone (notes and call outcomes; answers queue through answer-queue). */
export function outboxKind(path: string, method: string | undefined): OutboxKind | null {
  const hit = ELIGIBLE.find((e) => e.method === method && e.path.test(path));
  return hit ? hit.kind : null;
}

/** The answer a screen gets for a write that is waiting on the phone. */
export type Queued = { queued: true; outboxId: string };
export function isQueued(x: unknown): x is Queued {
  return Boolean(x) && typeof x === "object" && (x as Queued).queued === true;
}

// ── whose items are in play ────────────────────────────────────────────────────────────────────────
let owner: OutboxOwner | null = null;
/** An entry of the current owner (with no owner set, only untagged entries: older items, tests). */
function mine(e: IndexEntry): boolean {
  return owner ? e.user === owner.user && e.tenant === owner.tenant : e.user === undefined;
}

// ── the count, for the bar's "Offline · 3 to send" ──────────────────────────────────────────────────
let count = 0;
let loaded = false;
const listeners = new Set<() => void>();
function setCount(n: number) {
  if (n === count && loaded) return;
  count = n;
  loaded = true;
  listeners.forEach((l) => l());
}
export function outboxCount(): number {
  return count;
}
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ── storage ────────────────────────────────────────────────────────────────────────────────────────
async function readIndex(): Promise<IndexEntry[]> {
  const raw = await readSecret(INDEX);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is IndexEntry => Boolean(x) && typeof (x as IndexEntry).id === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(index: IndexEntry[]): Promise<void> {
  await writeSecret(INDEX, index.length ? JSON.stringify(index) : null).catch(() => undefined);
  setCount(index.filter(mine).length);
}

async function readItem(entry: IndexEntry): Promise<OutboxItem | null> {
  const raw = await readSecret(ITEM(entry.id));
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as OutboxItem;
    return item && typeof item.path === "string" ? item : null;
  } catch {
    return null;
  }
}

/** One change at a time: enqueue, remove and flush never interleave their read-modify-write of the index. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

let seq = 0;
function newId(): string {
  seq = (seq + 1) % 1_000_000;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Everything waiting, oldest first (optionally one group). */
export async function readOutbox(group?: string): Promise<OutboxItem[]> {
  const index = (await readIndex()).filter(mine);
  if (!loaded) setCount(index.length);
  const items = await Promise.all(index.filter((e) => group === undefined || e.group === group).map(readItem));
  return items.filter((x): x is OutboxItem => Boolean(x));
}

/** Reads the count from the phone once (the bar shows it from the first screen). */
export async function loadOutboxCount(): Promise<number> {
  const n = (await readIndex()).filter(mine).length;
  setCount(n);
  return n;
}

/**
 * The session in front (lib/session.tsx): the signed-in user and workspace, or null when no one is signed in
 * (locked or signed out). Nothing is deleted; it only changes which items count and go.
 */
export function setOutboxOwner(next: OutboxOwner | null): Promise<void> {
  return serial(async () => {
    owner = next;
    setCount((await readIndex()).filter(mine).length);
  });
}

/**
 * A sign-in (or unlock, or workspace switch) of `next`: their items stay — every workspace's — and anyone
 * else's are deleted unsent (they belong to a session that ended; the next person never sends or sees them).
 */
export function adoptOutboxOwner(next: OutboxOwner): Promise<void> {
  return serial(async () => {
    owner = next;
    const index = await readIndex();
    const others = index.filter((e) => e.user !== next.user);
    if (others.length) {
      await Promise.all(others.map((e) => writeSecret(ITEM(e.id), null).catch(() => undefined)));
      await writeIndex(index.filter((e) => e.user === next.user));
    } else {
      setCount(index.filter(mine).length);
    }
  });
}

/** Tests and the sign-out: who the items are for right now. */
export function outboxOwner(): OutboxOwner | null {
  return owner;
}

/**
 * Puts a write on the phone. With a group and key, an older item for the same key — and any key in `drop` —
 * is replaced (a later answer to a question replaces the one still waiting; an answer that hides follow-ups
 * takes theirs with it).
 */
export function enqueue(input: Omit<OutboxItem, "id" | "at"> & { at?: number }, drop: string[] = []): Promise<OutboxItem> {
  return serial(async () => {
    const item: OutboxItem = { ...input, id: newId(), at: input.at ?? Date.now(), ...(owner ? { user: owner.user, tenant: owner.tenant } : {}) };
    const index = await readIndex();
    const replaced = item.group ? index.filter((e) => mine(e) && e.group === item.group && e.key !== undefined && (e.key === item.key || drop.includes(e.key))) : [];
    await writeSecret(ITEM(item.id), JSON.stringify(item));
    await Promise.all(replaced.map((e) => writeSecret(ITEM(e.id), null).catch(() => undefined)));
    await writeIndex([...index.filter((e) => !replaced.includes(e)), { id: item.id, kind: item.kind, group: item.group, key: item.key, user: item.user, tenant: item.tenant }]);
    return item;
  });
}

/** Empties the outbox, everyone's (Sign out). */
export function clearOutbox(): Promise<void> {
  return serial(async () => {
    const index = await readIndex();
    await Promise.all(index.map((e) => writeSecret(ITEM(e.id), null).catch(() => undefined)));
    await writeIndex([]);
  });
}

/**
 * What a failed send means for the item: `stop` keeps it and everything after it (no answer, the session
 * could not be renewed, the server is down or paused — it will go later); `drop` removes it (the server
 * refused this item for good: sending it again would be refused again, and it must not hold up the rest).
 */
export type SendFailure = "stop" | "drop";
export function failureFor(err: unknown): SendFailure {
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 0;
  const code = (err as { code?: unknown })?.code;
  if (status === 0 || status === 401 || status === 408 || status === 425 || status === 426 || status === 429 || status >= 500) return "stop";
  if (code === "tenant_suspended" || code === "read_only" || code === "maintenance_read_only" || code === "maintenance_locked") return "stop";
  return "drop";
}

export type FlushResult = { sent: number; dropped: { item: OutboxItem; message: string }[]; left: number };

/**
 * Sends what is waiting, oldest first, stopping at the first item that cannot go yet (it stays, with
 * everything after it). An item the server refuses for good is dropped and reported. One flush at a time.
 */
export function flushOutbox(send: (item: OutboxItem) => Promise<unknown>, group?: string): Promise<FlushResult> {
  return serial(async () => {
    const index = await readIndex();
    const ours = index.filter((e) => mine(e) && (group === undefined || e.group === group));
    const done = new Set<string>();
    const dropped: FlushResult["dropped"] = [];
    let sent = 0;
    for (const entry of ours) {
      const item = await readItem(entry);
      if (!item) { done.add(entry.id); continue; }
      try {
        await send(item);
        sent += 1;
        done.add(entry.id);
      } catch (e) {
        if (failureFor(e) === "stop") break;
        dropped.push({ item, message: e instanceof Error ? e.message : "Refused." });
        done.add(entry.id);
      }
    }
    if (done.size) {
      await Promise.all([...done].map((id) => writeSecret(ITEM(id), null).catch(() => undefined)));
      await writeIndex(index.filter((e) => !done.has(e.id)));
    }
    return { sent, dropped, left: ours.length - done.size };
  });
}

/** Tests only: forget the in-memory count. */
export function resetOutboxForTests(): void {
  count = 0;
  loaded = false;
  owner = null;
  chain = Promise.resolve();
}
