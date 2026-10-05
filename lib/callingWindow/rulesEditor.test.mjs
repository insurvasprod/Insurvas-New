// Run with: npm test
//
// LA-2.4-2 / LA-2.4-3 (20260929201000, user decision 2026-09-29): super admins maintain state
// calling hours, Sunday rules and holidays, each with an effective date and an audit trail, and a
// state rule that bars holidays bars the federal calendar too. The platform enters no legal data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canDialNow } from "./engine.ts";
import { stateRuleMinutes, effectiveMinutes } from "./engine.ts";
import {
  addHolidaySchema,
  boardSummary,
  buildStateBoard,
  callingRuleErrorMessage,
  daysLabel,
  effectiveDateProblem,
  isFederalPlaceholder,
  publishRuleSchema,
  versionOn,
} from "./rulesModel.ts";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const migration = read("supabase", "migrations", "20260929201000_state_calling_rules_editor.sql");

const version = (over) => ({
  id: over.id ?? `${over.state}-${over.effectiveFrom}`,
  state: over.state,
  effectiveFrom: over.effectiveFrom,
  effectiveTo: over.effectiveTo ?? null,
  startLocal: over.startLocal ?? "08:00",
  endLocal: over.endLocal ?? "21:00",
  allowedWeekdays: over.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
  sundayStartLocal: over.sundayStartLocal ?? null,
  sundayEndLocal: over.sundayEndLocal ?? null,
  blockHolidays: over.blockHolidays ?? true,
  source: over.source ?? "platform_federal_default",
  notes: null,
  createdAt: null,
});

const TODAY = "2026-09-29";

test("the board says which states have no state rule yet", () => {
  const states = [{ state: "FL", timezone: "America/New_York" }, { state: "TX", timezone: "America/Chicago" }, { state: "NV", timezone: "America/Los_Angeles" }];
  const versions = [
    version({ state: "FL", effectiveFrom: "2026-09-08", endLocal: "20:00", allowedWeekdays: [1, 2, 3, 4, 5, 6], source: "Fla. Stat. 501.616(6)" }),
    // The seed's federal placeholder is not a state rule.
    version({ state: "TX", effectiveFrom: "2026-09-08" }),
    version({ state: "TX", effectiveFrom: "2026-11-01", startLocal: "09:00", sundayStartLocal: "12:00", sundayEndLocal: "21:00", source: "Reviewer's citation" }),
  ];
  const board = buildStateBoard(states, versions, TODAY);
  const by = Object.fromEntries(board.map((row) => [row.state, row]));
  assert.equal(by.FL.hasStateRule, true);
  assert.equal(by.TX.hasStateRule, false, "a federal placeholder row counts as no state rule");
  assert.equal(by.TX.scheduled.length, 1);
  assert.equal(by.NV.hasStateRule, false, "a state with no row at all has no state rule");
  assert.equal(by.NV.inForce, null);
  assert.deepEqual(boardSummary(board, [], TODAY), { states: 3, withRule: 1, withoutRule: 2, scheduled: 1, upcomingHolidays: 0 });
  assert.equal(isFederalPlaceholder(versions[1]), true);
  assert.equal(isFederalPlaceholder(versions[0]), false);
});

test("the version in force is the latest that has started and not ended, as the SQL picks it", () => {
  const versions = [
    version({ state: "NY", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-01" }),
    version({ state: "NY", effectiveFrom: "2026-10-01", endLocal: "20:00", source: "x" }),
  ];
  assert.equal(versionOn(versions, "2026-09-30").effectiveFrom, "2026-01-01");
  assert.equal(versionOn(versions, "2026-10-01").effectiveFrom, "2026-10-01");
  assert.equal(versionOn(versions, "2025-12-31"), null);
  assert.match(migration, /select distinct on \(r\.state_code\)/);
  assert.match(migration, /order by r\.state_code, r\.effective_from desc;/);
});

test("a published rule may only narrow the federal window, and names its source", () => {
  const ok = {
    state: "tx", effectiveFrom: "2026-11-01", startLocal: "09:00", endLocal: "21:00", allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    sundayStartLocal: "12:00", sundayEndLocal: "21:00", blockHolidays: true, source: "Cited by the reviewer", notes: null,
  };
  const parsed = publishRuleSchema.safeParse(ok);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.state, "TX");
  const refuse = (patch, pattern) => {
    const result = publishRuleSchema.safeParse({ ...ok, ...patch });
    assert.equal(result.success, false, JSON.stringify(patch));
    assert.match(result.error.issues[0].message, pattern);
  };
  refuse({ startLocal: "07:00" }, /inside the federal/);
  refuse({ endLocal: "21:30" }, /inside the federal/);
  refuse({ startLocal: "20:00", endLocal: "19:00" }, /end after it starts/);
  refuse({ sundayEndLocal: null }, /both a start and an end/);
  refuse({ allowedWeekdays: [1, 2, 3, 4, 5, 6] }, /only apply when Sunday calls are allowed/);
  refuse({ source: "" }, /statute or source/);
  refuse({ allowedWeekdays: [] }, /at least one day/);
  assert.match(effectiveDateProblem("2026-09-28", TODAY), /past/);
  assert.equal(effectiveDateProblem(TODAY, TODAY), null);
  assert.equal(addHolidaySchema.safeParse({ state: null, date: "2026-11-26", name: "Thanksgiving Day" }).success, true);
  assert.equal(addHolidaySchema.safeParse({ state: "IN", date: "2026-11-27", name: "" }).success, false);
  assert.equal(daysLabel([1, 2, 3, 4, 5, 6]), "Mon–Sat");
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.match(callingRuleErrorMessage("ERROR: CALLING_RULE_IN_FORCE"), /cannot be withdrawn/);
});

test("the engine applies a state's Sunday window and its minutes, as the SQL does", () => {
  const timezones = { TX: "America/Chicago" };
  const stateRules = { TX: { state: "TX", window: { startHour: 9, endHour: 21 }, sundayWindow: { startHour: 12, endHour: 21 } } };
  // Sunday 4 Oct 2026, 10:00 and 13:00 in Chicago (UTC-5).
  assert.equal(canDialNow({ state: "TX", at: new Date("2026-10-04T15:00:00Z"), timezones, stateRules }).allowed, false);
  assert.equal(canDialNow({ state: "TX", at: new Date("2026-10-04T18:00:00Z"), timezones, stateRules }).allowed, true);
  // Monday 08:30 is before a 09:00 state start.
  assert.equal(canDialNow({ state: "TX", at: new Date("2026-10-05T13:30:00Z"), timezones, stateRules }).allowed, false);
  // A holiday rule reads the federal calendar ("*") as well as the state's own dates.
  const holidays = new Set(["*:2026-11-26"]);
  assert.equal(canDialNow({ state: "TX", at: new Date("2026-11-26T18:00:00Z"), timezones, stateRules: { TX: { state: "TX", noHolidays: true } }, holidays }).reason, "holiday");

  const rule = { state: "TX", startHour: 9, endHour: 20, noSunday: false, noHolidays: true, startMinute: 510, endMinute: 1230, sundayStartMinute: 720, sundayEndMinute: 1260 };
  assert.deepEqual(stateRuleMinutes(rule), { start: 510, end: 1230 });
  assert.deepEqual(stateRuleMinutes(rule, 0), { start: 720, end: 1260 });
  assert.deepEqual(effectiveMinutes(rule, null, null), { start: 510, end: 1230 });
  // Before 20260929201000 there are no minutes, and the hours stand.
  assert.deepEqual(stateRuleMinutes({ state: "FL", startHour: 8, endHour: 20, noSunday: true, noHolidays: true }), { start: 480, end: 1200 });
});

test("the migration fixes the federal holiday gap, keeps tighter-only, and enters no legal data", () => {
  // The seed is not touched: no update or insert of real rows outside the rolled-back probe.
  // Function bodies (the editor's writers) are left out: they run only when a super admin publishes.
  const outsideProbe = migration.slice(0, migration.indexOf("-- ── assertions")).replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.doesNotMatch(outsideProbe, /^\s*(update|insert into) public\.calling_window_(state_rules|holidays)\b/im);
  assert.match(migration, /raise exception using errcode = 'P0099', message = '20260929201000 probe rollback'/);
  assert.match(migration, /a federal holiday is still skipped by the state check/);
  assert.match(migration, /sunday_start_local >= time '08:00' and sunday_end_local <= time '21:00'/);
  // Writers: security definer, service role only, backdating and in-force withdrawal refused.
  for (const fn of ["publish_calling_window_state_rule(text, date, time, time, smallint[], time, time, boolean, text, text, uuid)", "withdraw_calling_window_state_rule(uuid)", "add_calling_window_holiday(text, date, text, text, uuid)", "remove_calling_window_holiday(uuid)"]) {
    const escaped = fn.replace(/[()[\]]/g, "\\$&");
    assert.match(migration, new RegExp(`revoke all on function public\\.${escaped}\\s+from public, anon, authenticated, tenant_app;`), fn);
  }
  assert.match(migration, /raise exception 'CALLING_RULE_BACKDATED'/);
  assert.match(migration, /if v_row\.effective_from <= current_date then raise exception 'CALLING_RULE_IN_FORCE'/);
  assert.match(migration, /set effective_to = p_effective_from/, "publishing does not close the version before it");
});

test("the super-admin editor: every write is role-checked and audited", () => {
  assert.deepEqual(
    [...read("lib", "callingWindow", "permissions.ts").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]),
    ["super_admin"],
  );
  const routes = [
    ["app", "api", "admin", "calling-rules", "route.ts"],
    ["app", "api", "admin", "calling-rules", "[id]", "route.ts"],
    ["app", "api", "admin", "calling-rules", "holidays", "route.ts"],
    ["app", "api", "admin", "calling-rules", "holidays", "[id]", "route.ts"],
    ["app", "api", "admin", "calling-rules", "reviewed", "route.ts"],
  ];
  for (const parts of routes) {
    const source = read(...parts);
    const writes = [...source.matchAll(/export async function (POST|DELETE|PATCH|PUT)/g)].length;
    assert.ok(writes > 0, parts.join("/"));
    assert.equal([...source.matchAll(/requireAdminRole\(CAN_MANAGE_CALLING_RULES\)/g)].length, [...source.matchAll(/export async function/g)].length, `${parts.join("/")} has a handler without the role check`);
    assert.equal([...source.matchAll(/await audit\(/g)].length, writes, `${parts.join("/")} has a write without an audit row`);
    assert.match(source, /status: 503/, "a write before the migration must answer 503");
  }
  const actions = read("lib", "audit", "actions.ts");
  for (const action of ["calling_rule.published", "calling_rule.withdrawn", "calling_holiday.added", "calling_holiday.removed", "calling_rules.reviewed"]) {
    assert.ok(actions.split(`"${action}"`).length - 1 >= 2, `${action} needs an entry and a label`);
  }
  assert.ok(existsSync(join(root, "app", "admin", "(protected)", "calling-rules", "page.tsx")));
  const page = read("app", "admin", "(protected)", "calling-rules", "page.tsx");
  assert.match(page, /CAN_MANAGE_CALLING_RULES\.includes\(admin\.role\)/);
  const editor = read("components", "admin", "calling-rules-editor.tsx");
  assert.match(editor, /No state rule/);
  assert.match(editor, /<StatStrip/);
  assert.match(editor, /<TableCard/);
  assert.match(editor, /<Pager/);
  assert.doesNotMatch(editor, /from "@\/lib\/callingWindow\/rulesAdmin"/, "the client editor must not import the server-only module");
});
