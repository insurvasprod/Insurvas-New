// Run with: node --experimental-strip-types --test lib/dashboard/roleHome.test.mjs
//
// 2026-10-09 role home: each role lands on what it needs first, and never on a tile for a page it
// cannot open. The layout is data (roleHome.ts); these tests hold it to the menu's gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DASHBOARD_PROFILES, HOME_FIGURES, HOME_MONEY, HOME_NEEDS, HOME_SECTIONS, MAX_ACTIONS, ROLE_HOMES, STREAMED_SECTIONS,
  dashboardProfile, firstOpenable, resolveRoleHome, splitHomeSections,
} from "./roleHome.ts";
import { allMenuItems, buildAgentMenu, menuFeatureKeys } from "../menu/definition.ts";
import { DASHBOARD_TILES, visibleDashboardTiles } from "./tiles.ts";

const ROLES = ["owner", "producer", "setter", "assistant", "bookkeeper"];
const EVERY_FEATURE = [...new Set(menuFeatureKeys())];
const MONEY_PATHS = ["/app/policies", "/app/ledger", "/app/discrepancies", "/app/statements", "/app/true-cpa", "/app/pnl", "/app/payouts", "/app/carrier-files", "/app/rate-card", "/app/book-scorecards", "/app/sales-performance", "/app/vendor-returns"];
const CALL_OPS_PATHS = ["/app/dialer", "/app/inbound", "/app/floor", "/app/callbacks", "/app/calendar", "/app/activity", "/app/assignments"];

/** Every link a resolved home can render. */
function hrefs(home) {
  return [
    ...home.figures.map((item) => item.href),
    ...home.needs.map((item) => item.href),
    ...home.actions.map((item) => item.href),
    ...(home.nextCallbackHref ? [home.nextCallbackHref] : []),
  ];
}

/** The paths this role's sidebar holds on this entitlement. */
function menuPaths(features, role) {
  return new Set(buildAgentMenu(features, role).flatMap((section) => section.items).filter((item) => item.built).map((item) => item.path));
}

/** Entitlements to sweep: none, all, each feature alone, and all but each feature. */
const ENTITLEMENTS = [
  [],
  EVERY_FEATURE,
  ...EVERY_FEATURE.map((feature) => [feature]),
  ...EVERY_FEATURE.map((feature) => EVERY_FEATURE.filter((other) => other !== feature)),
];

test("every role has a layout of known sections, figures, needs and actions", () => {
  const menuKeys = new Set(allMenuItems().map((item) => item.key));
  for (const role of ROLES) {
    const layout = ROLE_HOMES[role];
    assert.ok(layout, `${role} has a home`);
    assert.equal(new Set(layout.sections).size, layout.sections.length, `${role}: a section listed twice`);
    for (const key of layout.sections) assert.ok(HOME_SECTIONS[key], `${role}: unknown section ${key}`);
    for (const key of layout.figures) assert.ok(HOME_FIGURES[key], `${role}: unknown figure ${key}`);
    for (const key of layout.needs) assert.ok(HOME_NEEDS[key], `${role}: unknown need ${key}`);
    assert.ok(layout.actions.length > 0, `${role} has a first thing to do`);
    for (const action of layout.actions) assert.ok(menuKeys.has(action.opens), `${role}: action opens unknown menu key ${action.opens}`);
  }
  // Every gate names a real, built menu entry: a typo would silently hide the section for everyone.
  const entries = [...Object.values(HOME_SECTIONS), ...Object.values(HOME_FIGURES), ...Object.values(HOME_NEEDS)];
  for (const entry of entries) {
    for (const key of entry.opens) {
      const item = allMenuItems().find((candidate) => candidate.key === key);
      assert.ok(item, `unknown menu key ${key}`);
      assert.ok(item.built, `${key} is not a built screen`);
    }
  }
});

test("a role never sees a link to a page outside its menu, on any entitlement", () => {
  for (const role of ROLES) {
    for (const features of ENTITLEMENTS) {
      const home = resolveRoleHome(features, role);
      const allowed = menuPaths(features, role);
      for (const href of hrefs(home)) {
        assert.ok(allowed.has(href), `${role} on [${features.join(", ")}] links to ${href}, which its menu does not hold`);
      }
      // A section with a page of its own is shown only when that page is open to this role.
      for (const key of home.sections) {
        const opens = HOME_SECTIONS[key].opens;
        if (opens.length) assert.ok(firstOpenable(opens, features, role), `${role} shows ${key} without its page`);
      }
      assert.ok(home.actions.length <= MAX_ACTIONS, `${role}: at most ${MAX_ACTIONS} actions`);
      assert.equal(new Set(home.actions.map((action) => action.href)).size, home.actions.length, `${role}: an action repeated`);
    }
  }
});

test("on a full plan every role gets a valid home with a first thing to do", () => {
  const expectedFirst = { owner: "/app/floor", producer: "/app/inbound", setter: "/app/dialer", assistant: "/app/inbound", bookkeeper: "/app/statements" };
  for (const role of ROLES) {
    const home = resolveRoleHome(EVERY_FEATURE, role);
    assert.ok(home.sections.length > 0, `${role} has sections`);
    assert.ok(home.actions.length > 0 && home.actions.length <= MAX_ACTIONS, `${role} has 1–${MAX_ACTIONS} actions`);
    assert.equal(home.actions[0].href, expectedFirst[role], `${role}'s first thing`);
  }
});

test("the first thing falls back when the plan lacks it", () => {
  const noInbound = EVERY_FEATURE.filter((feature) => feature !== "inbound_transfers");
  assert.equal(resolveRoleHome(noInbound, "producer").actions[0].href, "/app/dialer");
  assert.equal(resolveRoleHome(noInbound, "assistant").actions[0].href, "/app/callbacks");
  assert.equal(resolveRoleHome(noInbound, "owner").actions[0].href, "/app/activity");
});

test("the owner sees the most", () => {
  const owner = resolveRoleHome(EVERY_FEATURE, "owner");
  for (const role of ROLES.filter((other) => other !== "owner")) {
    const other = resolveRoleHome(EVERY_FEATURE, role);
    assert.ok(owner.sections.length > other.sections.length, `the owner has more sections than ${role}`);
    for (const key of other.sections) assert.ok(owner.sections.includes(key), `${role} has ${key} and the owner does not`);
    for (const need of other.needs) assert.ok(owner.needs.some((item) => item.key === need.key), `${role} sees need ${need.key} and the owner does not`);
  }
  for (const key of ["closeOut", "pending", "figures", "needs", "appointments", "activity", "team", "shortcuts", "callbacks", "setup"]) {
    assert.ok(owner.sections.includes(key), `owner has ${key}`);
  }
});

test("a setter never sees money, close-outs, pending cases or setup", () => {
  for (const features of ENTITLEMENTS) {
    const home = resolveRoleHome(features, "setter");
    for (const figure of home.figures) assert.ok(!HOME_FIGURES[figure.key].money, `setter shown money figure ${figure.key}`);
    for (const href of hrefs(home)) assert.ok(!MONEY_PATHS.includes(href), `setter linked to ${href}`);
    for (const key of ["closeOut", "pending", "setup", "callbacks", "team"]) assert.ok(!home.sections.includes(key), `setter shown ${key}`);
  }
  // Nor through the tile grid.
  const tiles = visibleDashboardTiles(EVERY_FEATURE, "setter").map((tile) => tile.path);
  for (const path of tiles) assert.ok(!MONEY_PATHS.includes(path), `setter tile to ${path}`);
});

test("an assistant sees no money; a bookkeeper sees no call operations", () => {
  for (const features of ENTITLEMENTS) {
    const assistant = resolveRoleHome(features, "assistant");
    for (const figure of assistant.figures) assert.ok(!HOME_FIGURES[figure.key].money);
    for (const href of hrefs(assistant)) assert.ok(!MONEY_PATHS.includes(href), `assistant linked to ${href}`);

    const bookkeeper = resolveRoleHome(features, "bookkeeper");
    for (const href of hrefs(bookkeeper)) assert.ok(!CALL_OPS_PATHS.includes(href), `bookkeeper linked to ${href}`);
    for (const key of ["figures", "needs", "callbacks", "appointments", "activity", "team", "closeOut"]) assert.ok(!bookkeeper.sections.includes(key), `bookkeeper shown ${key}`);
  }
});

test("the existing gates of the page are kept: close-out, pending, callbacks", () => {
  // closeOut: outbound_dialing, owner and producer (the close-out route's roles).
  for (const role of ROLES) {
    const shows = resolveRoleHome(["outbound_dialing"], role).sections.includes("closeOut");
    assert.equal(shows, ["owner", "producer"].includes(role), `closeOut for ${role}`);
    assert.ok(!resolveRoleHome(EVERY_FEATURE.filter((f) => f !== "outbound_dialing"), role).sections.includes("closeOut"));
  }
  // pending (LA-3): applications, owner and producer.
  for (const role of ROLES) {
    assert.equal(resolveRoleHome(["applications"], role).sections.includes("pending"), ["owner", "producer"].includes(role), `pending for ${role}`);
    assert.ok(!resolveRoleHome(EVERY_FEATURE.filter((f) => f !== "applications"), role).sections.includes("pending"));
  }
  // callbacks: callback_calendar, owner, producer and assistant — and a kill switch (the feature
  // missing from the effective list) hides it.
  for (const role of ROLES) {
    assert.equal(resolveRoleHome(["callback_calendar"], role).sections.includes("callbacks"), ["owner", "producer", "assistant"].includes(role), `callbacks for ${role}`);
    assert.equal(resolveRoleHome(EVERY_FEATURE.filter((f) => f !== "callback_calendar"), role).nextCallbackHref, null);
  }
});

test("reads follow what is shown, so a home never pays for a section it hides", () => {
  const bookkeeper = resolveRoleHome(EVERY_FEATURE, "bookkeeper").reads;
  assert.deepEqual(Object.values(bookkeeper).filter(Boolean), [], "a bookkeeper's home runs none of the today reads");
  const setter = resolveRoleHome(EVERY_FEATURE, "setter").reads;
  assert.equal(setter.policies, false, "no premium read for a setter");
  assert.equal(setter.setterWeek, true);
  assert.equal(setter.callbacks, false);
  const assistant = resolveRoleHome(EVERY_FEATURE, "assistant").reads;
  assert.equal(assistant.dialing, false, "an assistant's home does not count dials");
  assert.equal(assistant.inbound, true);
  const owner = resolveRoleHome(EVERY_FEATURE, "owner").reads;
  assert.equal(owner.setterWeek, false);
  assert.ok(owner.dialing && owner.policies && owner.inbound && owner.callbacks && owner.lapse && owner.licences);
});

test("the order splits around the streamed sections and keeps the role's order", () => {
  assert.deepEqual(splitHomeSections(resolveRoleHome(EVERY_FEATURE, "owner").sections), {
    // LA-0.3: the setup checklist is pinned at the top until complete.
    before: ["setup", "closeOut"],
    streamed: ["figures", "needs", "money", "appointments", "activity", "team"],
    // Pending cases come after the stream: the figure strip stays directly under the header.
    after: ["pending", "shortcuts", "callbacks"],
  });
  // A producer's callbacks sit between the needs and the diary, so they wait with the stream.
  assert.deepEqual(splitHomeSections(resolveRoleHome(EVERY_FEATURE, "producer").sections).streamed, ["figures", "needs", "money", "callbacks", "appointments", "activity"]);
  assert.deepEqual(splitHomeSections(resolveRoleHome(EVERY_FEATURE, "bookkeeper").sections), { before: ["money", "shortcuts"], streamed: [], after: [] });
  for (const role of ROLES) {
    for (const features of ENTITLEMENTS) {
      const sections = resolveRoleHome(features, role).sections;
      const { before, streamed, after } = splitHomeSections(sections);
      assert.deepEqual([...before, ...streamed, ...after], sections);
      assert.ok(!before.some((key) => STREAMED_SECTIONS.has(key)) && !after.some((key) => STREAMED_SECTIONS.has(key)));
    }
  }
});

test("every dashboard tile is gated at least as tightly as the page it opens", () => {
  for (const tile of DASHBOARD_TILES) {
    const path = tile.path.split("#")[0];
    const item = allMenuItems().find((candidate) => candidate.path === path);
    assert.ok(item, `${tile.key} opens ${path}, which is not in the menu`);
    if (item.required_feature) assert.equal(tile.required_feature, item.required_feature, `${tile.key} needs ${item.required_feature}`);
    const pageRoles = item.required_roles ?? ROLES;
    for (const role of tile.required_roles ?? ROLES) assert.ok(pageRoles.includes(role), `${tile.key} shown to ${role}, who cannot open ${path}`);
  }
});

test("the page takes its gates from the role home, not from role lists of its own", () => {
  const page = readFileSync(join(process.cwd(), "app", "app", "(shell)", "dashboard", "page.tsx"), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(page, /resolveRoleHome\(available, context\.role[,)]/, "the home is resolved from the effective features");
  assert.doesNotMatch(page, /\[\s*"owner"\s*,/, "a hand-written role list in the page");
  assert.doesNotMatch(page, /context\.role === "/, "a role compared in the page");
  assert.match(page, /reads: home\.reads/, "the today read runs only what the home shows");
});

// ── Sixteen #15 · per-plan profiles, the money dashboard, the one upgrade tile; LA-4.18 money line ──

/** The $99 Ledger tier's grants (docs/roadmap/ROADMAP.md, decided 2026-10-06). */
const LEDGER_PLAN = ["book_of_business", "statement_ingestion", "commission_ledger", "discrepancy_report", "appointment_vault", "cohort_persistency"];

test("every money figure links inside the reader's menu, with the view of its rows", () => {
  for (const role of ROLES) {
    for (const features of ENTITLEMENTS) {
      const home = resolveRoleHome(features, role, { code: null, features });
      const allowed = menuPaths(features, role);
      for (const item of home.money) {
        assert.ok(allowed.has(item.href.split("?")[0]), `${role} on [${features.join(", ")}] links money ${item.key} to ${item.href}`);
        assert.ok(HOME_MONEY[item.key], `unknown money key ${item.key}`);
      }
      if (role === "setter" || role === "assistant") assert.deepEqual(home.money, [], `${role} is shown money`);
    }
  }
});

test("the plan picks the profile; the bookkeeper is always on money", () => {
  assert.equal(dashboardProfile({ code: "basic", features: EVERY_FEATURE }, "owner"), "money", "the Ledger tier by name");
  assert.equal(dashboardProfile({ code: "pro", features: EVERY_FEATURE }, "owner"), "operations");
  assert.equal(dashboardProfile({ code: "new_money_plan", features: LEDGER_PLAN }, "owner"), "money", "a plan with no call operations, by its features");
  assert.equal(dashboardProfile({ code: "x", features: [] }, "owner"), "operations", "an empty plan is not a money plan");
  for (const plan of [null, { code: "pro", features: EVERY_FEATURE }]) assert.equal(dashboardProfile(plan, "bookkeeper"), "money");
});

test("the Ledger tier and the bookkeeper get the four-tile money dashboard as the page's one strip", () => {
  const four = DASHBOARD_PROFILES.money.money;
  assert.deepEqual([...four], ["statements", "discrepancies", "owed", "exposure"]);
  for (const role of ["owner", "bookkeeper"]) {
    const home = resolveRoleHome(LEDGER_PLAN, role, { code: "basic", features: LEDGER_PLAN });
    assert.equal(home.moneyAs, "strip");
    assert.deepEqual(home.money.map((item) => item.key), [...four], `${role}'s money tiles`);
    assert.ok(!home.sections.includes("figures"), `${role}: the money strip is the only strip`);
    assert.equal(home.landing, null);
  }
  // On the owner's full plan the money line is a list beside the day's strip.
  const owner = resolveRoleHome(EVERY_FEATURE, "owner", { code: "pro", features: EVERY_FEATURE });
  assert.equal(owner.moneyAs, "list");
  assert.ok(owner.sections.includes("figures") && owner.sections.includes("money"));
});

test("a money profile with too few tiles lands on the plan's primary working screen", () => {
  // Policies only: no statements, discrepancies or ledger, so no money tile at all.
  const home = resolveRoleHome(["book_of_business"], "bookkeeper", { code: "basic", features: ["book_of_business"] });
  assert.ok(home.money.length < DASHBOARD_PROFILES.money.minTiles);
  assert.equal(home.landing, "/app/policies");
  // Enough tiles: no landing.
  assert.equal(resolveRoleHome(EVERY_FEATURE, "bookkeeper").landing, null);
  // The operations profile never lands elsewhere.
  for (const features of ENTITLEMENTS) assert.equal(resolveRoleHome(features, "owner", { code: "pro", features: [...features, "outbound_dialing"] }).landing, null);
});

test("the upgrade tile: owners only, only when the plan lacks the feature, never for a switched-off one", () => {
  const lacking = EVERY_FEATURE.filter((feature) => feature !== "chargeback_radar");
  for (const role of ROLES) {
    const home = resolveRoleHome(lacking, role, { code: "pro", features: lacking });
    if (role === "owner") {
      assert.deepEqual(home.upgrade, { featureHref: "/app/lapse-risk", rowsHref: "/app/ledger?view=expected" });
      assert.ok(home.sections.includes("upgrade"));
      const strip = home.sections.indexOf("figures");
      assert.equal(home.sections.indexOf("upgrade"), strip + 1, "its fixed place: directly under the strip");
    } else {
      assert.equal(home.upgrade, null, `${role} cannot buy, so is never offered one`);
      assert.ok(!home.sections.includes("upgrade"));
    }
  }
  assert.equal(resolveRoleHome(EVERY_FEATURE, "owner", { code: "pro", features: EVERY_FEATURE }).upgrade, null, "the plan has it");
  assert.equal(resolveRoleHome(lacking, "owner", { code: "pro", features: lacking, disabled: ["chargeback_radar"] }).upgrade, null, "staff switched it off: not a sale");
  assert.equal(resolveRoleHome(lacking.filter((f) => f !== "commission_ledger"), "owner", { code: "pro", features: lacking.filter((f) => f !== "commission_ledger") }).upgrade, null, "no ledger: the rows behind the count cannot open");
  assert.equal(resolveRoleHome(lacking, "owner").upgrade, null, "no plan read: nothing offered");
});

test("a setter's strip is their booked, shown and show rate; a producer's lapse risk is their own", () => {
  const setter = resolveRoleHome(EVERY_FEATURE, "setter");
  assert.deepEqual(setter.figures.slice(0, 3).map((item) => item.key), ["booked", "shown", "showRate"]);
  assert.equal(setter.reads.setterWeek, true);
  const producer = resolveRoleHome(EVERY_FEATURE, "producer");
  assert.ok(!producer.needs.some((item) => item.key === "lapse"), "the needs row counts the agency's signals");
  assert.ok(producer.money.some((item) => item.key === "lapse"));
  assert.ok(producer.reads.closeOut && resolveRoleHome(EVERY_FEATURE, "owner").reads.closeOut, "the reader's own close-out rate");
});