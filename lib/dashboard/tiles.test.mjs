import { test } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_TILES, visibleDashboardTiles } from "./tiles.ts";

test("dashboard tiles are registered once and carry an actionable hint", () => {
  assert.ok(DASHBOARD_TILES.length > 0);
  assert.equal(new Set(DASHBOARD_TILES.map((tile) => tile.key)).size, DASHBOARD_TILES.length);
  for (const tile of DASHBOARD_TILES) {
    assert.ok(tile.required_feature);
    assert.ok(tile.hint.length > 0);
    assert.ok(tile.action_label.length > 0);
    assert.ok(tile.path.startsWith("/app/"));
  }
});

test("no tile hint claims the screen is empty", () => {
  // The hint renders unconditionally, with no count behind it, so a sentence asserting emptiness is
  // a statement about the reader's data that nothing checked. Two tiles used to say "No carriers
  // have been added yet" and "No appointments are recorded yet" to a tenant holding 5 carriers and
  // 38 appointments.
  //
  // LA-0.3 asks for "empty states that say what to do next rather than 'no data'", so this refuses
  // the "no data" half. Making the hint conditional instead would need a count per tile, and the
  // same ticket gives the page a one-second budget.
  const claimsEmptiness = [
    /\bno\s+\w+.*\b(yet|so far)\b/i,
    /\bnothing\s+(here|yet|to show)\b/i,
    /\b(is|are)\s+empty\b/i,
    /\bhaven'?t\s+\w+\s+any\b/i,
    /\bnone\s+(yet|recorded|added)\b/i,
  ];

  const offenders = DASHBOARD_TILES.filter((tile) =>
    claimsEmptiness.some((pattern) => pattern.test(tile.hint)),
  ).map((tile) => `${tile.key}: "${tile.hint}"`);

  assert.deepEqual(
    offenders,
    [],
    `tile hint(s) asserting the screen is empty, which nothing verified:\n  ${offenders.join("\n  ")}`,
  );
});

test("tiles filter by entitlement", () => {
  // A tile is only shown when its feature is granted. `appointment_vault` alone grants nothing
  // here, because the appointments tile also needs the owner role.
  const granted = visibleDashboardTiles(["book_of_business"], "owner").map((tile) => tile.key);
  assert.ok(granted.includes("setup.carriers"));
  assert.ok(!granted.includes("setup.appointments"), "a tile whose feature is not granted stays hidden");

  const withVault = visibleDashboardTiles(["book_of_business", "appointment_vault"], "owner").map((t) => t.key);
  assert.ok(withVault.includes("setup.appointments"));
  assert.ok(withVault.length > granted.length, "granting a feature can only add tiles");

  assert.deepEqual(visibleDashboardTiles([], "owner"), [], "no features, no tiles");
});

test("tiles filter by role as well as feature", () => {
  // Setup is the owner's job, so an assistant on the same entitlement does not see it.
  const features = ["book_of_business", "appointment_vault"];
  const assistant = visibleDashboardTiles(features, "assistant").map((tile) => tile.key);
  assert.ok(!assistant.includes("setup.carriers"));
  assert.ok(!assistant.includes("setup.appointments"));

  const owner = visibleDashboardTiles(features, "owner").map((tile) => tile.key);
  for (const key of assistant) {
    assert.ok(owner.includes(key), `the owner sees everything a narrower role does (${key})`);
  }
});

/**
 * The registry used to hold two tiles and both were owner-only, so every other role got an empty
 * grid — and the dashboard then told them their plan had no features, which was false and sent them
 * to an owner who could not fix it.
 *
 * This asserts the shape of that fix rather than a tile list, so tiles can be added or renamed
 * without touching the test, and the regression cannot come back unnoticed.
 */
test("every tenant role has at least one tile on a full entitlement", () => {
  const everyFeature = [...new Set(DASHBOARD_TILES.map((tile) => tile.required_feature))];
  for (const role of ["owner", "producer", "assistant", "setter", "bookkeeper"]) {
    const visible = visibleDashboardTiles(everyFeature, role);
    assert.ok(visible.length > 0, `${role} has no dashboard tile on a full entitlement`);
  }
});

test("the money boundary holds on the dashboard", () => {
  const everyFeature = [...new Set(DASHBOARD_TILES.map((tile) => tile.required_feature))];

  // A setter works a queue and sees their own scorecard. They do not see the book of business.
  const setter = visibleDashboardTiles(everyFeature, "setter").map((tile) => tile.key);
  assert.ok(!setter.includes("book.ledger"));
  assert.ok(!setter.includes("book.policies"));

  // A bookkeeper sees money and no call operations.
  const bookkeeper = visibleDashboardTiles(everyFeature, "bookkeeper").map((tile) => tile.key);
  assert.ok(!bookkeeper.includes("work.dialer"));
  assert.ok(!bookkeeper.includes("work.inbound"));
});

// ---------------------------------------------------------------------------
// The dashboard component itself
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD_PAGE = join(process.cwd(), "app", "app", "(shell)", "dashboard", "page.tsx");

test("the dashboard gates on effective features, never the raw entitlement", () => {
  // Kill switches are consulted BEFORE the entitlement at every enforcement point (SA-4.10).
  // `effectiveFeatures()` is what applies them, and everything the dashboard shows must be decided
  // from its result.
  //
  // This is not hypothetical. The callbacks card was gated on `hasFeature(entitlement, …)` — the
  // raw plan — while the callbacks TILE beside it used the effective list. The two are gated
  // identically in every other respect, so switching `callback_calendar` off platform-wide removed
  // the tile and left the card rendering and still querying due callbacks. A kill switch that one
  // half of a screen ignores is not a kill switch.
  if (!existsSync(DASHBOARD_PAGE)) return;
  const source = readFileSync(DASHBOARD_PAGE, "utf8");

  // Comments are allowed to name the old call; code is not.
  const code = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(
    !/hasFeature\s*\(\s*entitlement\b/.test(code),
    "the dashboard reads a feature off the raw entitlement — use the effectiveFeatures() result " +
      "so platform kill switches apply",
  );
  assert.ok(
    /applyKillSwitches\s*\(|effectiveFeatures\s*\(/.test(code),
    "the dashboard no longer applies kill switches — a killed feature would stay reachable",
  );
});

test("the dashboard renders tiles generically, with no tile key in its logic", () => {
  // LA-0.3 criterion 1: "A module adds a tile by registering it, with no change to the dashboard
  // component." A tile key named in the component means that tile's presence no longer comes from
  // the registry.
  if (!existsSync(DASHBOARD_PAGE)) return;
  const code = readFileSync(DASHBOARD_PAGE, "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const named = DASHBOARD_TILES.map((tile) => tile.key).filter((key) => code.includes(`"${key}"`));
  assert.deepEqual(named, [], `tile keys hard-coded into the dashboard component: ${named.join(", ")}`);
});
