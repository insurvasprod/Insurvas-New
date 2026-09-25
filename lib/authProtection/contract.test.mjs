import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("SA-6.2 login protection runs before credential lookup and uses persistent buckets", async () => {
  const adminRoute = await read("app/api/admin/auth/login/route.ts");
  const tenantRoute = await read("app/api/app/auth/login/route.ts");
  const partnerRoute = await read("app/api/partner/auth/login/route.ts");
  const protection = await read("lib/authProtection/index.ts");

  for (const route of [adminRoute, tenantRoute, partnerRoute]) {
    assert.match(route, /checkLoginAllowed\(/);
    assert.match(route, /loginRateLimitResponse\(/);
    assert.ok(route.indexOf("checkLoginAllowed(") < route.indexOf("const supabase ="));
  }
  // The bucket names moved to lib/authProtection/factor.ts (a plain module, behaviour-tested in
  // factor.test.mjs). `plane` is the actor type for the password step, so these are the same
  // login_admin_email / login_admin_ip / login_user_* buckets as before.
  const factor = await read("lib/authProtection/factor.ts");
  assert.match(protection, /rateLimitClaims\(actorType, factor, email, ip, settings\.attempts, settings\.windowSeconds\)/);
  assert.match(factor, /const plane = protectionPlane\(actorType, factor\);/);
  assert.match(factor, /login_\$\{plane\}_email`\), subject: safePart\(email, 320\)/);
  assert.match(factor, /login_\$\{plane\}_ip`\), subject: safePart\(ip, 128\)/);
  assert.match(protection, /login_lockout:/);
  assert.match(protection, /security\.lockout_threshold/);
  assert.match(protection, /security\.lockout_minutes/);
  assert.match(partnerRoute, /recordLoginFailure\("user", email, request\)/);
  assert.match(partnerRoute, /clearLoginFailures\("user", email, request\)/);
});

test("blocked sign-ins are logged after the response, capped, and never on a failed check", async () => {
  const protection = await read("lib/authProtection/index.ts");
  const routes = {
    admin: await read("app/api/admin/auth/login/route.ts"),
    user: await read("app/api/app/auth/login/route.ts"),
    partner: await read("app/api/partner/auth/login/route.ts"),
  };

  for (const [name, route] of Object.entries(routes)) {
    const actor = name === "admin" ? "admin" : "user";
    const refusal = route.indexOf("if (!protection.allowed)");
    const logged = route.indexOf(`logBlockedLoginAttempt("${actor}", email, request, protection)`);
    const responded = route.indexOf("loginRateLimitResponse(protection.retryAfterSeconds)");
    assert.ok(refusal !== -1 && logged > refusal && logged < responded, `${name} login must log the refusal it returns`);
    // Not awaited: the 429 must not wait for the log.
    assert.doesNotMatch(route, /await\s+logBlockedLoginAttempt/);
  }

  const fn = protection.slice(protection.indexOf("export function logBlockedLoginAttempt"));
  assert.match(fn, /if \(blocked\.checkFailed\) return;/);
  assert.match(fn, /login_blocked_log:/);
  assert.match(fn, /p_max: 1,/);
  assert.match(fn, /after\(work\)/);
  assert.match(protection, /BLOCKED_LOG_WINDOW_SECONDS = 60;/);
  assert.equal((protection.match(/checkFailed: true/g) ?? []).length, 2, "both fail-closed paths are marked");
});

test("admin second factor: locked out per email + IP before the code is checked, in its own buckets", async () => {
  const route = await read("app/api/admin/auth/verify-2fa/route.ts");
  const login = await read("app/api/admin/auth/login/route.ts");

  const check = route.indexOf('checkLoginAllowed("admin", admin.email, request, "totp")');
  const refusal = route.indexOf("if (!protection.allowed)");
  const logged = route.indexOf('logBlockedLoginAttempt("admin", admin.email, request, protection, "totp")');
  const responded = route.indexOf("loginRateLimitResponse(protection.retryAfterSeconds)");
  const verified = route.indexOf("verifyTotpStep(");
  assert.ok(check !== -1, "verify-2fa must run the second-factor lockout check");
  assert.ok(check < refusal && refusal < logged && logged < responded, "a refused code is logged, then refused");
  assert.ok(responded < verified, "the code must not be checked while the email + IP is locked out");
  assert.doesNotMatch(route, /await\s+logBlockedLoginAttempt/);

  // The lockout answer is the same body as a wrong code.
  assert.match(route, /NextResponse\.json\(GENERIC_ERROR, loginRateLimitResponse\(protection\.retryAfterSeconds\)\)/);

  // A wrong code and a replayed code both count toward the lockout; only a claimed code clears it.
  const failures = route.match(/recordLoginFailure\("admin", admin\.email, request, "totp"\)/g) ?? [];
  assert.equal(failures.length, 2, "wrong and replayed codes both count");
  assert.match(route, /failureReason: "invalid_2fa"/);
  assert.match(route, /failureReason: "replayed_2fa"/);
  const cleared = route.indexOf('clearLoginFailures("admin", admin.email, request, "totp")');
  assert.ok(cleared > route.indexOf("claimTotpStep("), "the code count is cleared only after the step is claimed");
  assert.ok(cleared < route.indexOf("signAdminSessionToken("));

  // A correct password must not reset the code count: the login route clears the password bucket only.
  assert.match(login, /clearLoginFailures\("admin", email, request\);/);
  assert.doesNotMatch(login, /"totp"/);
});

test("admin second factor: a replayed step is refused, a failed replay check fails closed", async () => {
  const route = await read("app/api/admin/auth/verify-2fa/route.ts");
  const replay = await read("lib/adminAuth/totpReplay.ts");

  assert.match(route, /if \(claim === "replayed"\) \{/);
  assert.match(route, /if \(claim === "error"\) \{[\s\S]*?return NextResponse\.json\(GENERIC_ERROR, \{ status: 401 \}\);/);
  assert.ok(route.indexOf("claimTotpStep(") < route.indexOf("signAdminSessionToken("), "claim before the session is issued");

  // Compare-and-set in one statement: the filter is on the UPDATE itself, not a prior read.
  assert.match(replay, /\.update\(\{ last_totp_step: step \}\)\s*\.eq\("id", adminId\)\s*\.or\(`last_totp_step\.is\.null,last_totp_step\.lt\.\$\{step\}`\)/);
  assert.doesNotMatch(replay, /\.select\("last_totp_step"\)/);
});

test("SA-6.2 unlock route is super-admin-only and audits the mutation", async () => {
  const route = await read("app/api/admin/security/rate-limits/route.ts");
  assert.equal((route.match(/requireAdminRole\(\["super_admin"\]\)/g) ?? []).length, 2);
  assert.match(route, /security\.login_unlocked/);
  assert.match(route, /from\("rate_limits"\)\.delete\(\)/);
});

test("agent and partner logins switch identity planes by clearing the opposite session", async () => {
  const tenantRoute = await read("app/api/app/auth/login/route.ts");
  const partnerRoute = await read("app/api/partner/auth/login/route.ts");

  assert.match(tenantRoute, /response\.cookies\.set\(PARTNER_SESSION_COOKIE,\s*"",\s*\{[^}]*maxAge:\s*0/s);
  assert.match(partnerRoute, /response\.cookies\.set\(TENANT_SESSION_COOKIE,\s*"",\s*\{[^}]*maxAge:\s*0/s);
});
