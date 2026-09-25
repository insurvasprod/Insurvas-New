import test from "node:test";
import assert from "node:assert/strict";
import { parsePolicyCsv } from "./csv.ts";

test("policy CSV maps required columns and currency to cents", () => {
  const result = parsePolicyCsv('Policy Number,Insured Name,Carrier,Product,Effective Date,Annual Premium\nP-1,"Morgan, Alex",Summit,Term Life,01/15/2026,"$1,200.50"');
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].annual_premium_cents, 120050);
  assert.equal(result.rows[0].effective_date, "2026-01-15");
});

test("policy CSV fails closed when a required field is missing", () => {
  const result = parsePolicyCsv("policy_number,insured_name,carrier\nP-1,Alex,Summit");
  assert.ok(result.errors.some((item) => item.message.includes("Missing required column: product")));
});
