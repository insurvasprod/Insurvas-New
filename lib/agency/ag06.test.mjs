// AG-0.6 · seat bands, invitations, and the accept flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { AGENCY_INVITE_TTL_MS, bandBlock, dollars } from "./constants.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const sql = readFileSync(join(ROOT, "supabase/migrations/20261018140000_ag_0_6_seat_bands_and_invites.sql"), "utf8");

test("a full band blocks the invite and names the band it needs and its price", () => {
  const blocked = bandBlock(50, 50);
  assert.equal(blocked.code, "band_full");
  assert.equal(blocked.neededBand, "to_150");
  assert.equal(blocked.neededPriceCents, 249_900);
  assert.match(blocked.error, /All 50 seats in your 1–50 seats band are in use\. The 51–150 seats band is \$2,499 a month\./);
  assert.equal(blocked.upgrade, true);
  assert.equal(bandBlock(150, 150).neededBand, "over_150");
  assert.equal(dollars(499_900), "$4,999");
  assert.equal(dollars(-72_000), "−$720");
});

test("an expired or used invite link cannot be accepted", () => {
  assert.match(sql, /i\.accepted_at is null and i\.expires_at > now\(\)/);
  assert.match(sql, /PASSWORD_TOKEN_INVALID_OR_EXPIRED/);
  assert.equal(AGENCY_INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test("seats count accepted, working people — assistants and other non-producers included; invited and offboarded hold none", () => {
  // The live definition (AG-0.7 replaced AG-0.6's): a member with NO producer row counts as working, so an assistant,
  // a bookkeeper or a setter uses a seat inside the band (module doc §6).
  const live = readFileSync(join(ROOT, "supabase/migrations/20261018150000_ag_0_7_suspend_and_offboard.sql"), "utf8");
  assert.match(live, /left join public\.producer p on p\.tenant_id = tu\.tenant_id and p\.user_id = tu\.user_id/);
  assert.match(live, /coalesce\(p\.status, 'active'\) in \('onboarding', 'active', 'suspended'\)/);
  assert.match(sql, /tu\.accepted_at is not null/);
  assert.match(sql, /coalesce\(p\.status, 'active'\) in \('onboarding', 'active', 'suspended'\)/);
  // the individual one-seat rule is untouched, and the migration proves it against live data
  assert.match(sql, /public\.user_status_holds_seat\(u\.status::text\)/);
  assert.match(sql, /the individual seat count changed/);
});

test("an email already in this tenant is rejected; one in another tenant is invited", () => {
  assert.match(sql, /m\.tenant_id = p_tenant_id and m\.user_id = p_user_id\) then\s+raise exception 'email_exists'/);
  assert.match(sql, /if p_existing then/);
});

test("the producer row exists from the moment of the invite", () => {
  assert.match(sql, /values \(p_tenant_id, v_agency, p_user_id, btrim\(p_name\), 'invited'\)/);
  assert.match(sql, /set status = 'onboarding'/);
});

test("LA-8.6 is extended, not duplicated: exactly one invite flow in the codebase", () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const callers = walk(join(ROOT, "app/api/app")).filter((f) => /inviteAgencyMember\(|tenant_invite_user_with_auth/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  assert.deepEqual(callers, ["app/api/app/team/route.ts"]);
});
