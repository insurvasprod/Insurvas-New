// AG-0.3 · producer hierarchy, effective-dated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyMove, directReportsAsOf, managerAsOf, wouldCycle } from "./hierarchyCore.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018120000_ag_0_3_producer_hierarchy.sql", import.meta.url), "utf8");

const start = [
  { producerId: "maria", parentProducerId: "ray", effectiveFrom: "2026-01-01", effectiveTo: null },
  { producerId: "dev", parentProducerId: null, effectiveFrom: "2026-01-01", effectiveTo: null },
];

test("moving a producer leaves a report dated before the move unchanged", () => {
  const mayBefore = directReportsAsOf(start, "ray", "2026-05-15");
  const moved = applyMove(start, "maria", null, "2026-06-01");
  assert.deepEqual(directReportsAsOf(moved, "ray", "2026-05-15"), mayBefore);
  assert.deepEqual(directReportsAsOf(moved, "ray", "2026-06-15"), []);
  assert.equal(managerAsOf(moved, "maria", "2026-05-31"), "ray");
  assert.equal(managerAsOf(moved, "maria", "2026-06-01"), null);
  // closed + inserted, never an edited parent
  const marias = moved.filter((r) => r.producerId === "maria");
  assert.equal(marias.length, 2);
  assert.deepEqual(marias[0], { producerId: "maria", parentProducerId: "ray", effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" });
});

test("a cycle is rejected", () => {
  const rows = applyMove(start, "ray", "dev", "2026-07-01");
  assert.equal(wouldCycle(rows, "dev", "ray", "2026-07-02"), true);
  assert.throws(() => applyMove(rows, "dev", "ray", "2026-07-02"), /hierarchy_cycle/);
  assert.throws(() => applyMove(rows, "dev", "dev", "2026-07-02"), /hierarchy_cycle/);
});

test("the database refuses overlaps with an exclusion constraint and cycles in its one writer", () => {
  assert.match(sql, /exclude using gist \(\s*producer_id with =,\s*daterange\(effective_from, effective_to, '\[\]'\) with &&/);
  assert.match(sql, /raise exception 'hierarchy_cycle'/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.producer_hierarchy from service_role, tenant_app;/);
  // one level deep, as of a date — the recursive query is not built
  assert.doesNotMatch(sql, /with recursive/i);
});
