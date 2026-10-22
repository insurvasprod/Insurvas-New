import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { accessSummary, actingRole, EXTRA_ROLES, holdsAnyRole, isHiddenPath, memberRoles } from "./teamAccess.ts";
import { buildAgentMenu } from "../menu/definition.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const MIGRATION = read("supabase/migrations/20261020500000_team_access_extra_roles.sql");
const keys = (menu) => menu.flatMap((section) => section.items.map((item) => item.key));

test("extra roles count only with the add-on, never for the owner, never twice, main role first", () => {
  assert.deepEqual(memberRoles("producer", ["bookkeeper"], false), ["producer"]);
  assert.deepEqual(memberRoles("producer", ["setter", "bookkeeper", "producer"], true), ["producer", "bookkeeper", "setter"]);
  assert.deepEqual(memberRoles("owner", ["bookkeeper"], true), ["owner"]);
  assert.deepEqual(memberRoles("assistant", ["owner", "nonsense"], true), ["assistant"], "owner is never an extra role");
  assert.deepEqual([...EXTRA_ROLES].sort(), ["assistant", "bookkeeper", "producer", "retention", "setter"]);
});

test("a gate acts as the main role when it may, else the widest extra it allows, else refuses", () => {
  assert.equal(actingRole(["assistant", "producer"], ["owner", "producer", "assistant"]), "assistant", "the main role wins where both may act");
  assert.equal(actingRole(["assistant", "bookkeeper", "producer"], ["owner", "producer", "bookkeeper"]), "producer");
  assert.equal(actingRole(["setter", "retention", "assistant"], ["owner", "assistant", "retention"]), "retention");
  assert.equal(actingRole(["setter"], ["owner", "producer"]), null);
  assert.equal(actingRole(["producer"], ["producer"]), "producer");
  assert.equal(holdsAnyRole(["assistant", "bookkeeper"], ["owner", "bookkeeper"]), true);
});

test("the database picks the same acting role in the same order as the app", () => {
  const sql = MIGRATION.match(/array_position\(array\[([^\]]+)\]/);
  assert.ok(sql, "tenant_member_acting_role orders the extras");
  const order = [...sql[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(order, ["producer", "bookkeeper", "retention", "assistant", "setter"]);
  const ts = read("lib/tenantAuth/teamAccess.ts").match(/const WIDTH[^=]*=\s*\[([^\]]+)\]/);
  assert.deepEqual([...ts[1].matchAll(/"(\w+)"/g)].map((m) => m[1]), order);
});

test("a combination sees the widest of its roles, and money is named", () => {
  assert.deepEqual(accessSummary(["producer", "bookkeeper"]), { money: "all", rows: "everyone in the agency" });
  assert.deepEqual(accessSummary(["assistant"]), { money: "none", rows: "the producers they are assigned to" });
  assert.deepEqual(accessSummary(["assistant", "setter"]), { money: "none", rows: "their own, the producers they are assigned to" });
  assert.deepEqual(accessSummary(["producer"], true), { money: "own", rows: "their own, their reports'" });
});

test("hidden paths cover the page and everything under it, nothing else", () => {
  assert.equal(isHiddenPath("/app/ledger", ["/app/ledger"]), true);
  assert.equal(isHiddenPath("/app/ledger/statements", ["/app/ledger"]), true);
  assert.equal(isHiddenPath("/app/ledger-archive", ["/app/ledger"]), false);
  assert.equal(isHiddenPath(null, ["/app/ledger"]), false);
});

test("the menu opens the union of roles, minus hidden pages, and never hides Settings", () => {
  const all = ["book_of_business", "profit_and_loss", "outbound_dialing", "commission_ledger"];
  const assistant = keys(buildAgentMenu(all, "assistant"));
  const withBooks = keys(buildAgentMenu(all, "assistant", { extraRoles: ["bookkeeper"] }));
  assert.ok(!assistant.includes("accounting.pnl") && withBooks.includes("accounting.pnl"), "the bookkeeper role opens P&L");
  const hidden = keys(buildAgentMenu(all, "assistant", { extraRoles: ["bookkeeper"], hiddenPages: ["accounting.pnl", "settings.root"] }));
  assert.ok(!hidden.includes("accounting.pnl"), "a hidden page leaves the menu");
  assert.ok(hidden.includes("settings.root"), "Settings is never hidden");
});

test("every page role gate goes through actAsPage, so any role the member holds opens it", () => {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "page.tsx") files.push(path);
    }
  })(new URL("../../app/app", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const old = files.filter((file) => {
    const text = readFileSync(file, "utf8");
    return /if \(!\s*\[[^\]]*\]\.includes\(guard\.role\)/.test(text) || /if \(guard\.role !== "(producer|assistant|bookkeeper|setter|retention)"/.test(text);
  });
  assert.deepEqual(old, [], "these pages still gate on the main role alone");
});

test("the shared gates act as an allowed role; the page guard honours hidden pages", () => {
  assert.match(read("lib/tenantAuth/requireTenant.ts"), /const acting = actAs\(context, allowedRoles\);/);
  assert.match(read("lib/tenantAuth/requireFeatureRole.ts"), /const acting = actAs\(auth\.context, allowedRoles\);/);
  const guard = read("lib/entitlements/guardPage.ts");
  assert.match(guard, /if \(await pageHiddenFor\(context\)\)/);
  assert.match(read("proxy.ts"), /headers\.set\(APP_PATH_HEADER, pathname\)/, "the path header is set by the proxy, overwriting any sent by the client");
});

test("the migration patches every gate it promises and keeps the columns writable only by its function", () => {
  for (const fn of ["accept_buffer_handoff", "offer_buffer_handoff", "assign_lead_core", "assignment_preview", "lead_list_assignment_run",
    "publish_assignment_rules", "return_lead_to_assignment_pool", "claim_transfer_lead", "end_buffer_involvement", "return_transfer_to_queue",
    "rebook_appointment", "reschedule_appointment", "mark_appointment_outcome", "start_application_from_lead", "reactivate_nurture",
    "recycle_batch_claim_chunk", "agent_may_work_state", "agency_visible_user_ids", "callback_actor_may_manage",
    "enforce_callback_assignee_role", "reopen_expired_lead"]) {
    assert.match(MIGRATION, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `${fn} is redefined`);
  }
  assert.match(MIGRATION, /revoke insert \(extra_roles, hidden_pages\), update \(extra_roles, hidden_pages\) on public\.tenant_users/);
  assert.match(MIGRATION, /if v_role = 'owner' and v_title is null then\s+raise exception using errcode = '42501', message = 'TEAM_ACCESS_BILLING_OWNER'/);
  assert.match(MIGRATION, /if p_actor = p_user_id then\s+raise exception using errcode = '42501', message = 'TEAM_ACCESS_NOT_SELF'/);
  assert.match(MIGRATION, /if v_roles && array\['owner', 'bookkeeper', 'retention'\] then return null; end if;/, "visibility takes the widest role");
});
