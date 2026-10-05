// Run with: npm test
//
// One account, one portal (2026-09-28). A partner admin signed in through the agent sign-in and
// landed on /app/dashboard with the agency's data, because six partner accounts also held a
// tenant_users row. These assertions pin the four places the rule is enforced, so removing any one
// of them is a failing test rather than a quiet reopening of the hole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("the agent per-request guard closes the session of a partner account", () => {
  const src = read("lib/tenantAuth/requireTenant.ts");
  assert.match(src, /holdsPartnerMembership\(session\.sub\)/, "requireTenant reads partner membership for the session's user");
  assert.match(src, /if \(isPartnerAccount\) return none;/, "and refuses before any membership is honoured");
});

test("the partner per-request guard closes the session of an agency account", () => {
  const src = read("lib/partnerAuth/requirePartner.ts");
  assert.match(src, /holdsAgencyMembership\(session\.sub\)/);
  assert.match(src, /if \(isAgencyAccount\) return null;/);
});

test("each sign-in refuses the other portal's accounts before issuing a session", () => {
  const agent = read("app/api/app/auth/login/route.ts");
  const refuse = agent.indexOf("if (isPartnerAccount)");
  assert.ok(refuse > 0, "agent sign-in checks for a partner account");
  assert.ok(refuse < agent.indexOf("signTenantSessionToken("), "before the agent session is signed");

  const partner = read("app/api/partner/auth/login/route.ts");
  const refusePartner = partner.indexOf("holdsAgencyMembership(user.id)");
  assert.ok(refusePartner > 0, "partner sign-in checks for an agency account");
  assert.ok(refusePartner < partner.indexOf("signPartnerSessionToken("), "before the partner session is signed");
});

test("accepting a partner invite refuses an agency account before the invite is consumed", () => {
  const src = read("app/api/partner/auth/accept-invite/route.ts");
  const refuse = src.indexOf("holdsAgencyMembership(account.id)");
  assert.ok(refuse > 0, "accept-invite checks for an agency account");
  assert.ok(refuse < src.indexOf("consume_existing_partner_invite"), "before the invite is used up");
  assert.ok(refuse < src.indexOf("signPartnerSessionToken("), "and before a partner session is signed");
});

test("a partner invite never attaches an agency account", () => {
  const src = read("lib/partnerUsers/service.ts");
  assert.match(src, /existing && await holdsAgencyMembership\(existing\.id\)/);
  for (const route of ["app/api/app/partners/[id]/users/route.ts", "app/api/partner/users/route.ts"]) {
    assert.match(read(route), /agency_account/, `${route} maps the refusal to a clear 409`);
  }
});

test("a failed membership read closes the door rather than opening it", () => {
  const src = read("lib/auth/planeSeparation.ts");
  assert.equal((src.match(/return Boolean\(error\) \|\|/g) ?? []).length, 2, "both checks treat a read error as 'belongs to the other plane'");
});
