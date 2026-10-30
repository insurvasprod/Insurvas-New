// LA-8.2 (Notion sprint, Module 8 — Settings) · My profile & security.
// Run with: node --experimental-strip-types --test lib/tenantAuth/security.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { approxLocation, deviceLabel, failedLoginBursts, formatRecoveryCode, normaliseRecoveryCode, PASSWORD_MIN, RECOVERY_ALPHABET, REVEAL_ROLES, requiresTwoFactor } from "./securityRules.ts";
import { TENANT_ROLES } from "./roles.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("supabase/migrations/20261015310000_la_8_2_profile_security.sql");

const REVEALS = {
  "app/api/app/applications/attempts/[id]/reveal/route.ts": ["owner", "producer"],
  "app/api/app/inbound/verification/reveal/route.ts": ["owner", "producer", "assistant"],
  "app/api/app/outbound/application/reveal/route.ts": ["owner", "producer"],
  "app/api/app/agency-profile/tax-id/route.ts": ["owner"],
};

test("two-factor is required for every role that can reveal an SSN or bank details, and optional for the rest", () => {
  // LA-5.8: a retention rep reveals no SSN or bank details either.
  const expected = { owner: true, producer: true, assistant: true, setter: false, bookkeeper: false, retention: false };
  for (const role of TENANT_ROLES) assert.equal(requiresTwoFactor(role), expected[role], role);
  // Read off the reveal routes themselves: every role a reveal admits is in REVEAL_ROLES.
  for (const [file, roles] of Object.entries(REVEALS)) {
    const src = read(file);
    for (const role of roles) assert.ok(src.includes(`"${role}"`), `${file} no longer admits ${role}; update this table`);
    for (const role of roles) assert.ok(REVEAL_ROLES.includes(role), `${role} can reveal on ${file} but two-factor is not required for it`);
  }
  assert.ok(!requiresTwoFactor("setter"), "a setter reveals nothing, so a phone left at home costs no shift");
});

test("a privileged user without two-factor is blocked from revealing, not from the product", () => {
  for (const file of Object.keys(REVEALS)) {
    assert.match(read(file), /const blocked = await secondFactorBlock\(auth\.context\);\n\s+if \(blocked\) return blocked;/, file);
  }
  assert.match(read("app/api/app/accounting/tax/route.ts"), /if \(b\.op === "reveal"\) \{[\s\S]*?secondFactorBlock\(auth\.context\)/, "payee tax IDs too, whoever the agency allows");
  assert.match(read("lib/extension/fields.ts"), /if \(!\(await hasTwoFactor\(ctx\.userId\)\)\) throw new ApplicationError\(TWO_FACTOR_REQUIRED_CODE/, "the extension's one-at-a-time reads too");
  // The block lives on the reveals only: the per-request guard never asks for a second factor.
  assert.doesNotMatch(read("lib/tenantAuth/requireTenant.ts"), /hasTwoFactor|secondFactorBlock/);
  const gate = read("lib/tenantAuth/twoFactor.ts");
  assert.match(gate, /if \(!on\) return NextResponse\.json\(\{ error: TWO_FACTOR_REQUIRED_MESSAGE, code: TWO_FACTOR_REQUIRED_CODE \}, \{ status: 403 \}\);/);
  assert.match(gate, /if \(opts\.session !== false && !context\.twoFactorAt\)/, "and the session itself must have passed the factor");
  // Prompted on next login: the sign-in sends a required role without it to set it up.
  assert.match(read("lib/tenantAuth/completeSignIn.ts"), /!enrolled && requiresTwoFactor\(membership\.role\) \? "\/app\/settings\?two_factor=required#my-profile\/security"/);
});

test("TOTP only, never SMS; a code is accepted once; recovery codes are hashed, shown once, and die when used", () => {
  const tf = read("lib/tenantAuth/twoFactor.ts");
  assert.match(tf, /new OTPAuth\.TOTP\(/);
  assert.doesNotMatch(tf + read("app/api/app/profile/two-factor/route.ts"), /sendSms|twilio|messages\.create|channel: "sms"/i, "no SMS factor is offered");
  assert.match(MIGRATION, /where user_id = p_user_id and \(last_totp_step is null or last_totp_step < p_step\)/, "a step newer than the last accepted, compared and set in one statement");
  assert.match(MIGRATION, /update public\.user_recovery_code set used_at = now\(\)\n\s+where user_id = p_user_id and code_hash = p_code_hash and used_at is null/);
  assert.match(MIGRATION, /code_hash text not null check \(length\(code_hash\) = 64\)/, "a SHA-256 hash, never the code");
  // Returned only by the two calls that make them.
  const route = read("app/api/app/profile/two-factor/route.ts");
  assert.equal((route.match(/recoveryCodes: codes/g) ?? []).length, 2);
  assert.doesNotMatch(read("lib/tenantAuth/twoFactor.ts").slice(read("lib/tenantAuth/twoFactor.ts").indexOf("export async function twoFactorStatus"), read("lib/tenantAuth/twoFactor.ts").indexOf("export async function hasTwoFactor")), /code_hash/, "the status never reads the codes back");
  // The secret is encrypted with the application key, bound to the person.
  assert.match(tf, /encryptSensitive\(secret, scope\(userId\)\)/);
  // Recovery code shape.
  assert.equal(normaliseRecoveryCode(" abcde-fghjk "), "ABCDEFGHJK");
  assert.equal(formatRecoveryCode("ABCDEFGHJK"), "ABCDE-FGHJK");
  assert.doesNotMatch(RECOVERY_ALPHABET, /[01IOL]/, "no look-alike characters");
  // Turning it off, or replacing the codes, needs the factor itself.
  assert.match(route, /Turning it off and replacing the codes both need proof of the factor itself/);
  // …under the sign-in code step's lockout (found on the live walk, 2026-10-15).
  assert.match(route, /const protection = await checkLoginAllowed\("user", email, request, "totp"\);/);
  assert.match(route, /if \(!ok\) \{\n\s+await recordLoginFailure\("user", email, request, "totp"\);/);
});

test("the password step's pending cookie can never act as a session", async () => {
  process.env.TENANT_SESSION_SECRET ||= "test-secret-for-la-8-2-only-0123456789";
  const { signTenantPending2faToken, verifyTenantPending2faToken, verifyTenantSessionToken, signTenantSessionToken } = await import("./session.ts");
  const pending = await signTenantPending2faToken({ sub: "u", tenantId: "t", sessionVersion: 3, redirectTo: "/app/dashboard", remember: false });
  assert.equal(await verifyTenantSessionToken(pending), null, "a pending token is refused as a session");
  // It carries the "Keep me signed in" choice to the code step (2026-10-24).
  assert.deepEqual(await verifyTenantPending2faToken(pending), { sub: "u", tenantId: "t", sessionVersion: 3, redirectTo: "/app/dashboard", remember: false, viaLink: false });
  const session = await signTenantSessionToken("u", "t", 3, "11111111-1111-4111-8111-111111111111");
  assert.equal(await verifyTenantPending2faToken(session), null, "and a session is not a pending token");
  assert.equal((await verifyTenantSessionToken(session))?.sid, "11111111-1111-4111-8111-111111111111");
  const offsite = await signTenantPending2faToken({ sub: "u", tenantId: "t", sessionVersion: 0, redirectTo: "https://evil.example", remember: true });
  assert.equal((await verifyTenantPending2faToken(offsite))?.redirectTo, "/app/dashboard", "the redirect stays inside the app");
});

test("sessions are rows; every request checks its row, so ending one takes effect on its next request", () => {
  const guard = read("lib/tenantAuth/requireTenant.ts");
  assert.match(guard, /session\.sid\n\s+\? checkTenantSession\(session\.sid, session\.sub\)\.catch\(\(\) => \(\{ live: false, twoFactorAt: null \}\)\)/, "store-checked, and a failed check closes the session");
  assert.match(guard, /if \(!live\.live\) return none;/);
  const store = read("lib/tenantAuth/sessionStore.ts");
  assert.match(store, /if \(!data \|\| data\.user_id !== userId \|\| data\.revoked_at\) return \{ live: false, twoFactorAt: null \};/);
  // Every way in makes a row: sign-in, the code step, a workspace switch, and the two signup steps.
  // The legacy /api/app/signup is retired (410, 2026-10-15) and issues nothing.
  // Sign-in's session is issued in completeTenantSignIn, which every agent way in shares.
  for (const file of ["lib/tenantAuth/completeSignIn.ts", "app/api/app/auth/verify-2fa/route.ts", "app/api/app/auth/switch-workspace/route.ts", "app/api/public/signup/route.ts", "app/api/public/signup/verify/route.ts"]) {
    const src = read(file);
    assert.match(src, /issueTenantSession\(/, file);
    assert.doesNotMatch(src, /signTenantSessionToken\(/, `${file} signs a cookie without a row`);
  }
  assert.match(read("app/api/app/auth/logout/route.ts"), /endTenantSessions\(\{ userId: session\.sub, sessionId: session\.sid, reason: "signed_out"/);
  // End one, or all but this one.
  const route = read("app/api/app/profile/sessions/route.ts");
  assert.match(route, /if \(parsed\.data\.id === auth\.context\.sessionId\) return NextResponse\.json\(\{ error: "That is this session: sign out instead\." \}/);
  assert.match(read("lib/users/accountSecurity.ts"), /const ended = await endTenantSessions\(\{ userId: user\.id, except: context\.sessionId \?\? null, reason, by: user\.id \}\);/);
  // Device, rough location, last used.
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), "Safari on iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/127.0"), "Firefox on Mac");
  assert.equal(deviceLabel(null), "Unknown device");
  const h = (o) => ({ get: (n) => o[n] ?? null });
  assert.equal(approxLocation(h({ "x-vercel-ip-city": "San%20Antonio", "x-vercel-ip-country-region": "TX", "x-vercel-ip-country": "US" })), "San Antonio, TX");
  assert.equal(approxLocation(h({ "x-vercel-ip-country": "US" })), "US");
  assert.equal(approxLocation(h({})), null, "no headers, no guess");
  assert.match(MIGRATION, /revoked_reason text check \(revoked_reason is null or revoked_reason in \('signed_out', 'ended_by_user', 'password_changed', 'email_changed', 'two_factor_changed', 'switched_workspace'\)\)/);
});

test("a password change needs the current one, ends every other session and emails the person", () => {
  const src = read("lib/users/accountSecurity.ts");
  const fn = src.slice(src.indexOf("export async function changePassword"), src.indexOf("export async function requestEmailChange"));
  assert.ok(fn.indexOf("checkCurrentPassword(") < fn.indexOf("updateUserById("), "the current password first");
  assert.match(fn, /const result = await endOtherSessions\(context, "password_changed", request\);/);
  assert.match(fn, /sendSecurityNotice\(\{ to: user\.email, name: user\.name, what: "Your password was changed"/);
  assert.match(fn, /if \(next\.length < PASSWORD_MIN\)/);
  assert.equal(PASSWORD_MIN, 12, "length, not complexity rules");
  assert.doesNotMatch(fn, /[A-Z]\]|special character|uppercase/i);
  // A wrong current password counts toward the same lockout as sign-in.
  assert.match(src, /if \(error\) \{\n\s+await recordLoginFailure\("user", email, request\);/);
  // The cookie of the person who changed it continues, at the new session version.
  assert.match(src, /await signTenantSessionToken\(user\.id, context\.tenantId, next, context\.sessionId, carried\)/);
  // The cookie it hands back keeps this browser's "Keep me signed in" choice and expiry (2026-10-24).
  assert.match(src, /const carried = continuedTenantSession\(await getTenantSession\(\)\);/);
});

test("an email change is verified at the new address, both addresses are told, and sign-in follows it", () => {
  const src = read("lib/users/accountSecurity.ts");
  const fn = src.slice(src.indexOf("export async function requestEmailChange"));
  assert.match(fn, /await sendEmailChangeConfirmation\(\{ to: email,/, "the link goes to the new address");
  assert.match(fn, /await sendSecurityNotice\(\{ to: user\.email,/, "the old address is told now");
  assert.doesNotMatch(fn, /from\("users"\)\.update\(\{ email/, "nothing changes until the link is used");
  const confirm = read("app/api/app/auth/confirm-email/route.ts");
  assert.match(confirm, /supabase\.auth\.admin\.updateUserById\(change\.user_id, \{ email: newEmail, email_confirm: true \}\)/, "Supabase Auth's address moves too — before LA-8.2 it did not, and sign-in broke");
  assert.match(confirm, /sendSecurityNotice\(\{ to: newEmail,[\s\S]*?sendSecurityNotice\(\{ to: before\.email,/);
  assert.match(MIGRATION, /if exists \(select 1 from public\.users where lower\(email\) = v_email\) then\n\s+raise exception 'EMAIL_ALREADY_REGISTERED'/);
});

test("the security log: every listed event, the person's own only, append-only and never edited", () => {
  for (const type of ["password_changed", "email_change_requested", "email_changed", "two_factor_enabled", "two_factor_disabled", "session_ended", "other_sessions_ended"]) {
    assert.ok(MIGRATION.includes(`'${type}'`), type);
  }
  assert.match(MIGRATION, /create trigger user_security_event_guard before update or delete on public\.user_security_event/);
  assert.match(MIGRATION, /revoke update, delete, truncate on public\.user_security_event from service_role;/);
  assert.match(read("app/api/app/profile/security-events/route.ts"), /listSecurityEvents\(auth\.context\.userId,/, "ids from the session, never the request");
  // Failed sign-in bursts: three within fifteen minutes; a single typo is not one.
  const t = (m) => new Date(Date.UTC(2026, 9, 15, 10, m)).toISOString();
  const bursts = failedLoginBursts([{ ts: t(0), ip: "1.1.1.1" }, { ts: t(2), ip: "1.1.1.1" }, { ts: t(5), ip: "2.2.2.2" }, { ts: t(50), ip: "3.3.3.3" }]);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].count, 3);
  assert.deepEqual(bursts[0].ips, ["1.1.1.1", "2.2.2.2"]);
  assert.equal(failedLoginBursts([{ ts: t(0), ip: null }]).length, 0);
  assert.match(read("lib/users/securityEvents.ts"), /from\("login_events"\)[\s\S]*?\.eq\("success", false\)/, "read from login_events, not copied");
});

test("the display timezone is personal and display-only; calling windows never read it", () => {
  assert.match(read("lib/users/viewerTimezone.ts"), /return mine \?\? agency;/);
  for (const page of ["applications/page.tsx", "applications/[caseId]/page.tsx", "deal-flow/page.tsx", "campaigns/[campaignId]/page.tsx", "pending/page.tsx", "quoting/page.tsx"]) {
    assert.match(read(`app/app/(shell)/${page}`), /getViewerTimezone\(guard\.context\.tenantId, guard\.context\.userId\)/, page);
  }
  assert.doesNotMatch(read("lib/callingWindow/engine.ts") + read("lib/callingWindow/service.ts"), /display_timezone|getViewerTimezone|getPersonalTimezone/);
  assert.match(read("components/app/own-profile-form.tsx"), /How times show for you only\. Calling hours still follow each customer&apos;s state\./);
});

test("every new route is registered with its gate", () => {
  for (const file of ["password", "email", "two-factor", "sessions", "security-events"]) {
    assert.ok(AGENT_API_POLICIES.some((p) => p.sourceFile === `app/api/app/profile/${file}/route.ts`), file);
    assert.match(read(`app/api/app/profile/${file}/route.ts`), /const auth = await requireTenant\(\);/, `${file}: every role, own account`);
  }
});
