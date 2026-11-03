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

test("the enrolment token carries the secret, belongs to one admin and opens nothing else", async () => {
  const { signTotpEnrolToken, verifyTotpEnrolToken, verifyPending2faToken, isTotpEnrolled, totpEnrolCookieOptions } =
    await import("./session.ts");
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const token = await signTotpEnrolToken("00000000-0000-4000-8000-000000000002", secret);
  const payload = await verifyTotpEnrolToken(token);
  assert.equal(payload?.secret, secret);
  assert.equal(payload?.sub, "00000000-0000-4000-8000-000000000002");
  assert.equal(await verifyAdminSessionToken(token), null);
  assert.equal(await verifyPending2faToken(token), null);
  // And a pending-2FA token is not an enrolment token.
  const { signPending2faToken } = await import("./session.ts");
  assert.equal(await verifyTotpEnrolToken(await signPending2faToken("00000000-0000-4000-8000-000000000002")), null);
  assert.equal(totpEnrolCookieOptions.maxAge, 5 * 60);
  assert.equal(totpEnrolCookieOptions.httpOnly, true);
  // An account with the default empty secret has not enrolled.
  assert.equal(isTotpEnrolled(""), false);
  assert.equal(isTotpEnrolled("   "), false);
  assert.equal(isTotpEnrolled(null), false);
  assert.equal(isTotpEnrolled(secret), true);
});
