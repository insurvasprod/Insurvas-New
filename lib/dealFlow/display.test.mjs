// Run with: node --experimental-strip-types --test lib/dealFlow/display.test.mjs
//
// Walk 2026-11-20 (demo.basic) on Daily deal flow:
//   1. every count was 0 although the tenant had a deal and an application;
//   2. the deal panel's Product read "Term life · term_life";
//   3. the panel's face amount was cut off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dealDayZone, intakeLocalDate } from "./localDate.ts";
import { dealProductText, faceAmountText, readableProductCode } from "./display.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

// The evidence (read-only, 2026-11-20): no agency timezone and no personal one; the only partner, Summit Transfers,
// is America/New_York. Its hot lead filed deal 7611ee15 at 2026-11-19T23:19Z under local_date 2026-11-19 (intake
// uses the agency zone, else the partner's). The page had no zone, so "today" was the browser's: 00:19 on
// 2026-11-20 in Europe. The report for 2026-11-20 is empty; for 2026-11-19 it has the deal. The day funnel fell
// back to UTC, where the serve (23:20Z) and the application (23:21Z) are also on the 19th.
const FILED = new Date("2026-11-19T23:19:06Z");

test("without an agency timezone, the partners' one zone is the deal-flow day", () => {
  const zone = dealDayZone(null, ["America/New_York"]);
  assert.equal(zone, "America/New_York");
  assert.equal(intakeLocalDate(zone, FILED), "2026-11-19", "the page's today is the day the deal was filed");
  assert.notEqual(intakeLocalDate("Europe/Belgrade", FILED), "2026-11-19", "the browser's day was the next one");
});

test("the agency's zone wins; partners in different zones or none settle nothing", () => {
  assert.equal(dealDayZone("America/Chicago", ["America/New_York"]), "America/Chicago");
  assert.equal(dealDayZone(null, ["America/New_York", "America/New_York", null]), "America/New_York");
  assert.equal(dealDayZone(null, ["America/New_York", "America/Los_Angeles"]), null);
  assert.equal(dealDayZone(null, []), null);
  assert.equal(dealDayZone("Not/AZone", ["Also/Not"]), null);
});

test("the page and the funnel take their day from the deals' zone, not the viewer's display zone", () => {
  const page = read("app/app/(shell)/deal-flow/page.tsx");
  assert.match(page, /getDealDayZone\(guard\.context\.tenantId\)/);
  assert.match(page, /dayZone=\{dayZone\}/);
  assert.match(read("components/app/deal-flow-workspace.tsx"), /const today = todayFor\(dayZone\);/);
  const route = read("app/api/app/deal-flow/funnel/route.ts");
  assert.match(route, /getDealDayZone\(auth\.context\.tenantId\)/);
  assert.match(read("lib/dealFlow/dayZone.ts"), /from\("partners"\)\.select\("timezone"\)\.eq\("tenant_id", tenantId\)/);
});

const nameOf = (code) => ({ term_life: "Term Life" })[code] ?? readableProductCode(code);

test("a product code is never shown raw, and a type that repeats the product is dropped", () => {
  assert.equal(dealProductText("term_life", "term_life", nameOf), "Term Life");
  assert.equal(dealProductText("final_expense", null, nameOf), "Final Expense");
  assert.equal(dealProductText("term_life", "20-year level", nameOf), "Term Life · 20-year level");
  assert.equal(dealProductText("term_life", "Term Life", nameOf), "Term Life");
  assert.equal(dealProductText(null, null, nameOf), "—");
});

test("a code the sold list does not name is made readable in Title Case", () => {
  assert.equal(readableProductCode("term_life"), "Term Life");
  assert.equal(readableProductCode("medicare_supplement_plan_g"), "Medicare Supplement Plan G");
  assert.match(read("components/app/products/use-sold-products.tsx"), /\?\? readableProductCode\(code\)/);
});

test("a face amount is whole dollars and its column fits it", () => {
  assert.equal(faceAmountText(25000000), "$250,000");
  assert.equal(faceAmountText(125050), "$1,250.50");
  assert.equal(faceAmountText(null), "—");
  const workspace = read("components/app/deal-flow-workspace.tsx");
  assert.match(workspace, /\["Face amount", faceAmountText\(row\.face_amount_cents\)\]/);
  assert.match(workspace, /grid-cols-\[repeat\(3,minmax\(min-content,1fr\)\)\]/);
});
