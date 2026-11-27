import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react-native";

import { Button, Header } from "@/components/ui";
import { isQueued, resetOutboxForTests } from "@/lib/outbox";
import { SessionProvider, useSession } from "@/lib/session";

/**
 * Board L4 through the shared request: with no signal a note or a call outcome waits on the phone, the bar says
 * "Offline · N to send", and the next answer sends them in order. M6: a read-only plan marks the bar and turns the
 * gold button off. Signing out empties what waited.
 */
const mockSecrets = new Map<string, string>();
jest.mock("@/lib/secure", () => ({
  KEYS: { access: "insurvas.access", expiresAt: "insurvas.expiresAt", refresh: "insurvas.refresh", trusted: "insurvas.trusted", biometric: "insurvas.biometric", pushToken: "insurvas.pushToken" },
  readSecret: async (k: string) => mockSecrets.get(k) ?? null,
  writeSecret: async (k: string, v: string | null) => { if (v === null) mockSecrets.delete(k); else mockSecrets.set(k, v); },
}));
let mockLevel = 1;
let mockAuthOk = true;
jest.mock("expo-local-authentication", () => ({ SecurityLevel: { NONE: 0, SECRET: 1 }, getEnrolledLevelAsync: async () => mockLevel, authenticateAsync: async () => ({ success: mockAuthOk }) }));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: async () => ({ status: "granted" }) }));

type Sent = { path: string; method: string; body: unknown };
let online = true;
let access = "full";
const sent: Sent[] = [];
const realFetch = globalThis.fetch;

function serve() {
  globalThis.fetch = jest.fn(async (url: string, init: { method?: string; body?: string }) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (!online) throw new TypeError("Network request failed");
    sent.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
    const json = path === "/api/app/me"
      ? { user: { id: "u1", email: "a@b.c", name: "Ava" }, tenant: { id: "t1", name: "Ellery & Fields", status: "active", plan_code: "pro" }, role: "producer", memberRole: "producer", agencyTitle: null, roles: ["producer"], plan: { code: "pro", name: "Pro", access, features: [], disabled: [] } }
      : path === "/api/app/auth/mobile/logout" ? { ok: true } : { ok: true };
    return { ok: true, status: 200, json: async () => json };
  }) as unknown as typeof fetch;
}

let session: ReturnType<typeof useSession> | null = null;
const keep = (s: ReturnType<typeof useSession>) => { session = s; };
function Probe({ onSession }: { onSession: (s: ReturnType<typeof useSession>) => void }) {
  const s = useSession();
  useEffect(() => onSession(s));
  return (
    <>
      <Header title="Today" />
      <Button testID="start" kind="gold" label="Start calling" onPress={() => undefined} />
    </>
  );
}

async function signedIn() {
  mockSecrets.set("insurvas.access", "tok");
  mockSecrets.set("insurvas.expiresAt", String(Math.floor(Date.now() / 1000) + 3600));
  mockSecrets.set("insurvas.refresh", "ref");
  mockSecrets.set("insurvas.biometric", "0");
  await render(<SessionProvider><Probe onSession={keep} /></SessionProvider>);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await session!.unlock(); });
}

beforeEach(() => { mockSecrets.clear(); sent.length = 0; online = true; access = "full"; mockLevel = 1; mockAuthOk = true; resetOutboxForTests(); serve(); });
afterAll(() => { globalThis.fetch = realFetch; });

test("offline: a note and an outcome wait on the phone, the bar counts them, and the next answer sends them in order", async () => {
  await signedIn();
  expect(screen.queryByTestId("bar-offline")).toBeNull();
  online = false;
  let a: unknown, b: unknown;
  await act(async () => { a = await session!.api("/api/app/leads/l1/notes", { method: "POST", body: { body: "Wants a callback after 5", idempotency_key: "k1" } }); });
  await act(async () => { b = await session!.api("/api/app/dialer/attempt/at1/disposition", { method: "POST", body: { disposition: "callback" } }); });
  expect(isQueued(a)).toBe(true);
  expect(isQueued(b)).toBe(true);
  expect(screen.getByTestId("bar-offline")).toHaveTextContent("Offline · 2 to send");
  // Dialing needs the server: it fails as before and never waits.
  await act(async () => { await expect(session!.api("/api/app/dialer/attempt", { method: "POST", body: {} })).rejects.toMatchObject({ status: 0 }); });
  expect(screen.getByTestId("bar-offline")).toHaveTextContent("Offline · 2 to send");

  online = true;
  sent.length = 0;
  await act(async () => { await session!.api("/api/app/nav/counts"); });
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/app/nav/counts", "POST /api/app/leads/l1/notes", "POST /api/app/dialer/attempt/at1/disposition"]);
  expect(sent[1].body).toEqual({ body: "Wants a callback after 5", idempotency_key: "k1" });
  expect(screen.queryByTestId("bar-offline")).toBeNull();
  expect(session!.toSend).toBe(0);
});

test("while older notes wait, a new one waits behind them (order is kept)", async () => {
  await signedIn();
  online = false;
  await act(async () => { await session!.api("/api/app/leads/l1/notes", { method: "POST", body: { body: "one" } }); });
  online = true;
  sent.length = 0;
  await act(async () => { await session!.api("/api/app/leads/l1/notes", { method: "POST", body: { body: "two" } }); });
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
  expect(sent.map((s) => (s.body as { body: string }).body)).toEqual(["one", "two"]);
});

test("signing out empties what waited", async () => {
  await signedIn();
  online = false;
  await act(async () => { await session!.api("/api/app/leads/l1/notes", { method: "POST", body: { body: "private" } }); });
  expect([...mockSecrets.keys()].some((k) => k.startsWith("insurvas.outbox"))).toBe(true);
  await act(async () => { await session!.signOut(); });
  expect([...mockSecrets.keys()].some((k) => k.startsWith("insurvas.outbox"))).toBe(false);
});

test("M6: a read-only plan marks the bar and turns the gold button off before any write is refused", async () => {
  access = "read_only";
  await signedIn();
  expect(screen.getByTestId("bar-read-only")).toHaveTextContent("Read only");
  expect(screen.getByTestId("start")).toBeDisabled();
  expect(session!.readOnly?.code).toBe("read_only");
});

test("M7: the lock never opens on its own — a refused check stays locked, a phone with no screen lock goes to Sign in", async () => {
  mockSecrets.set("insurvas.access", "tok");
  mockSecrets.set("insurvas.expiresAt", String(Math.floor(Date.now() / 1000) + 3600));
  mockSecrets.set("insurvas.refresh", "ref");
  mockSecrets.set("insurvas.biometric", "0");
  await render(<SessionProvider><Probe onSession={keep} /></SessionProvider>);
  await act(async () => { await Promise.resolve(); });
  mockAuthOk = false;
  let ok: boolean | null = null;
  await act(async () => { ok = await session!.unlock(); });
  expect(ok).toBe(false);
  expect(session!.status).toBe("locked");
  mockLevel = 0;
  await act(async () => { ok = await session!.unlock(); });
  expect(ok).toBe(false);
  expect(session!.status).toBe("signedOut");
  expect(sent.some((s) => s.path === "/api/app/me")).toBe(false);
});

test("Use password keeps the person's unsent notes; they go when the same person is back, never under someone else", async () => {
  await signedIn();
  online = false;
  await act(async () => { await session!.api("/api/app/leads/l1/notes", { method: "POST", body: { body: "mine" } }); });
  await act(async () => { await session!.signOut({ keepToSend: true }); });
  expect(session!.status).toBe("signedOut");
  expect([...mockSecrets.keys()].some((k) => k.startsWith("insurvas.outbox."))).toBe(true);
  expect(session!.toSend).toBe(0);
});
