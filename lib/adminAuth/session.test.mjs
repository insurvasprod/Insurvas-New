import assert from "node:assert/strict";
import test from "node:test";
import { decodeJwt } from "jose";

process.env.ADMIN_SESSION_SECRET ??= "test-only-admin-session-secret-at-least-32-bytes";

const {
  clearedAdminCookieOptions,
  pending2faCookieOptions,
  sessionCookieOptions,
  signAdminSessionToken,
  verifyAdminSessionToken,
} = await import("./session.ts");

test("the admin session cookie ends with the browser: no maxAge, no expires", () => {
  assert.equal("maxAge" in sessionCookieOptions, false);
  assert.equal("expires" in sessionCookieOptions, false);
  assert.equal(sessionCookieOptions.httpOnly, true);
  assert.equal(sessionCookieOptions.path, "/");
});

test("the session token itself still expires after 12 hours", async () => {
  const token = await signAdminSessionToken("00000000-0000-4000-8000-000000000001", "super_admin");
  const { iat, exp } = decodeJwt(token);
  assert.equal(exp - iat, 12 * 60 * 60);
  assert.equal((await verifyAdminSessionToken(token))?.stage, "authenticated");
});

test("the pending second-factor cookie keeps its five-minute life", () => {
  assert.equal(pending2faCookieOptions.maxAge, 5 * 60);
});

test("clearing a cookie carries its domain and path, so a domain cookie is really removed", () => {
  assert.equal(clearedAdminCookieOptions.maxAge, 0);
  assert.equal(clearedAdminCookieOptions.domain, sessionCookieOptions.domain);
  assert.equal(clearedAdminCookieOptions.path, sessionCookieOptions.path);
});
