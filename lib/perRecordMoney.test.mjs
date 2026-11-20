// Run with: node --experimental-strip-types --test lib/perRecordMoney.test.mjs
//
// Walk 2026-11-20 (demo.basic): a $25 cost per record read "$25.000" on the campaign panel and the lead list.
// formatPerRecordCents keeps two decimals and adds a third only for a fraction of a cent, and both screens use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatPerRecordCents } from "./money.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("a whole-cent cost per record has two decimals, never three", () => {
  assert.equal(formatPerRecordCents(2500), "$25.00");
  assert.equal(formatPerRecordCents(13), "$0.13");
  assert.equal(formatPerRecordCents(175000), "$1,750.00");
});

test("a fraction of a cent keeps its third decimal", () => {
  assert.equal(formatPerRecordCents(12.5), "$0.125");
  assert.equal(formatPerRecordCents(487.5), "$4.875");
  assert.equal(formatPerRecordCents(2500 / 3), "$8.333");
});

test("nothing to show is a dash", () => {
  assert.equal(formatPerRecordCents(null), "—");
  assert.equal(formatPerRecordCents(undefined), "—");
  assert.equal(formatPerRecordCents(Number.NaN), "—");
});

test("the campaign workspace and the lead list format per-record costs with it", () => {
  const campaigns = read("components/app/campaign-workspace.tsx");
  assert.match(campaigns, /const perRecord = formatPerRecordCents;/);
  assert.doesNotMatch(campaigns, /minimumFractionDigits: 3/);
  const list = read("components/app/lead-list-detail.tsx");
  assert.match(list, /formatPerRecordCents\(cents\)/);
  assert.doesNotMatch(list, /toFixed\(3\)/);
});
