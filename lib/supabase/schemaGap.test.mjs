/**
 * `/app/campaigns` showed two "could not be loaded" panels and nothing else, while three vendors and
 * four campaigns sat in base tables the page never tried to read. The only thing actually missing was
 * a view a pending migration creates.
 *
 * `isSchemaGap` is the line between "not deployed yet" and "broken". Its whole value is being
 * NARROW: if it ever matched a permission denial or a timeout, a real fault would render as a
 * politely degraded screen and nobody would find out. That is what most of this file tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isSchemaGap } from "./schemaGap.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("a missing table or column is a gap", () => {
  assert.equal(isSchemaGap({ code: "42P01", message: 'relation "tenant_campaign_costs" does not exist' }), true);
  assert.equal(isSchemaGap({ code: "42703", message: 'column "records_rejected" does not exist' }), true);
  // The two shapes actually observed from PostgREST on this project.
  assert.equal(isSchemaGap({ message: "Could not find the table 'public.tenant_campaign_costs' in the schema cache" }), true);
  assert.equal(isSchemaGap({ message: "column tenant_vendor_rollup.records_rejected does not exist" }), true);
});

test("a real fault is NOT a gap, so it still surfaces", () => {
  // This is the assertion that matters. Each of these means something is wrong, and degrading the
  // screen over any of them would hide it.
  for (const error of [
    { code: "42501", message: "permission denied for table tenant_campaigns" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "23505", message: "duplicate key value violates unique constraint" },
    { code: "23503", message: "insert or update violates foreign key constraint" },
    { code: "08006", message: "connection failure" },
    { code: "PGRST301", message: "JWT expired" },
    { message: "fetch failed" },
    { message: "No rows found" },
  ]) {
    assert.equal(isSchemaGap(error), false, `${error.code ?? "(no code)"} must not be treated as a schema gap`);
  }
});

test("no error is not a gap", () => {
  assert.equal(isSchemaGap(null), false);
});

test("the campaigns route falls back to the base table instead of failing the page", () => {
  const route = read("app", "api", "app", "campaigns", "route.ts");
  const code = route.replace(/\/\/[^\n]*/g, "");
  // The view first — it is still the right answer when it exists.
  assert.match(code, /from\("tenant_campaign_costs"\)/);
  // A fault still 500s. The fallback is reached only past isSchemaGap.
  assert.match(code, /if \(!isSchemaGap\(full\.error\)\)[\s\S]{0,180}status: 500/);
  assert.match(code, /from\("tenant_campaigns"\)\.select\(BASE_COLUMNS\)/);
  // The usable basis is reported absent, never inferred.
  assert.match(code, /cost_per_usable_record_cents: null/);
  assert.match(code, /pending: USABLE_BASIS_MISSING/);
});

test("the fallback re-derives no money", () => {
  // `cost_per_record_cents` and `effective_cost_per_record_cents` are GENERATED columns on
  // `tenant_campaigns`, so the purchased basis is read, not recomputed. A second implementation of
  // cost arithmetic in TypeScript is exactly what `tenant_campaign_costs` exists to prevent.
  const route = read("app", "api", "app", "campaigns", "route.ts");
  // From the column constants (declared above GET) through to POST.
  const body = route.slice(route.indexOf("const COST_COLUMNS"), route.indexOf("export async function POST"));
  assert.match(body, /cost_per_record_cents, effective_cost_per_record_cents/);
  assert.doesNotMatch(body, /total_spend_cents\s*\/|\/\s*records_purchased/, "cost is being computed here rather than read");
});

test("each vendor panel degrades on its own", () => {
  const route = read("app", "api", "app", "vendors", "route.ts");
  const code = route.replace(/\/\/[^\n]*/g, "");
  // The vendor list itself comes from a base table and is never taken down by the derived views.
  assert.match(code, /const \[vendors, consent\] = await Promise\.all/);
  // Rollup: retried without the three columns the pending migration adds.
  assert.match(code, /isSchemaGap\(rollup\.error\)/);
  assert.match(code, /select\(ROLLUP_BASE\)/);
  // Speed: absent entirely, so it reports rather than retries.
  assert.match(code, /isSchemaGap\(speed\.error\)/);
  // And a genuine failure of either still 500s.
  assert.match(code, /Could not load the vendor rollup[\s\S]{0,120}status: 500/);
  assert.match(code, /Could not load speed to lead[\s\S]{0,120}status: 500/);
});

test("a count the database has not computed shows as a dash, never as zero", () => {
  const workspace = read("components", "app", "campaign-workspace.tsx");
  const code = workspace.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Zero rejected rows is a measurement — "we scrubbed and lost nothing". Unknown is not, and
  // printing 0 for it would invent a clean bill of health for a scrub that never ran.
  assert.match(code, /function count\(value: number \| null \| undefined\)/);
  assert.match(code, /value === null \|\| value === undefined \? "—"/);
  assert.doesNotMatch(code, /records_usable\.toLocaleString\(\)/);
  assert.doesNotMatch(code, /records_rejected\.toLocaleString\(\)/);
  // The vendor-credit prompt must not fire on an unknown count.
  assert.match(code, /\(campaign\.records_rejected \?\? 0\) > 0 && <p className="portal-campaigns-claim"/);
});

test("the pending notice is stated once, and is not an error", () => {
  const workspace = read("components", "app", "campaign-workspace.tsx");
  assert.match(workspace, /Some measurements are not available yet/);
  // The redesign moved these to the page's own callout and empty-state classes; the pin follows.
  assert.match(workspace, /pending\.length > 0 && <section className="portal-campaigns-callout is-warning">/);
  // Kept distinct from the failed-load state, which is a different fact with a different fix.
  assert.match(workspace, /loadError \? <p className="portal-campaigns-empty is-error" role="alert">/);
  const css = read("app", "globals.css");
  assert.match(css, /\.portal-campaigns-callout\.is-warning \{/);
  assert.match(css, /\.portal-campaigns-empty\.is-error \{/);
});
