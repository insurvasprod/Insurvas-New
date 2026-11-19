// Run with: node --experimental-strip-types --test lib/dashboard/roleAccess.test.mjs
//
// Roles r1 (owner 2026-11-18, "Build 1"): the dashboard's leaks and access fixes, pinned.
//   - Money is a permission, never a role name: a manager, a setter and a retention rep see no dollar figure.
//   - The dashboard honours the menu's narrowing (the agency's own screens for a narrowed session, extra roles,
//     hidden pages): no empty Compliance tab, no "Import a list" for an assistant inside an agency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { heldRoles, menuGate, seesMoney } from "./access.ts";
import { dashboardViews } from "./views.ts";
import { firstOpenable, resolveRoleHome } from "./roleHome.ts";
import { AGENCY_OWNER_ONLY_KEYS, menuFeatureKeys } from "../menu/definition.ts";

const EVERY_FEATURE = [...new Set(menuFeatureKeys())];
const keys = (views) => views.map((view) => view.key);
const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const NARROW = { narrow: true };

/* ── Money from permission ─────────────────────────────────────────────────────────────────────── */

test("money follows the money permission: owner, admin, bookkeeper and a producer's own book see it", () => {
  for (const role of ["owner", "admin", "bookkeeper", "producer"]) assert.equal(seesMoney([role]), true, role);
});

test("a manager, a setter, an assistant and a retention rep see no money", () => {
  for (const role of ["manager", "setter", "assistant", "retention"]) assert.equal(seesMoney([role]), false, role);
});

test("an extra role with the money permission opens money; a team lead's own commission never does", () => {
  assert.equal(seesMoney(["retention", "bookkeeper"]), true);
  assert.equal(seesMoney(["manager", "producer"]), false, "a manager's dashboard is his team's: counts only");
});

test("the session's held roles are the title first, then the extra roles", () => {
  assert.deepEqual(heldRoles({ role: "producer", memberRole: "manager", roles: ["producer", "setter"] }), ["manager", "setter"]);
  assert.deepEqual(heldRoles({ role: "retention" }), ["retention"]);
  assert.deepEqual(menuGate({ role: "setter", hiddenPages: ["leads.dialer"] }, ["u1"]), { narrow: true, memberRole: "setter", extraRoles: [], hiddenPages: ["leads.dialer"] });
  assert.equal(menuGate({ role: "owner" }, null).narrow, false);
});

test("the dashboard and the agency page take money from the permission, never from the role name", () => {
  const page = read("app/app/(shell)/dashboard/page.tsx");
  assert.match(page, /const noMoney = !seesMoney\(heldRoles\(context\)\);/);
  assert.doesNotMatch(page, /noMoney = role === "manager"/);
  const agency = read("app/app/(shell)/agency/page.tsx");
  assert.match(agency, /noMoney: !seesMoney\(heldRoles\(context\)\)/);
  assert.doesNotMatch(agency, /noMoney: manager/);
});

test("the audit's leaks stay shut: recent business, the agency's activity, the Retention view", () => {
  const home = read("components/app/home/views/overview-view.tsx");
  assert.match(home, /value: viewProps\.noMoney \? "" :/, "My recent business: no $/mo without money");
  const agency = read("components/app/home/views/agency-view.tsx");
  assert.match(agency, /value: money && row\.annualCents \?/, "Recent activity: no +$/yr without money");
  const retention = read("components/app/home/views/retention-view.tsx");
  assert.match(retention, /value=\{noMoney \? n\(month\.saved\)/, "the Retention view's hero counts without money");
  assert.match(retention, /retentionHeadline\(data: RetentionViewData, noMoney: boolean\)/);
});

test("no dead calls card: without an activity page the Home draws no Calls card at all", () => {
  const home = read("components/app/home/views/overview-view.tsx");
  assert.doesNotMatch(home, /Calls show here once the dialer is in use/);
  assert.match(home, /if \(!activityHref \|\| series\.length < 2 \|\| !series\.some\(\(day\) => day\.dials !== null\)\) return null;/);
});

/* ── The menu's narrowing ──────────────────────────────────────────────────────────────────────── */

test("inside an agency no narrowed role gets a Compliance or Accounting tab (their cards would all be hidden)", () => {
  for (const role of ["producer", "setter", "assistant", "retention"]) {
    const offered = keys(dashboardViews(EVERY_FEATURE, role, false, NARROW));
    assert.ok(!offered.includes("compliance"), `${role}: no Compliance`);
    assert.ok(!offered.includes("accounting"), `${role}: no Accounting`);
  }
  // The owner is never narrowed: every view, as before.
  assert.deepEqual(keys(dashboardViews(EVERY_FEATURE, "owner", false, {})), ["overview", "leads", "retention", "book", "accounting", "compliance"]);
});

test("no view is offered that would render empty: each offered module view opens a page the sidebar offers", () => {
  const VIEW_OPENS = { leads: ["leads.lists", "leads.workspace", "leads.dialer"], retention: ["retention.save-queue", "retention.lapse-risk", "retention.payment-repair"], book: ["book.policies", "book.carrier_files", "book.needs_you"], accounting: ["accounting.pnl", "accounting.bank", "accounting.invoices"], compliance: ["compliance.dashboard", "compliance.complaints", "compliance.tcpa", "compliance.consent"] };
  for (const role of ["owner", "producer", "setter", "assistant", "bookkeeper", "retention"]) {
    for (const gate of [{}, NARROW]) {
      for (const view of dashboardViews(EVERY_FEATURE, role, false, gate)) {
        if (view.key === "overview") continue;
        const open = VIEW_OPENS[view.key].filter((key) => firstOpenable([key], EVERY_FEATURE, role, false, gate) !== null);
        assert.ok(open.length > 0, `${role} ${gate.narrow ? "narrow" : "wide"}: ${view.key}`);
        if (gate.narrow) for (const key of open) assert.ok(!AGENCY_OWNER_ONLY_KEYS.has(key), `${role}: ${key} is the agency's own`);
      }
    }
  }
});

test("an assistant inside an agency is not offered Import a list; alone, as before", () => {
  const narrowed = resolveRoleHome(EVERY_FEATURE, "assistant", null, { gate: NARROW });
  assert.ok(!narrowed.actions.some((action) => action.href === "/app/import"), "no Import a list in an agency");
  assert.ok(!narrowed.actions.some((action) => /import/i.test(action.label)));
  const wide = resolveRoleHome(EVERY_FEATURE, "assistant", null, {});
  assert.ok(wide.actions.some((action) => /import/i.test(action.label)), "an assistant outside an agency keeps it");
});

test("a page the owner hid for this member is never a dashboard link", () => {
  const shown = resolveRoleHome(EVERY_FEATURE, "setter", null, {});
  assert.ok(shown.actions.some((action) => action.label === "Start calling"));
  const hidden = resolveRoleHome(EVERY_FEATURE, "setter", null, { gate: { hiddenPages: ["leads.dialer"] } });
  assert.ok(!hidden.actions.some((action) => action.label === "Start calling"));
});

test("an extra role opens its pages on the dashboard as it does in the menu", () => {
  assert.equal(firstOpenable(["accounting.pnl"], EVERY_FEATURE, "retention"), null);
  assert.ok(firstOpenable(["accounting.pnl"], EVERY_FEATURE, "retention", false, { extraRoles: ["bookkeeper"] }));
});

test("the page passes the menu's gate to the role home, the views and every link", () => {
  const page = read("app/app/(shell)/dashboard/page.tsx");
  assert.match(page, /const gate = menuGate\(context, scope\);/);
  assert.match(page, /resolveRoleHome\([^)]*\{ solo, gate \}\)/);
  assert.match(page, /firstOpenable\(keys, available, context\.role, solo, gate\)/);
  for (const loader of ["accounting", "agency", "book", "compliance", "leads", "retention"]) {
    assert.match(read(`lib/dashboard/views/${loader}.ts`), /props\.gate\)/, `${loader} loader passes the gate`);
  }
});
