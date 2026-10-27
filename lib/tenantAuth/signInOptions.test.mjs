// Sign-in redesign (2026-10-24): "Keep me signed in", "Trust this device for 30 days" and the emailed
// sign-in link. The tokens are exercised for real; the routes are read for the rules they must keep.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

process.env.TENANT_SESSION_SECRET ||= "test-secret-for-sign-in-options-0123456789";
const session = await import("./session.ts");

test("keep me signed in: unticked is a browser-session cookie, and a re-issue keeps the choice and the expiry", async () => {
  assert.equal(session.tenantSessionCookie(true).maxAge, 12 * 60 * 60);
  assert.equal("maxAge" in session.tenantSessionCookie(false), false, "no max-age: the cookie ends with the browser");
  assert.equal(session.tenantSessionCookie(true, 600).maxAge, 600);

  const token = await session.signTenantSessionToken("u", "t", 1, "11111111-1111-4111-8111-111111111111", { remember: false });
  const payload = await session.verifyTenantSessionToken(token);
  assert.equal(payload.remember, false);
  const carried = session.continuedTenantSession(payload);
  assert.equal(carried.remember, false);
  assert.equal(carried.expiresAt, payload.exp, "a re-issued token keeps the original expiry");
  // Cookies from before the box existed were always persistent, and stay so.
  assert.equal(session.continuedTenantSession({}).remember, true);
});

test("a trusted-device token and a sign-in link are never a session, and never each other", async () => {
  const trusted = await session.signTenantTrustedDeviceToken({ sub: "u", sessionVersion: 2, enabledAt: "2026-10-01T00:00:00Z", verifiedAt: "2026-10-24T00:00:00Z" });
  const link = await session.signTenantSignInLinkToken({ sub: "u", email: "a@b.co", sessionVersion: 2, lastLoginAt: null, jti: "j1", remember: true });
  for (const token of [trusted, link]) {
    assert.equal(await session.verifyTenantSessionToken(token), null, "not a session");
    assert.equal(await session.verifyTenantPending2faToken(token), null, "not the code step");
  }
  assert.equal(await session.verifyTenantSignInLinkToken(trusted), null);
  assert.equal(await session.verifyTenantTrustedDeviceToken(link), null);
  assert.deepEqual(await session.verifyTenantTrustedDeviceToken(trusted), { sub: "u", sessionVersion: 2, enabledAt: "2026-10-01T00:00:00Z", verifiedAt: "2026-10-24T00:00:00Z" });
  assert.deepEqual(await session.verifyTenantSignInLinkToken(link), { sub: "u", email: "a@b.co", sessionVersion: 2, lastLoginAt: null, jti: "j1", remember: true });
  // The trust cookie is read by the sign-in routes only.
  assert.equal(session.tenantTrustedDeviceCookieOptions.path, "/api/app/auth");
  assert.equal(session.tenantTrustedDeviceCookieOptions.httpOnly, true);
});

test("the login route takes a link only through the same checks as a password", () => {
  const entry = read("app/api/app/auth/login/route.ts");
  // The link names the person, so the per-address lockout runs before anything is looked up.
  assert.ok(entry.indexOf("verifyTenantSignInLinkToken(") < entry.indexOf("checkLoginAllowed("));
  assert.ok(entry.indexOf("checkLoginAllowed(") < entry.indexOf("signInWithPassword("));
  assert.ok(entry.indexOf("checkLoginAllowed(") < entry.indexOf("completeTenantSignIn("));
  assert.match(entry, /completeTenantSignIn\(\{[^}]*via: link \? "link" : "password", link \}\)/, "the link goes to the shared checks");
  // From there, the shared path (lib/tenantAuth/completeSignIn.ts) holds the link to its checks.
  const route = read("lib/tenantAuth/completeSignIn.ts");
  // Once only: the session version, last sign-in time and a fail-closed claim, before the partner check.
  const once = route.indexOf("claimLinkOnce(link.jti)");
  assert.ok(once > 0 && once < route.indexOf("if (isPartnerAccount)"));
  assert.match(route, /user\.session_version !== link\.sessionVersion \|\| \(user\.last_login_at \?\? null\) !== link\.lastLoginAt/);
  assert.match(route, /console\.error\("\[sign-in link\] could not claim the link, refusing it:"/);
  assert.match(route, /return data === true;/);
  // A trusted device is bound to the person, their session version and their authenticator.
  assert.match(route, /trusted\.sub !== userId \|\| trusted\.sessionVersion !== sessionVersion \|\| trusted\.enabledAt !== enabledAt/);
  assert.match(route, /if \(enrolled && !trusted\) \{/);
});

test("the link request answers every address the same and sends nothing for a partner or a pending account", () => {
  const route = read("app/api/app/auth/sign-in-link/route.ts");
  assert.match(route, /after\(async \(\) => \{/);
  assert.match(route, /return NextResponse\.json\(SENT\);/);
  assert.match(route, /if \(!user \|\| user\.status !== "active"\) return;/);
  assert.match(route, /if \(!count \|\| isPartner\) return;/);
  // The token travels in the fragment: never in a server log or a Referer.
  assert.match(route, /\/app\/login#link=\$\{encodeURIComponent\(token\)\}/);
});
