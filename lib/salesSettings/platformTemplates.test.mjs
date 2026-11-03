// Settings defaults (docs/settings/DEFAULTS.md, owner pick 2026-11-03): the Insurvas templates for
// every catalogue line in 20261103120000, checked against the schemas the editor and the server
// validate with, so an agency that copies one ("Make it yours") never starts from a refused draft.
// Also the TS/SQL twins the defaults rest on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { definitionProblem, PERSISTENCY_KEYS } = await import("./templateSchemas.ts");
const { DEFAULT_STAGE_NAME } = await import("./stageMapChecks.ts");
const { INSURVAS_OUTCOME_STAGES } = await import("../pipelines/outcomesBoard.ts");
const { INSURVAS_DEFAULT_WINDOW, INSURVAS_DEFAULT_OPTIONS, FEDERAL_MINUTES } = await import("../callingWindow/engine.ts");

const migration = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const TEMPLATES = migration("20261103120000_platform_templates_every_line.sql");
const PIPELINE = migration("20261103110000_sales_pipeline_application_stages.sql");
const WINDOWS = migration("20261103100000_calling_window_insurvas_default.sql");

const rows = [...TEMPLATES.matchAll(/'(underwriting|quotation|application_field_set)', p\.code, null, '([^']+)', 1, 'published', \$def\$([\s\S]*?)\$def\$::jsonb, now\(\)\s+from public\.products p\s+where p\.code = '([a-z_]+)'/g)]
  .map(([, kind, name, json, code]) => ({ kind, name, code, definition: JSON.parse(json) }));

test("every catalogue line gets an Insurvas underwriting, quotation and field-set template", () => {
  const have = new Set(rows.map((r) => `${r.kind}/${r.code}`));
  const want = [
    "underwriting/whole_life", "underwriting/iul", "underwriting/medicare_advantage", "underwriting/annuity",
    "quotation/term_life", "quotation/whole_life", "quotation/iul", "quotation/medicare_advantage", "quotation/annuity",
    "application_field_set/term_life", "application_field_set/whole_life", "application_field_set/iul",
    "application_field_set/medicare_advantage", "application_field_set/annuity",
  ];
  assert.deepEqual([...have].sort(), [...want].sort());
});

test("each new template passes the schema the server validates a save with", () => {
  for (const r of rows) assert.equal(definitionProblem(r.kind, r.definition), null, `${r.name} would be refused`);
});

test("every new underwriting template keeps the five persistency questions", () => {
  for (const r of rows.filter((x) => x.kind === "underwriting")) {
    const keys = new Set(r.definition.fields.filter((f) => f.persistency).map((f) => f.field_key));
    for (const k of PERSISTENCY_KEYS) assert.ok(keys.has(k), `${r.name} lacks ${k}`);
  }
});

test("the new templates say they need review, and the reviewed-only disclosures stay drafts", () => {
  for (const r of rows) assert.match(r.name, /needs review$/, `${r.name} is not marked for review`);
  assert.match(TEMPLATES, /\(null, 'MA_TPMO_DISCLAIMER',[\s\S]*?\$body\$, 1, 'draft'\)/);
  assert.match(TEMPLATES, /\(null, 'ANNUITY_SUITABILITY',[\s\S]*?\$body\$, 1, 'draft'\)/);
  assert.equal((TEMPLATES.match(/\[DRAFT — NOT COMPLIANCE-APPROVED/g) ?? []).length, 2);
});

test("a new agency's Sales pipeline carries a stage for every application state's default name", () => {
  const stages = [...PIPELINE.matchAll(/\(v_pipeline, '([^']+)',\s+\d+, '(open|won|lost)'/g)].map(([, name, type]) => ({ name, type }));
  for (const name of new Set(Object.values(DEFAULT_STAGE_NAME))) assert.ok(stages.some((s) => s.name === name), `no ${name} stage`);
  assert.equal(stages.find((s) => s.name === "Issued").type, "won");
  assert.equal(stages.find((s) => s.name === "Lost").type, "lost");
});

test("the outcome routing the page resets to is the routing the seed writes", () => {
  const seeded = Object.fromEntries([...PIPELINE.matchAll(/\('([a-z_]+)',\s+'([^']+)'\)/g)].map(([, key, stage]) => [key, stage]));
  assert.deepEqual(seeded, INSURVAS_OUTCOME_STAGES);
});

test("the calling-window default is the SQL default, and narrower than federal law", () => {
  assert.match(WINDOWS, /'start_minute', 540/);
  assert.match(WINDOWS, /'end_minute', 1200/);
  assert.deepEqual(INSURVAS_DEFAULT_WINDOW, { start: 540, end: 1200 });
  assert.ok(INSURVAS_DEFAULT_WINDOW.start >= FEDERAL_MINUTES.start && INSURVAS_DEFAULT_WINDOW.end <= FEDERAL_MINUTES.end);
  assert.equal(INSURVAS_DEFAULT_OPTIONS.noSunday, true);
  assert.equal(INSURVAS_DEFAULT_OPTIONS.noFederalHolidays, true);
  assert.match(WINDOWS, /'no_sunday', true/);
  assert.match(WINDOWS, /'no_federal_holidays', true/);
});
