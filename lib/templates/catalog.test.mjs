// Run with: node --experimental-strip-types --test lib/templates/catalog.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VISIBLE_STATES,
  activeFilterCount,
  filterTemplates,
  leadFieldDependents,
  sortTemplatesForCatalog,
  summarizeTemplateUsage,
  templateSizeLabel,
  templateState,
  templateTypeLabel,
} from "./catalog.ts";

const field = (key) => ({ field_key: key, label: key.toUpperCase(), type: "text", is_required: false, options: [], sort_order: 0 });
const stage = (key) => ({ stage_key: key, label: key, stage_type: "open", color: "#000000", sort_order: 0 });
const form = (...sections) => ({ sections });

test("state: active is published; inactive is archived until drafts exist, then split on published_at", () => {
  assert.equal(templateState(true, null, true), "published");
  assert.equal(templateState(true, null, false), "published");
  assert.equal(templateState(false, null, false), "archived", "before the migration nothing can be told apart, and nothing was ever a draft");
  assert.equal(templateState(false, null, true), "draft");
  assert.equal(templateState(false, "2026-09-01T00:00:00Z", true), "archived");
});

test("type names the parts a template carries; size counts fields and stages", () => {
  const full = { fields: [field("a")], stages: [stage("s")], form_definition: form({ section_key: "x", label: "X", sort_order: 0, fields: [{ field_key: "a", is_required: false, show_when: null }] }) };
  assert.equal(templateTypeLabel(full), "Full workspace");
  assert.equal(templateTypeLabel({ ...full, stages: [] }), "Lead fields + application form");
  assert.equal(templateTypeLabel({ fields: [field("a")], stages: [], form_definition: form() }), "Lead fields");
  assert.equal(templateTypeLabel({ fields: [], stages: [], form_definition: form() }), "Empty");
  assert.equal(templateSizeLabel({ fields: [field("a"), field("b")], stages: [stage("s")] }), "2 fields · 1 stage");
});

test("catalog order is product, then name, then newest", () => {
  const rows = [
    { product_name: "Term Life", name: "B", updated_at: "2026-01-01" },
    { product_name: "Final Expense", name: "Z", updated_at: "2026-01-01" },
    { product_name: "Term Life", name: "A", updated_at: "2026-01-01" },
  ];
  assert.deepEqual(sortTemplatesForCatalog(rows).map((row) => `${row.product_name}/${row.name}`), ["Final Expense/Z", "Term Life/A", "Term Life/B"]);
});

test("the default filter hides archived only, and counts as one filter", () => {
  const rows = [
    { name: "Live", description: null, product_code: "term_life", product_name: "Term Life", state: "published" },
    { name: "Old", description: null, product_code: "term_life", product_name: "Term Life", state: "archived" },
    { name: "New", description: "work in progress", product_code: "final_expense", product_name: "Final Expense", state: "draft" },
  ];
  const stateOf = (row) => row.state;
  assert.deepEqual(filterTemplates(rows, stateOf, { query: "", productCode: "all", states: DEFAULT_VISIBLE_STATES }).map((r) => r.name), ["Live", "New"]);
  assert.equal(activeFilterCount({ states: DEFAULT_VISIBLE_STATES }), 1);
  assert.equal(activeFilterCount({ states: ["published", "draft", "archived"] }), 0);
  assert.deepEqual(filterTemplates(rows, stateOf, { query: "progress", productCode: "all", states: ["published", "draft", "archived"] }).map((r) => r.name), ["New"]);
  assert.deepEqual(filterTemplates(rows, stateOf, { query: "", productCode: "term_life", states: ["archived"] }).map((r) => r.name), ["Old"]);
});

test("a lead field's dependents are its form placements and the conditions that read it", () => {
  const definition = form({
    section_key: "health",
    label: "Health",
    sort_order: 0,
    fields: [
      { field_key: "tobacco", is_required: false, show_when: null },
      { field_key: "packs", is_required: false, show_when: { field_key: "tobacco", equals: "Yes" } },
    ],
  });
  const labelOf = (key) => key.toUpperCase();
  assert.deepEqual(leadFieldDependents("tobacco", definition, labelOf), ["the “Health” form section", "the condition on “PACKS”"]);
  assert.deepEqual(leadFieldDependents("packs", definition, labelOf), ["the “Health” form section"]);
  assert.deepEqual(leadFieldDependents("unused", definition, labelOf), []);
});

test("usage: agencies on an earlier platform version, and applications on an earlier copy revision", () => {
  const summary = summarizeTemplateUsage(
    [{ id: "t1", version: 3 }],
    [
      { id: "c1", template_id: "t1", template_version: 3, definition_version: 1 },
      { id: "c2", template_id: "t1", template_version: 1, definition_version: 4 },
    ],
    [
      { tenant_template_id: "c2", definition_version: 2 },
      { tenant_template_id: "c2", definition_version: 4 },
      { tenant_template_id: "gone", definition_version: 1 },
    ],
  );
  assert.equal(summary.inProgress, 3);
  assert.equal(summary.inProgressOnEarlierVersion, 1);
  assert.deepEqual(summary.byTemplate.t1, { agencies: 2, agenciesOnEarlierVersion: 1, inProgress: 2, inProgressOnEarlierVersion: 1 });
});
