import { test } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_TILES, visibleDashboardTiles } from "./tiles.ts";

test("dashboard tiles are registered once and carry an actionable empty state", () => {
  assert.ok(DASHBOARD_TILES.length > 0);
  assert.equal(new Set(DASHBOARD_TILES.map((tile) => tile.key)).size, DASHBOARD_TILES.length);
  for (const tile of DASHBOARD_TILES) {
    assert.ok(tile.required_feature);
    assert.ok(tile.empty_state.length > 0);
    assert.ok(tile.action_label.length > 0);
    assert.ok(tile.path.startsWith("/app/"));
  }
});

test("tiles filter by entitlement without changing the registry", () => {
  assert.deepEqual(visibleDashboardTiles(["book_of_business"], "owner").map((tile) => tile.key), ["setup.carriers"]);
  assert.deepEqual(visibleDashboardTiles(["book_of_business", "appointment_vault"], "owner").map((tile) => tile.key), ["setup.carriers", "setup.appointments"]);
  assert.deepEqual(visibleDashboardTiles(["book_of_business", "appointment_vault"], "assistant"), []);
});
