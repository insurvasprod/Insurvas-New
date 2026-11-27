// Run with: npm test
//
// The phone app's partner sign-in (2026-11-25). A partner signs in on the same app as agents, so the
// tokens the app holds must keep the two planes apart as firmly as the browser cookies do:
//   · a partner app token is never a tenant session, and a tenant app token is never a partner session;
//   · a partner app token is read only from a Bearer header, and a web cookie token never from one;
//   · the refresh token is never a session, and a session token is never a refresh token;
//   · the refresh token carries the session version and a fixed 30-day end.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PARTNER_SESSION_SECRET ||= "test-partner-secret";
process.env.TENANT_SESSION_SECRET ||= "test-tenant-secret";

const partner = await import("./session.ts");
const tenant = await import("../tenantAuth/session.ts");

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("a partner app token carries the app mark and verifies on the partner plane", async () => {
  const token = await partner.signPartnerSessionToken("u", "t", "p", 4, { client: partner.PARTNER_APP_CLIENT });
  const session = await partner.verifyPartnerSessionToken(token);
  assert.equal(session?.cli, "app");
  assert.equal(session?.sessionVersion, 4);
  assert.equal(session?.partnerId, "p");
});

test("a partner app token is never a tenant session, and a tenant app token is never a partner session", async () => {
  const partnerApp = await partner.signPartnerSessionToken("u", "t", "p", 0, { client: partner.PARTNER_APP_CLIENT });
  const tenantApp = await tenant.signTenantSessionToken("u", "t", 0, "sid", { client: tenant.APP_CLIENT });
  assert.equal(await tenant.verifyTenantSessionToken(partnerApp), null);
  assert.equal(await partner.verifyPartnerSessionToken(tenantApp), null);
  // Nor either refresh token on the other plane.
  const partnerRefresh = await partner.signPartnerAppRefreshToken({ sub: "u", tenantId: "t", partnerId: "p", sessionVersion: 0 });
  const tenantRefresh = await tenant.signTenantAppRefreshToken({ sub: "u", tenantId: "t", sessionVersion: 0, sid: "sid" });
  assert.equal(await tenant.verifyTenantAppRefreshToken(partnerRefresh), null);
  assert.equal(await partner.verifyPartnerAppRefreshToken(tenantRefresh), null);
});

test("the key stays distinct even when only the tenant secret is set", async () => {
  const saved = process.env.PARTNER_SESSION_SECRET;
  delete process.env.PARTNER_SESSION_SECRET;
  try {
    const partnerApp = await partner.signPartnerSessionToken("u", "t", "p", 0, { client: partner.PARTNER_APP_CLIENT });
    assert.equal(await tenant.verifyTenantSessionToken(partnerApp), null);
    assert.ok(await partner.verifyPartnerSessionToken(partnerApp));
  } finally {
    process.env.PARTNER_SESSION_SECRET = saved;
  }
});

test("a cookie never carries an app token, and a Bearer header only carries one", () => {
  const web = { cli: undefined };
  const app = { cli: "app" };
  assert.equal(partner.partnerSessionCarriedRightly(web, "cookie"), true);
  assert.equal(partner.partnerSessionCarriedRightly(app, "cookie"), false);
  assert.equal(partner.partnerSessionCarriedRightly(app, "bearer"), true);
  assert.equal(partner.partnerSessionCarriedRightly(web, "bearer"), false);
  assert.equal(partner.partnerSessionCarriedRightly(null, "bearer"), false);
});

test("an unknown client mark is not a session at all", async () => {
  const { SignJWT } = await import("jose");
  const forged = await new SignJWT({ tenantId: "t", partnerId: "p", sessionVersion: 0, cli: "cli" })
    .setProtectedHeader({ alg: "HS256" }).setSubject("u").setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.PARTNER_SESSION_SECRET));
  assert.equal(await partner.verifyPartnerSessionToken(forged), null);
});

test("the refresh token is never a session, and a session token is never a refresh token", async () => {
  const refresh = await partner.signPartnerAppRefreshToken({ sub: "u", tenantId: "t", partnerId: "p", sessionVersion: 2 });
  assert.equal(await partner.verifyPartnerSessionToken(refresh), null);
  const session = await partner.signPartnerSessionToken("u", "t", "p", 2, { client: partner.PARTNER_APP_CLIENT });
  assert.equal(await partner.verifyPartnerAppRefreshToken(session), null);
  const claim = await partner.verifyPartnerAppRefreshToken(refresh);
  assert.deepEqual({ ...claim, exp: undefined }, { sub: "u", tenantId: "t", partnerId: "p", sessionVersion: 2, exp: undefined });
});

test("the refresh token ends 30 days after sign-in", async () => {
  const before = Math.floor(Date.now() / 1000);
  const claim = await partner.verifyPartnerAppRefreshToken(await partner.signPartnerAppRefreshToken({ sub: "u", tenantId: "t", partnerId: "p", sessionVersion: 0 }));
  const days = ((claim?.exp ?? 0) - before) / 86_400;
  assert.ok(days > 29.99 && days <= 30.01, `refresh lives ${days} days`);
  assert.equal(partner.PARTNER_APP_REFRESH_DAYS, 30);
  assert.equal(partner.PARTNER_APP_SESSION_SECONDS, 12 * 60 * 60);
});

test("an expired refresh token is refused", async () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  const refresh = await partner.signPartnerAppRefreshToken({ sub: "u", tenantId: "t", partnerId: "p", sessionVersion: 0, exp: past });
  assert.equal(await partner.verifyPartnerAppRefreshToken(refresh), null);
});

test("the refresh route never issues past the refresh token's end and checks the session version", () => {
  const source = read("app/api/partner/auth/mobile/refresh/route.ts");
  assert.match(source, /Math\.min\(now \+ PARTNER_APP_SESSION_SECONDS, claim\.exp/);
  assert.match(source, /user\.session_version !== claim\.sessionVersion/);
  assert.match(source, /user\.status !== "active"/);
  assert.match(source, /verifyPartnerAppRefreshToken/);
  // It issues only app tokens.
  assert.match(source, /client: PARTNER_APP_CLIENT/);
});

test("the sign-in route runs the portal's own sign-in with every cookie dropped", () => {
  const source = read("app/api/partner/auth/mobile/login/route.ts");
  assert.match(source, /import \{ POST as webLogin \} from "\.\.\/\.\.\/login\/route"/);
  assert.match(source, /requestWithCookies\(request, \{\}, body\)/);
  const helper = read("lib/partnerAuth/appSession.ts");
  // Only the partner cookie is converted, and only a browser-shaped one.
  assert.match(helper, /web\.cookies\.get\(PARTNER_SESSION_COOKIE\)/);
  assert.match(helper, /web\.cli !== undefined/);
  assert.doesNotMatch(helper, /response\.cookies\.set/);
});

test("requirePartner reads a Bearer header only after the cookie, and only an app token from it", () => {
  const source = read("lib/partnerAuth/requirePartner.ts");
  assert.match(source, /partnerSessionCarriedRightly\(session, "cookie"\)/);
  assert.match(source, /partnerSessionCarriedRightly\(session, "bearer"\)/);
  const cookieAt = source.indexOf('partnerSessionCarriedRightly(session, "cookie")');
  const bearerAt = source.indexOf('partnerSessionCarriedRightly(session, "bearer")');
  assert.ok(cookieAt > 0 && bearerAt > cookieAt);
  // The tenant plane never verifies with the partner key.
  assert.doesNotMatch(read("lib/tenantAuth/requireTenant.ts"), /verifyPartnerSessionToken/);
});
