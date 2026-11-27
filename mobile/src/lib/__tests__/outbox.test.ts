import { enqueue as queueAnswer, flushQueue, readQueue } from "@/components/applications/answer-queue";
import { ApiError } from "@/lib/api";
import { adoptOutboxOwner, clearOutbox, enqueue, failureFor, flushOutbox, isQueued, outboxCount, outboxKind, readOutbox, resetOutboxForTests, setOutboxOwner } from "@/lib/outbox";

/**
 * Board L4 · Working offline: notes, call outcomes and application answers wait on the phone (Keychain /
 * Keystore) and go in the order given; claiming, dialing and approving never wait.
 */
const mockSecrets = new Map<string, string>();
jest.mock("@/lib/secure", () => ({
  readSecret: async (k: string) => mockSecrets.get(k) ?? null,
  writeSecret: async (k: string, v: string | null) => { if (v === null) mockSecrets.delete(k); else mockSecrets.set(k, v); },
}));

beforeEach(() => { mockSecrets.clear(); resetOutboxForTests(); });

test("only notes and call outcomes queue from the shared request; dialing, claiming and approving never do", () => {
  expect(outboxKind("/api/app/leads/l1/notes", "POST")).toBe("note");
  expect(outboxKind("/api/app/dialer/attempt/a1/disposition", "POST")).toBe("outcome");
  expect(outboxKind("/api/app/leads/l1/notes", "GET")).toBeNull();
  expect(outboxKind("/api/app/dialer/attempt", "POST")).toBeNull();
  expect(outboxKind("/api/app/dialer/attempt/a1/click", "POST")).toBeNull();
  expect(outboxKind("/api/app/dialer/pick", "POST")).toBeNull();
  expect(outboxKind("/api/app/inbound/claim", "POST")).toBeNull();
  expect(outboxKind("/api/app/agency/payouts", "POST")).toBeNull();
  expect(isQueued({ queued: true, outboxId: "x" })).toBe(true);
  expect(isQueued({ ok: true })).toBe(false);
});

test("sends in the order given, and stops (keeping the rest) when there is still no answer", async () => {
  await enqueue({ kind: "note", method: "POST", path: "/api/app/leads/l1/notes", body: { body: "first" } });
  await enqueue({ kind: "outcome", method: "POST", path: "/api/app/dialer/attempt/a1/disposition", body: { disposition: "no_answer" } });
  await enqueue({ kind: "note", method: "POST", path: "/api/app/leads/l1/notes", body: { body: "third" } });
  expect(outboxCount()).toBe(3);
  // Nothing in the store is plain JSON of the whole queue: one entry an item plus the index.
  expect([...mockSecrets.keys()].filter((k) => k.startsWith("insurvas.outbox."))).toHaveLength(3);

  const sent: string[] = [];
  let online = false;
  const send = async (item: { path: string; body: unknown }) => {
    if (!online && sent.length === 1) throw new ApiError(0, {});
    sent.push(JSON.stringify(item.body));
  };
  online = false;
  const first = await flushOutbox(send);
  expect(first).toMatchObject({ sent: 1, left: 2 });
  expect(outboxCount()).toBe(2);
  online = true;
  const second = await flushOutbox(send);
  expect(second).toMatchObject({ sent: 2, left: 0 });
  expect(sent).toEqual(['{"body":"first"}', '{"disposition":"no_answer"}', '{"body":"third"}']);
  expect(outboxCount()).toBe(0);
  expect([...mockSecrets.keys()]).toEqual([]);
});

test("a refusal for good is dropped and reported; a paused agency, a server error or a lost session keep it", async () => {
  expect(failureFor(new ApiError(0, {}))).toBe("stop");
  expect(failureFor(new ApiError(503, {}))).toBe("stop");
  expect(failureFor(new ApiError(401, {}))).toBe("stop");
  expect(failureFor(new ApiError(403, { code: "read_only" }))).toBe("stop");
  expect(failureFor(new ApiError(403, { code: "tenant_suspended" }))).toBe("stop");
  expect(failureFor(new ApiError(409, { error: "Already recorded." }))).toBe("drop");
  expect(failureFor(new ApiError(400, {}))).toBe("drop");

  await enqueue({ kind: "outcome", method: "POST", path: "/api/app/dialer/attempt/a1/disposition", body: { disposition: "sold" } });
  await enqueue({ kind: "note", method: "POST", path: "/api/app/leads/l1/notes", body: { body: "after" } });
  const sent: string[] = [];
  const result = await flushOutbox(async (item) => {
    if (item.kind === "outcome") throw new ApiError(409, { error: "This call already has an outcome." });
    sent.push(item.path);
  });
  expect(result.sent).toBe(1);
  expect(result.dropped.map((d) => d.message)).toEqual(["This call already has an outcome."]);
  expect(sent).toEqual(["/api/app/leads/l1/notes"]);
  expect(outboxCount()).toBe(0);
});

test("signing out empties it", async () => {
  await enqueue({ kind: "note", method: "POST", path: "/api/app/leads/l1/notes", body: { body: "private" } });
  await clearOutbox();
  expect(outboxCount()).toBe(0);
  expect(await readOutbox()).toEqual([]);
  expect([...mockSecrets.keys()]).toEqual([]);
});

test("application answers share the outbox: a later answer replaces the waiting one, and hidden follow-ups go with it", async () => {
  await queueAnswer("c1", { key: "smoker", value: true, hidden: [] });
  await queueAnswer("c1", { key: "packs", value: 2, hidden: [] });
  await queueAnswer("c2", { key: "smoker", value: false, hidden: [] });
  // "No" to smoking hides the packs question: its waiting answer is dropped, and the newer smoker answer wins.
  await queueAnswer("c1", { key: "smoker", value: false, hidden: ["packs"] });
  expect(await readQueue("c1")).toEqual([{ key: "smoker", value: false, hidden: ["packs"] }]);
  expect(outboxCount()).toBe(2);
  const [item] = await readOutbox("answers:c1");
  expect(item).toMatchObject({ kind: "answer", method: "PUT", path: "/api/app/applications/cases/c1/interview", body: { insured_role: "primary", answers: [{ key: "smoker", value: false }], hidden: ["packs"] } });

  const sent: string[] = [];
  expect(await flushQueue("c1", async (a) => { sent.push(a.key); })).toBe(0);
  expect(sent).toEqual(["smoker"]);
  expect(await readQueue("c2")).toHaveLength(1);
});

test("answers saved by an older build (one entry a case) move into the outbox", async () => {
  mockSecrets.set("insurvas.answers.c9", JSON.stringify([{ key: "dob", value: "1950-01-02", hidden: [] }]));
  expect(await readQueue("c9")).toEqual([{ key: "dob", value: "1950-01-02", hidden: [] }]);
  expect(mockSecrets.has("insurvas.answers.c9")).toBe(false);
  expect(outboxCount()).toBe(1);
});

describe("whose items they are", () => {
  const ava = { user: "u1", tenant: "t1" };
  test("only the current person and workspace count and go; another workspace waits; someone else drops them", async () => {
    await setOutboxOwner(ava);
    await enqueue({ kind: "note", method: "POST", path: "/api/app/leads/l1/notes", body: { body: "t1 note" } });
    await setOutboxOwner({ user: "u1", tenant: "t2" });
    expect(outboxCount()).toBe(0);
    const sentPaths: string[] = [];
    await flushOutbox(async (item) => { sentPaths.push(item.path); });
    expect(sentPaths).toEqual([]);
    await adoptOutboxOwner(ava);
    expect(outboxCount()).toBe(1);
    await setOutboxOwner(null);
    expect(outboxCount()).toBe(0);
    await adoptOutboxOwner({ user: "u2", tenant: "t1" });
    expect(outboxCount()).toBe(0);
    await adoptOutboxOwner(ava);
    expect(outboxCount()).toBe(0);
    expect((await readOutbox()).length).toBe(0);
  });
});
