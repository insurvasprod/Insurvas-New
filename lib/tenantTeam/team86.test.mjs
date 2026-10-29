import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { OPEN_WORK_KINDS, REASSIGNED_KINDS, describeOpenWork, reassignableCount } from "./openWork.ts";
import { isSingleSeatPlan, planHiddenSettingsSections } from "./seats.ts";

// LA-8.6 (Notion sprint) acceptance criteria that a test can hold.

const read = (file) => fs.readFileSync(file, "utf8");
const MIGRATION = read("supabase/migrations/20261015350000_la_8_6_team.sql");
const LA86_FILES = [
  "lib/tenantTeam/membership.ts", "lib/tenantTeam/openWork.ts", "components/app/team-member-account.tsx",
  "app/api/app/team/[userId]/deactivate/route.ts", "app/api/app/team/[userId]/reactivate/route.ts", "app/api/app/team/[userId]/timezone/route.ts",
];

test("no permission is defined in LA-8.6: roles resolve to LA-0.2's model", () => {
  for (const file of [...LA86_FILES, "supabase/migrations/20261015350000_la_8_6_team.sql"]) {
    const source = read(file);
    assert.doesNotMatch(source, /ROLE_PERMISSIONS|PERMISSIONS\s*[:=]|hasPermission\(|can_view_commissions|permission_key/, file);
  }
  // The roles a member can be given are LA-0.2's list, read by the existing role picker.
  assert.match(read("components/app/team-settings.tsx"), /TENANT_ROLES\.map\(\(item\) =>/);
});

test("the member's time zone never reaches calling windows", () => {
  for (const file of fs.readdirSync("lib/callingWindow").filter((f) => f.endsWith(".ts"))) {
    assert.doesNotMatch(read(`lib/callingWindow/${file}`), /tenant_users|member(_|\.)?timezone|tenant_member_roster/i, file);
  }
  // The migration changes no calling-window function and no dial check.
  assert.doesNotMatch(MIGRATION, /calling_window|dial_preflight|state_timezones|customer_timezone/);
  // The roster is the one reader: the member's zone before the agency's, after their own working hours.
  assert.match(MIGRATION, /nullif\(btrim\(av\.timezone\), ''\),\s*-- \[8\.6\][^\n]*\n\s*\(select tz\.name from pg_timezone_names tz where tz\.name = nullif\(btrim\(tu\.timezone\), ''\)/);
});

const DEACTIVATE = /create or replace function public\.tenant_deactivate_member[\s\S]*?\n\$\$;/.exec(MIGRATION)[0];

test("deactivation ends sessions on the next request and keeps every record attributed", () => {
  const fn = DEACTIVATE;
  // admin_set_user_status bumps session_version; resolveTenantContext compares it on every request.
  assert.match(fn, /perform public\.admin_set_user_status\(p_user_id, 'inactive', null\)/);
  assert.match(read("lib/tenantAuth/requireTenant.ts"), /session\.sessionVersion !== user\.session_version/);
  assert.match(read("lib/tenantAuth/requireTenant.ts"), /user\.status !== "active"/);
  // Nothing is deleted: no delete statement, and closed rows are not touched (only open statuses move).
  assert.doesNotMatch(fn, /\bdelete\b/i);
  assert.doesNotMatch(fn, /update public\.(save_attempt|policy_current|commission_entry|tenant_issued_policies)/);
  assert.match(fn, /update public\.queue_item[^;]*status = 'open'/);
  assert.match(fn, /update public\.tenant_appointments[^;]*starts_at_utc > now\(\)/);
});

test("open work is surfaced and never left unowned", () => {
  const fn = DEACTIVATE;
  assert.match(fn, /if p_reassign_to is null then\s*raise exception 'open_work:%'/);
  assert.equal(reassignableCount({ queue_items: 14, reinstatement_cases: 0, callbacks: 0, claimed_leads: 0, appointments: 0, servicing_requests: 3 }), 17);
  // LA-8 audit (20261015640000): servicing requests are handed over too — who asked stays, the taker follows them up.
  assert.equal(reassignableCount({ queue_items: 0, reinstatement_cases: 0, callbacks: 0, claimed_leads: 0, appointments: 0, servicing_requests: 3 }), 3);
  assert.ok(REASSIGNED_KINDS.includes("servicing_requests"));
  assert.equal(describeOpenWork({ queue_items: 14, reinstatement_cases: 0, callbacks: 0, claimed_leads: 0, appointments: 0, servicing_requests: 3 }), "14 open exception-queue items and 3 pending servicing requests");
  assert.equal(describeOpenWork(Object.fromEntries(OPEN_WORK_KINDS.map((k) => [k, 0]))), "");
});

test("at the seat limit the invite button is off with its reason and an upgrade link", () => {
  const screen = read("components/app/team-settings.tsx");
  assert.match(screen, /onClick=\{\(\) => setInviteOpen\(true\)\} disabled=\{atSeatLimit\} title=\{atSeatLimit \?/);
  assert.match(screen, /href="\/app\/settings#billing">upgrade the plan<\/Link>/);
  // A pending invitation holds a seat (the one seat rule), and revoking frees it.
  assert.match(read("lib/tenantTeam/seats.ts"), /"invited", "pending_verification"/);
});

test("the section is absent for a plan with one seat", () => {
  assert.equal(isSingleSeatPlan(1), true);
  assert.equal(isSingleSeatPlan(5), false);
  assert.equal(isSingleSeatPlan(null), false);
  assert.deepEqual(planHiddenSettingsSections(1), ["team-access"]);
  assert.deepEqual(planHiddenSettingsSections(5), []);
  // One list for the rail and for search: search never offers a section the page hides.
  // Read by the Settings frame's loader (settings-shell plan, 2026-10-28) and handed to the rail as `hidden`.
  assert.match(read("lib/settings/frameData.ts"), /hidden: planHiddenSettingsSections\(entitlement\.limits\.max_seats\)/);
  assert.match(read("app/app/(shell)/settings/page.tsx"), /hidden=\{frame\.hidden\}/);
  assert.match(read("app/api/app/search/route.ts"), /hiddenSettings: planHiddenSettingsSections\(entitlement\.limits\.max_seats\)/);
  assert.match(read("lib/search/service.ts"), /SETTINGS_SECTIONS\.filter\(\(section\) => !hidden\.includes\(section\.id\)\)/);
  assert.match(read("components/app/agent-settings-tabs.tsx"), /registered\.filter\(\(tab\) => !hidden\.includes\(tab\.id\)\)/);
});

test("the LA-8.6 routes are owner only", () => {
  for (const file of LA86_FILES.filter((f) => f.startsWith("app/"))) {
    const source = read(file);
    const handlers = source.match(/export async function \w+\(/g) ?? [];
    assert.equal((source.match(/requireTenant\(\["owner"\]\)/g) ?? []).length, handlers.length, file);
  }
});

test("LA-8 audit: open work goes only to someone who can work it, servicing requests included", async () => {
  const { canTakeOver } = await import("./openWork.ts");
  const AUDIT = read("supabase/migrations/20261015640000_la_8_audit_team_webhooks.sql");
  const work = { queue_items: 0, reinstatement_cases: 0, callbacks: 2, claimed_leads: 0, appointments: 0, servicing_requests: 1 };
  assert.equal(canTakeOver("producer", work), true);
  assert.equal(canTakeOver("owner", work), true);
  assert.equal(canTakeOver("bookkeeper", work), false);
  assert.equal(canTakeOver("setter", work), false);
  assert.equal(canTakeOver("bookkeeper", { ...work, callbacks: 0, servicing_requests: 0, queue_items: 3 }), true, "a queue item may be an operations one: the database decides per item");
  // The database holds the same rule, per kind and per queue item's own role, and names what it refused.
  assert.match(AUDIT, /if v_target_role not in \('owner', 'producer'\) then/);
  assert.match(AUDIT, /when 'operations' then v_target_role in \('owner', 'bookkeeper'\)/);
  assert.match(AUDIT, /raise exception 'reassign_target_cannot_work:%'/);
  assert.match(AUDIT, /update public\.servicing_request set assigned_to = p_reassign_to/);
  assert.doesNotMatch(AUDIT, /set requested_by|requested_by = p_reassign_to/);
  assert.match(AUDIT, /values \(r\.tenant_id, coalesce\(r\.assigned_to, r\.requested_by\), 'servicing_failed'/);
  assert.match(read("lib/tenantTeam/membership.ts"), /reassign_target_cannot_work:\(\[a-z_,\]\+\)/);
  assert.match(read("components/app/team-member-account.tsx"), /canTakeOver\(m\.role, openWork\)/);
});
