import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { pruneHiddenTemplateValues, templateFormFieldVisible } = await import("./visibility.ts");

const form = {
  sections: [{
    section_key: "application",
    label: "Application",
    sort_order: 0,
    fields: [
      { field_key: "owns_home", is_required: true, show_when: null },
      { field_key: "home_value", is_required: false, show_when: { field_key: "owns_home", equals: "true" } },
      { field_key: "home_states", is_required: false, show_when: { field_key: "states", equals: "FL" } },
    ],
  }],
};

test("conditional field visibility supports scalar and multi-select values", () => {
  assert.equal(templateFormFieldVisible(form.sections[0].fields[1], { owns_home: "true" }), true);
  assert.equal(templateFormFieldVisible(form.sections[0].fields[1], { owns_home: false }), false);
  assert.equal(templateFormFieldVisible(form.sections[0].fields[2], { states: ["NY", "FL"] }), true);
});

test("pruning hidden fields removes stale preview and submission values", () => {
  assert.deepEqual(
    pruneHiddenTemplateValues(form, { owns_home: "false", home_value: 250000, states: ["FL"], home_states: ["FL"] }),
    { owns_home: "false", states: ["FL"], home_states: ["FL"] },
  );
  assert.deepEqual(
    pruneHiddenTemplateValues(form, { owns_home: "true", home_value: 250000, states: ["NY"] , home_states: ["FL"] }),
    { owns_home: "true", home_value: 250000, states: ["NY"] },
  );
});

test("pruning reaches a stable result for dependent conditional fields", () => {
  const chained = {
    sections: [{
      section_key: "application",
      label: "Application",
      sort_order: 0,
      fields: [
        { field_key: "details", is_required: false, show_when: { field_key: "middle", equals: "yes" } },
        { field_key: "middle", is_required: false, show_when: { field_key: "root", equals: "yes" } },
        { field_key: "root", is_required: false, show_when: null },
      ],
    }],
  };
  assert.deepEqual(
    pruneHiddenTemplateValues(chained, { root: "no", middle: "yes", details: "stale" }),
    { root: "no" },
  );
});

test("all interactive form paths use the shared visibility contract", async () => {
  const files = [
    "../../components/app/lead-workspace.tsx",
    "../../components/partner/partner-portal-workspace.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /@\/lib\/templates\/visibility/);
    assert.match(source, /templateFormFieldVisible/);
    assert.match(source, /pruneHiddenTemplateValues/);
  }
  // The settings preview draws the partner's own form component (LA-1.4-5), so it inherits the
  // contract rather than restating it.
  const settings = await readFile(new URL("../../components/app/template-settings.tsx", import.meta.url), "utf8");
  assert.match(settings, /import \{ PartnerLeadForm[^}]*\} from "@\/components\/partner\/partner-portal-workspace"/);
  assert.match(settings, /<PartnerLeadForm /);
});
