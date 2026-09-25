import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePartnerLimitError, partnerLimitBody, partnerLimitMessage, partnerLimitName } from "./copy.ts";
import { atLimitUserRefusalRetry, atPartnerCap, draftCompensatedLimit } from "./rules.ts";

test("LA-1.19-4: the upgrade prompt names the limit in words, never the raw key", () => {
  const message = partnerLimitMessage("max_publishers", 10, 10, "resume");
  assert.equal(message, "Your plan allows 10 active publishers and 10 are active. Upgrade your plan to resume this publisher, or pause another publisher first.");
  assert.doesNotMatch(message, /max_/);
  assert.equal(partnerLimitName("max_marketing_partners", 1), "active marketing partner");
  assert.match(partnerLimitMessage("max_affiliates", 6, 5, "add"), /allows 5 active affiliates and 6 are active, over the limit/);
  assert.match(partnerLimitMessage("max_partner_users", 42, 40, "resume"), /allows 40 active partner users, and resuming this partner would make it 42/);
  assert.equal(partnerLimitMessage("max_publishers", 0, 0, "add"), "Your plan does not include publishers. Upgrade your plan to use them.");
});

test("LA-1.19-5: both database refusals parse, so both become a 403 with the limit in words", () => {
  assert.deepEqual(parsePartnerLimitError("partner_limit_reached:max_publishers:10:10"), { key: "max_publishers", used: 10, limit: 10 });
  assert.deepEqual(parsePartnerLimitError("Could not transition: partner_user_limit_reached:max_partner_users:41:40"), { key: "max_partner_users", used: 41, limit: 40 });
  assert.equal(parsePartnerLimitError("invalid_partner_transition:draft:paused"), null);
  const body = partnerLimitBody("max_partner_users", 41, 40, "activate");
  assert.equal(body.code, "limit_reached");
  assert.equal(body.limitName, "active partner users");
  assert.equal(body.upgrade, true);
});

test("LA-1.19-2: only active partners hold a slot, and the pre-migration draft count is compensated exactly", () => {
  assert.equal(atPartnerCap(9, 10), false);
  assert.equal(atPartnerCap(10, 10), true);
  assert.equal(atPartnerCap(50, null), false);
  // Old body counted 6 active + 5 drafts = 11 against 10. Raising the limit by the 5 drafts makes
  // its check (11 >= 15) the active-only one (6 >= 10).
  assert.equal(draftCompensatedLimit(11, 6, 10), 15);
  assert.equal(draftCompensatedLimit(6, 6, 10), null, "migrated body: its count is the active count, no retry");
  assert.equal(atLimitUserRefusalRetry(40, 40), 41);
  assert.equal(atLimitUserRefusalRetry(41, 40), null, "over the limit is a real refusal");
});

test("W6.2: the routes and the page all use the active-only count", async () => {
  const list = await readFile(new URL("../../app/api/app/partners/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(list, /status === "draft" \|\| status === "active"/);
  assert.match(list, /p\.status === "active"/);
  const page = await readFile(new URL("../../components/app/partners-workspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /drafts count/);
  assert.doesNotMatch(page, /<code>\{selectedLimitKey\}<\/code>/);
  const migration = await readFile(new URL("../../supabase/migrations/20260925709950_partner_limits_count_active_partners_only.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration.split("-- ── assertions")[0].replace(/^--.*$/gm, ""), /status in \('draft', 'active'\)/);
});
