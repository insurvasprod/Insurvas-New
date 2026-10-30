import test from "node:test";
import assert from "node:assert/strict";

import { laneShares, OVERVIEW_LANES } from "./overview.ts";
import { PARTNER_BOARD_COLUMNS } from "./view.ts";

/**
 * The Overview's share breakdown. These are the same figures, and the same words, as the Pipeline
 * page shows, so the two must not drift.
 */

const row = (lane) => ({ lane });

test("the lanes, and their names, are the Pipeline's", () => {
  // One vocabulary across the portal: a third set of words for the same five states is how
  // "Claimed 1" ends up over a column called something else.
  assert.deepEqual(
    OVERVIEW_LANES.slice(0, PARTNER_BOARD_COLUMNS.length).map((lane) => lane.label),
    PARTNER_BOARD_COLUMNS.map((column) => column.label),
  );
  assert.deepEqual(OVERVIEW_LANES.at(-1), { key: "closed", label: "Closed" });
});

test("every lane is listed, the empty ones included", () => {
  const shares = laneShares([row("new"), row("converted"), row("converted")]);
  assert.equal(shares.length, OVERVIEW_LANES.length);
  assert.deepEqual(shares.map((share) => share.count), [1, 0, 0, 2, 0]);
});

test("the shares add up to the rows they were counted from", () => {
  const rows = [row("new"), row("claimed"), row("verification"), row("converted"), row("closed"), row("closed")];
  assert.equal(laneShares(rows).reduce((sum, share) => sum + share.count, 0), rows.length);
});

test("a row with no lane is counted as new, not dropped", () => {
  // laneOf's rule. A dropped row would make the shares disagree with the total above them.
  const shares = laneShares([{}, { lane: null }, row("converted")]);
  assert.equal(shares.find((share) => share.key === "new").count, 2);
  assert.equal(shares.reduce((sum, share) => sum + share.count, 0), 3);
});
