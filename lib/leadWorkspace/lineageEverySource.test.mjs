import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

// LA-2.20-7 / W3.6: one person re-imported from a second vendor is one lead with two sources, and
// the lead page lists both — the lineage read took only the first (`.limit(1)`).
test("the lineage reads every source row and the lead page lists them", () => {
  const lineage = read("lib", "leadWorkspace", "lineage.ts");
  const sourceRead = lineage.slice(lineage.indexOf('db.from("tenant_lead_sources")'), lineage.indexOf('db.from("tenant_callbacks")'));
  assert.doesNotMatch(sourceRead, /\.limit\(1\)/);
  assert.match(sourceRead, /\.limit\(MAX_SOURCES\)/);
  assert.match(lineage, /sources: LeadSource\[\];/);
  assert.match(lineage, /totalCostCents: money && costs\.length > 0/);
  // Money is never read for a viewer who may not see it.
  assert.match(lineage, /select\(money \? "campaign_id, source_type, cost_cents, created_at" : "campaign_id, source_type, created_at"\)/);
  const page = read("components", "app", "lead-detail-workspace.tsx");
  assert.match(page, /lineage\.sources\.map\(\(source, index\) =>/);
  assert.match(page, /Every source \(\{lineage\.sources\.length\}\)/);
});
