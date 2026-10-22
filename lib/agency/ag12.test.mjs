// AG-0.12 · the per-seat agency plan is gone; three flat seat bands replace it, and changing band follows SA-3's
// rules — an upgrade now, prorated against the band price difference; a downgrade at period end, no refund.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { SEAT_BANDS, bandFor } from "./constants.ts";
import { prorate } from "../subscriptions/proration.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const price = (band) => SEAT_BANDS.find((b) => b.band === band).priceCents;

test("three published band prices: $999, $2,499, $4,999 — and the migration seeds the same", () => {
  assert.deepEqual(SEAT_BANDS.map((b) => [b.band, b.priceCents]), [["to_50", 99_900], ["to_150", 249_900], ["over_150", 499_900]]);
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261018180000_ag_0_12_agency_bands_and_features.sql"), "utf8");
  for (const cents of ["99900", "249900", "499900"]) assert.ok(sql.includes(cents), `the band plans are seeded at ${cents} cents`);
  assert.equal(bandFor(50).band, "to_50");
  assert.equal(bandFor(51).band, "to_150");
  assert.equal(bandFor(151).band, "over_150");
});

test("a band upgrade is prorated against the band price difference, in whole cents", () => {
  // Day 10 of a 30-day period: 20 days remain.
  const up = prorate({ oldPriceCents: price("to_50"), newPriceCents: price("to_150"), periodDays: 30, daysElapsed: 10 });
  assert.deepEqual(up, { remainingDays: 20, creditCents: 66_600, chargeCents: 166_600, netCents: 100_000 });
  assert.equal(up.netCents, Math.round(((price("to_150") - price("to_50")) * 20) / 30), "exactly the difference for the days left");
  // A 31-day period and an odd day: each line rounds on its own and the net is their difference.
  const odd = prorate({ oldPriceCents: price("to_150"), newPriceCents: price("over_150"), periodDays: 31, daysElapsed: 7 });
  assert.equal(odd.remainingDays, 24);
  assert.equal(odd.netCents, odd.chargeCents - odd.creditCents);
  assert.equal(odd.creditCents, Math.round((price("to_150") * 24) / 31));
});

test("a band downgrade is never refunded mid-period: it applies at period end", () => {
  const down = prorate({ oldPriceCents: price("over_150"), newPriceCents: price("to_50"), periodDays: 30, daysElapsed: 10 });
  assert.ok(down.netCents < 0, "the arithmetic would owe the customer…");
  const planChange = readFileSync(join(ROOT, "lib/billing/planChange.ts"), "utf8");
  assert.match(planChange, /const applyNow = currentPriceCents !== null && newPriceCents !== null && newPriceCents > currentPriceCents;/, "…so only a dearer plan applies now");
  assert.match(planChange, /if \(proration\.netCents <= 0\)/, "and a non-positive net is settled at period end, not refunded");
});

test("no reference to the per-seat fields remains, outside the migration that proves they are gone", () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mjs|sql)$/.test(name) ? [path] : [];
  });
  const offenders = ["app", "lib", "components", "scripts", "supabase/migrations"]
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((path) => !path.replace(/\\/g, "/").endsWith("20261018180000_ag_0_12_agency_bands_and_features.sql") && !path.endsWith("ag12.test.mjs"))
    .filter((path) => /extra_seat_cents|assistant_seat_cents/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});
