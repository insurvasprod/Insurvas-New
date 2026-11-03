import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { partnerLeadLanguage } from "./language.ts";

test("reads language from generated and human-authored submission keys", () => {
  assert.equal(partnerLeadLanguage({ preferred_language: "Spanish" }), "Spanish");
  assert.equal(partnerLeadLanguage({ "Preferred Language": "English" }), "English");
  assert.equal(partnerLeadLanguage({ PreferredLanguage: "French" }), "French");
});

test("ignores empty and non-string language values", () => {
  assert.equal(partnerLeadLanguage({ preferred_language: "  " }), null);
  assert.equal(partnerLeadLanguage({ language: ["Spanish"] }), null);
  assert.equal(partnerLeadLanguage(null), null);
});

test("pipeline cards expose a saved customer language as a tag", async () => {
  const component = await readFile("components/partner/partner-lead-pipeline.tsx", "utf8");
  assert.match(component, /row\.language && <StatusChip tone="neutral"/);
  assert.match(component, /Customer language: \$\{row\.language\}/);
});
