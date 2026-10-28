// Run with: npm test
//
// Google sign-in (2026-10-27): what the callback reads from the Auth user, the flow cookie, and the
// rules the routes must keep. DB-free and network-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { googleAccountState, googleProfile, parseGoogleFlow } from "./googleProfile.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.parse("2026-10-27T20:00:00Z");
const user = (identities, extra = {}) => ({ id: "auth-1", email: "Dana@Northline.com", user_metadata: {}, identities, ...extra });
const google = (data, createdAt = "2026-10-01T00:00:00Z") => ({ provider: "google", identity_data: data, created_at: createdAt });

test("the profile takes the address in lower case, the name Google gives, and Google's own verified flag", () => {
  const profile = googleProfile(user([google({ email_verified: true, full_name: " Dana Reyes " })]), NOW);
  assert.deepEqual(profile, { authUserId: "auth-1", email: "dana@northline.com", name: "Dana Reyes", verified: true, newlyLinked: false });
});

test("an address Google does not vouch for is not verified", () => {
  assert.equal(googleProfile(user([google({ email_verified: false })]), NOW)?.verified, false);
  assert.equal(googleProfile(user([google({})]), NOW)?.verified, false);
});

test("without a Google identity or an address there is no profile", () => {
  assert.equal(googleProfile(user([{ provider: "email", identity_data: {}, created_at: "2026-10-01T00:00:00Z" }]), NOW), null);
  assert.equal(googleProfile(user([google({ email_verified: true })], { email: "" }), NOW), null);
});

test("Google added just now to an account with a password counts as newly linked; an old link does not", () => {
  const password = { provider: "email", identity_data: {}, created_at: "2026-01-01T00:00:00Z" };
  assert.equal(googleProfile(user([password, google({ email_verified: true }, "2026-10-27T19:58:00Z")]), NOW)?.newlyLinked, true);
  assert.equal(googleProfile(user([password, google({ email_verified: true }, "2026-10-20T00:00:00Z")]), NOW)?.newlyLinked, false);
  assert.equal(googleProfile(user([google({ email_verified: true }, "2026-10-27T19:58:00Z")]), NOW)?.newlyLinked, false, "a Google-only account is not a link");
});

test("the flow cookie must name a verifier and a known intent", () => {
  assert.deepEqual(parseGoogleFlow(JSON.stringify({ verifier: "v", intent: "sign-up", plan: "basic", cycle: null })), { verifier: "v", intent: "sign-up", plan: "basic", cycle: null });
  assert.equal(parseGoogleFlow(JSON.stringify({ verifier: "v", intent: "admin" })), null);
  assert.equal(parseGoogleFlow(JSON.stringify({ intent: "sign-in" })), null);
  assert.equal(parseGoogleFlow("not json"), null);
  assert.equal(parseGoogleFlow(undefined), null);
});

// Owner test, 2026-10-27: the trigger gives every new Auth user an "invited" row, so a first Google
// sign-in found a row and was refused. A bare invited row is a new person.
test("a bare invited row is a new person; an agency invitation waits; anything else is an account", () => {
  const none = { agency: 0, partner: 0 };
  assert.equal(googleAccountState(null, none), "new");
  assert.equal(googleAccountState({ status: "invited" }, none), "new", "the row the trigger made for this Google login");
  assert.equal(googleAccountState({ status: "invited" }, { agency: 1, partner: 0 }), "invited");
  assert.equal(googleAccountState({ status: "invited" }, { agency: 0, partner: 1 }), "invited");
  for (const status of ["active", "pending_verification", "suspended", "inactive"]) {
    assert.equal(googleAccountState({ status }, none), "account", status);
  }
});

test("the callback refuses an unverified address and signs in only through completeTenantSignIn", () => {
  const route = read("app/api/app/auth/google/callback/route.ts");
  assert.ok(route.indexOf('if (!profile.verified) return refuse("unverified")') > 0);
  assert.ok(route.indexOf("checkLoginAllowed(") < route.indexOf("completeTenantSignIn("), "the lockout runs first");
  assert.match(route, /completeTenantSignIn\(\{ request, authUserId: profile\.authUserId, email: profile\.email, remember: true, via: "google" \}\)/);
  assert.doesNotMatch(route, /issueTenantSession\(/, "no session except through the shared path");
  // A refusal shows a fixed reason, never text taken from the URL.
  assert.doesNotMatch(route, /searchParams\.set\("google", params\./);
});

test("the start route keeps the verifier server-side and shows nothing when Google is off", () => {
  const start = read("app/api/app/auth/google/start/route.ts");
  assert.match(start, /if \(!\(await googleSignInEnabled\(\)\)\)/);
  const lib = read("lib/tenantAuth/google.ts");
  assert.match(lib, /httpOnly: true/);
  assert.match(lib, /path: "\/api\/app\/auth\/google"/);
  assert.match(lib, /flowType: "pkce"/);
  assert.match(lib, /process\.env\.NEXT_PUBLIC_APP_URL/, "the callback address is configured, never the request's Host");
});

test("Google is offered on the agent doors only", () => {
  for (const file of ["components/partner/partner-auth-frame.tsx", "app/admin/login/page.tsx", "components/partner/partner-login-form.tsx"]) {
    let source = "";
    try { source = read(file); } catch { continue; }
    assert.doesNotMatch(source, /GoogleButton/, `${file} must not offer Google`);
  }
});
