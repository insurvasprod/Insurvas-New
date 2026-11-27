import { act, render } from "@testing-library/react-native";

import { PartnerSessionProvider, PARTNER_KEYS, PARTNER_PAUSED_WORDS, usePartnerSession, type PartnerSessionValue } from "../session";

/**
 * The partner's session keeps to the partner plane: it signs in, refreshes and signs out only through
 * /api/partner/auth/*, keeps its tokens under its own Keychain names (never the agency's), and a refused
 * refresh signs the phone out while an unreachable server keeps it signed in.
 */
const mockRaw = jest.fn();
const mockStore = new Map<string, string>();
jest.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number; code: string | null; body: Record<string, unknown>;
    constructor(status: number, body: Record<string, unknown>) { super(typeof body.error === "string" ? body.error : "x"); this.status = status; this.code = typeof body.code === "string" ? body.code : null; this.body = body; }
  }
  return { API_URL: "http://test", ApiError, rawRequest: (...a: unknown[]) => mockRaw(...a), formRequest: async () => ({}), appHeaders: () => ({ "x-insurvas-client": "app" }), noteUpdateRequired: () => undefined };
});
jest.mock("@/lib/secure", () => ({
  KEYS: { biometric: "insurvas.biometric", access: "insurvas.access", refresh: "insurvas.refresh" },
  readSecret: async (k: string) => mockStore.get(k) ?? null,
  writeSecret: async (k: string, v: string | null) => { if (v === null) mockStore.delete(k); else mockStore.set(k, v); },
}));
let mockLevel = 1;
jest.mock("expo-local-authentication", () => ({ SecurityLevel: { NONE: 0, SECRET: 1 }, getEnrolledLevelAsync: async () => mockLevel, authenticateAsync: async () => ({ success: true }) }));

const { ApiError } = jest.requireMock("@/lib/api") as { ApiError: new (s: number, b: Record<string, unknown>) => Error };
const me = { userId: "u1", name: "Maya Santos", partnerId: "p1", partnerName: "Apex Leads", role: "partner_admin", partnerType: "publisher", partnerStatus: "active", hasTeam: true, agencyName: "Ellery & Fields" };

async function mount() {
  let value: PartnerSessionValue | null = null;
  function Probe() { value = usePartnerSession(); return null; }
  await render(<PartnerSessionProvider><Probe /></PartnerSessionProvider>);
  await act(async () => { await Promise.resolve(); });
  return () => value!;
}

beforeEach(() => { mockRaw.mockReset(); mockStore.clear(); mockLevel = 1; });

test("M7: a phone with no screen lock never opens the partner app from the lock; it goes to sign in", async () => {
  mockStore.set(PARTNER_KEYS.refresh, "r1"); mockStore.set(PARTNER_KEYS.access, "a1"); mockStore.set(PARTNER_KEYS.expiresAt, String(Math.floor(Date.now() / 1000) + 3600));
  mockRaw.mockImplementation(async (path: string) => { throw new Error(`unexpected ${path}`); });
  mockLevel = 0;
  const s = await mount();
  expect(s().status).toBe("locked");
  let ok: boolean | null = null;
  await act(async () => { ok = await s().unlock(); });
  expect(ok).toBe(false);
  expect(s().status).toBe("signedOut");
  expect(mockRaw).not.toHaveBeenCalled();
});

test("signs in through the partner door and keeps the tokens under the partner's own names", async () => {
  mockRaw.mockImplementation(async (path: string) => {
    if (path === "/api/partner/auth/mobile/login") return { ok: true, access: "a1", refresh: "r1", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    if (path === "/api/partner/me") return me;
    throw new Error(`unexpected ${path}`);
  });
  const s = await mount();
  expect(s().status).toBe("signedOut");
  await act(async () => { await s().signIn("maya@apex.test", "pw"); });
  expect(mockRaw.mock.calls[0]).toEqual(["/api/partner/auth/mobile/login", { method: "POST", body: { email: "maya@apex.test", password: "pw", remember: true } }]);
  expect(mockRaw.mock.calls[1]).toEqual(["/api/partner/me", { token: "a1" }]);
  expect(s().status).toBe("signedIn");
  expect(s().me?.partnerName).toBe("Apex Leads");
  expect(mockStore.get(PARTNER_KEYS.refresh)).toBe("r1");
  // Never the agency's entries.
  expect(mockStore.has("insurvas.access")).toBe(false);
  expect(mockStore.has("insurvas.refresh")).toBe(false);
  // Nothing on the agency plane was called.
  expect(mockRaw.mock.calls.some(([p]) => String(p).startsWith("/api/app"))).toBe(false);
});

test("a 401 gets a new token from the partner refresh and asks again", async () => {
  mockStore.set(PARTNER_KEYS.refresh, "r1"); mockStore.set(PARTNER_KEYS.access, "old"); mockStore.set(PARTNER_KEYS.expiresAt, String(Math.floor(Date.now() / 1000) + 3600));
  let first = true;
  mockRaw.mockImplementation(async (path: string, init: { token?: string }) => {
    if (path === "/api/partner/auth/mobile/refresh") return { access: "new", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    if (path === "/api/partner/me") return me;
    if (path === "/api/partner/overview") {
      if (first) { first = false; throw new ApiError(401, { error: "Not authenticated" }); }
      return { ok: init.token };
    }
    throw new Error(`unexpected ${path}`);
  });
  const s = await mount();
  expect(s().status).toBe("locked");
  await act(async () => { await s().unlock(); });
  let answer: unknown;
  await act(async () => { answer = await s().api("/api/partner/overview"); });
  expect(answer).toEqual({ ok: "new" });
  expect(mockRaw).toHaveBeenCalledWith("/api/partner/auth/mobile/refresh", { method: "POST", body: { refresh: "r1" } });
  expect(mockStore.get(PARTNER_KEYS.access)).toBe("new");
});

test("a refused refresh signs out; an unreachable one keeps the sign-in", async () => {
  mockStore.set(PARTNER_KEYS.refresh, "r1"); mockStore.set(PARTNER_KEYS.access, "old"); mockStore.set(PARTNER_KEYS.expiresAt, "0");
  mockRaw.mockImplementation(async (path: string) => {
    if (path === "/api/partner/auth/mobile/refresh") throw new ApiError(503, { error: "Try again" });
    throw new Error(`unexpected ${path}`);
  });
  const s = await mount();
  await act(async () => { await expect(s().api("/api/partner/me")).rejects.toThrow(/Couldn’t reach/); });
  expect(mockStore.get(PARTNER_KEYS.refresh)).toBe("r1");
  mockRaw.mockImplementation(async (path: string) => {
    if (path === "/api/partner/auth/mobile/refresh") throw new ApiError(401, { error: "Sign in again.", code: "sign_in_again" });
    throw new Error(`unexpected ${path}`);
  });
  await act(async () => { await expect(s().api("/api/partner/me")).rejects.toThrow(); });
  expect(s().status).toBe("signedOut");
  expect(mockStore.has(PARTNER_KEYS.refresh)).toBe(false);
});

test("sign out uses the partner portal's own sign-out and forgets the tokens", async () => {
  mockRaw.mockImplementation(async (path: string) => {
    if (path === "/api/partner/auth/mobile/login") return { access: "a1", refresh: "r1", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    if (path === "/api/partner/me") return me;
    if (path === "/api/partner/auth/logout") return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
  const s = await mount();
  await act(async () => { await s().signIn("maya@apex.test", "pw"); });
  await act(async () => { await s().signOut(); });
  expect(mockRaw).toHaveBeenCalledWith("/api/partner/auth/logout", { method: "POST", token: "a1" });
  expect(s().status).toBe("signedOut");
  expect(mockStore.size).toBe(0);
});

test("L4 / M6: no answer marks the app offline; a maintenance refusal or a paused partner is read only", async () => {
  mockRaw.mockImplementation(async (path: string) => {
    if (path === "/api/partner/auth/mobile/login") return { access: "a1", refresh: "r1", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    if (path === "/api/partner/me") return { ...me, partnerStatus: "paused" };
    if (path === "/api/partner/overview") throw new ApiError(0, {});
    if (path === "/api/partner/leads") throw new ApiError(503, { error: "The platform is read-only while maintenance is underway.", code: "maintenance_read_only" });
    throw new Error(`unexpected ${path}`);
  });
  const s = await mount();
  await act(async () => { await s().signIn("maya@apex.test", "pw"); });
  expect(s().readOnly).toEqual({ code: "partner_paused", message: PARTNER_PAUSED_WORDS });
  await act(async () => { await expect(s().api("/api/partner/overview")).rejects.toBeTruthy(); });
  expect(s().offline).toBe(true);
  await act(async () => { await expect(s().api("/api/partner/leads", { method: "POST", body: {} })).rejects.toBeTruthy(); });
  expect(s().offline).toBe(false);
  expect(s().readOnly?.code).toBe("maintenance_read_only");
});
