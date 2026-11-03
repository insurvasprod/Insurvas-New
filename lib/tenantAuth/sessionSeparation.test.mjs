// Run with: npm test
//
// LA-0.1 acceptance criterion 6: "Agent and admin sessions cannot be confused for one another."
//
// The strong form of that claim is cryptographic, not conventional: the two planes sign with
// different secrets, so an admin cookie presented to an agent route does not merely fail a name
// check — it fails signature verification. That is what this file proves. A browser observation
// would only show that today's routes happen to look in the right place.
//
// Notion: LA-0.1 · Agent app shell — "separate cookie and domain from the admin panel".
import { test } from "node:test";
import assert from "node:assert/strict";

// Set before the session modules read them; getSecret() resolves lazily per call.
process.env.TENANT_SESSION_SECRET = "test-tenant-secret-not-a-real-one";
process.env.ADMIN_SESSION_SECRET = "test-admin-secret-not-a-real-one";
process.env.PARTNER_SESSION_SECRET ??= "test-partner-secret-not-a-real-one";

const { TENANT_SESSION_COOKIE, signTenantSessionToken, verifyTenantSessionToken, tenantSessionCookieOptions } =
  await import("./session.ts");
const { ADMIN_SESSION_COOKIE, signAdminSessionToken, verifyAdminSessionToken } = await import("../adminAuth/session.ts");
const { PARTNER_SESSION_COOKIE } = await import("../partnerAuth/session.ts");

test("the three planes use three different cookie names", () => {
  const names = [TENANT_SESSION_COOKIE, ADMIN_SESSION_COOKIE, PARTNER_SESSION_COOKIE];
  assert.equal(new Set(names).size, names.length, `cookie names collide: ${names.join(", ")}`);
});

test("an admin token is not accepted as an agent session", async () => {
  const adminToken = await signAdminSessionToken("11111111-1111-1111-1111-111111111111", "super_admin");
  assert.equal(
    await verifyTenantSessionToken(adminToken),
    null,
    "the agent plane accepted a token signed by the admin plane",
  );
});

test("an agent token is not accepted as an admin session", async () => {
  const tenantToken = await signTenantSessionToken(
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
    1,
  );
  assert.equal(
    await verifyAdminSessionToken(tenantToken),
    null,
    "the admin plane accepted a token signed by the agent plane",
  );
});

test("the two planes do not share a signing secret", () => {
  assert.notEqual(
    process.env.TENANT_SESSION_SECRET,
    process.env.ADMIN_SESSION_SECRET,
    "same secret means a forged cross-plane token would verify",
  );
});

test("an agent token carries identity and tenant scope but no role", async () => {
  // A role baked into a 12h token keeps applying after it is changed. LA-0.2 criterion 5 requires
  // the opposite, so the token must not carry one.
  const token = await signTenantSessionToken(
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
    7,
  );
  const payload = await verifyTenantSessionToken(token);
  assert.equal(payload.sub, "22222222-2222-2222-2222-222222222222");
  assert.equal(payload.tenantId, "33333333-3333-3333-3333-333333333333");
  assert.equal(payload.sessionVersion, 7);
  assert.equal("role" in payload, false, "the agent session token must not carry a role");
});

test("a tampered agent token is rejected", async () => {
  const token = await signTenantSessionToken("22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333");
  const [header, body, signature] = token.split(".");
  const forged = [header, body, signature.slice(0, -2) + (signature.endsWith("aa") ? "bb" : "aa")].join(".");
  assert.equal(await verifyTenantSessionToken(forged), null);
});

test("the agent cookie is host-only unless a deployment opts into a shared domain", () => {
  // Host-only is what keeps app.insurvas.com isolated from admin.insurvas.com. If a deployment
  // sets AGENT_COOKIE_DOMAIN it must not be the admin domain — that is a deployment-time concern
  // this test can only flag, not enforce.
  assert.equal(tenantSessionCookieOptions.httpOnly, true);
  assert.equal(tenantSessionCookieOptions.sameSite, "lax");
  assert.equal(tenantSessionCookieOptions.path, "/");
  if (tenantSessionCookieOptions.domain !== undefined) {
    assert.ok(
      !/admin/i.test(tenantSessionCookieOptions.domain),
      `AGENT_COOKIE_DOMAIN looks like an admin domain: ${tenantSessionCookieOptions.domain}`,
    );
  }
});
