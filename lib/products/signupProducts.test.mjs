// Sign-up's "What do you sell?" → Settings › Products (owner 2026-11-03).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { signupProductCodes } = await import("./signupProducts.ts");

const CATALOGUE = [
  { code: "final_expense", category: "life" },
  { code: "term_life", category: "life" },
  { code: "whole_life", category: "life" },
  { code: "iul", category: "life" },
  { code: "medicare_advantage", category: "health" },
  { code: "annuity", category: "retirement" },
];

test("life switches on every life product, and only those", () => {
  assert.deepEqual(signupProductCodes(["life"], CATALOGUE), ["final_expense", "term_life", "whole_life", "iul"]);
});

test("health, medicare and annuities map to their catalogue products", () => {
  assert.deepEqual(signupProductCodes(["health"], CATALOGUE), ["medicare_advantage"]);
  assert.deepEqual(signupProductCodes(["medicare"], CATALOGUE), ["medicare_advantage"]);
  assert.deepEqual(signupProductCodes(["annuities"], CATALOGUE), ["annuity"]);
  assert.deepEqual(signupProductCodes(["life", "medicare", "annuities"], CATALOGUE), CATALOGUE.map((p) => p.code));
});

test("lines with no catalogue product switch nothing on", () => {
  assert.deepEqual(signupProductCodes(["property_casualty", "supplemental"], CATALOGUE), []);
  assert.deepEqual(signupProductCodes([], CATALOGUE), []);
});

test("the sign-up route applies the answer once, within the plan, without failing the sign-up", () => {
  const route = readFileSync(new URL("../../app/api/app/onboarding/business-profile/route.ts", import.meta.url), "utf8");
  assert.match(route, /await applySignupProducts\(context\.tenantId, profile\.productsSold\)\.catch\(/);
  const apply = readFileSync(new URL("./applySignupProducts.ts", import.meta.url), "utf8");
  assert.match(apply, /if \(products\.some\(\(p\) => p\.enabled\)\) return \[\];/);
  assert.match(apply, /\?\.inPlan\)/);
});
