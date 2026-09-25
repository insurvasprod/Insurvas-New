import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../components/partner/partner-portal-workspace.tsx", import.meta.url), "utf8");
const leadWorkspace = await readFile(new URL("../../components/app/lead-workspace.tsx", import.meta.url), "utf8");
const teamWorkspace = await readFile(new URL("../../components/partner/partner-team-workspace.tsx", import.meta.url), "utf8");

test("LA-1 partner lead fields keep labels associated with every rendered control", () => {
  assert.match(source, /function PartnerField\(\{[^}]*id[^}]*\}: \{[^}]*id\?: string/);
  assert.match(source, /<select id=\{id\}/);
  assert.match(source, /<div id=\{id\} role="group" aria-labelledby=\{labelId\}/);
  assert.match(source, /<textarea id=\{id\}/);
  assert.match(source, /<Input id=\{id\}/);
  assert.match(source, /<Label htmlFor=\{`screen-phone-\$\{productCode\}`\}/);
  assert.match(source, /<PartnerField id=\{`screen-phone-\$\{productCode\}`\}/);
  assert.match(source, /const fieldId = `partner-field-\$\{productCode\}-\$\{field\.field_key\}`/);
  assert.match(source, /const fieldLabelId = `\$\{fieldId\}-label`/);
  assert.match(source, /<Label id=\{fieldLabelId\} htmlFor=\{isGroup \? undefined : fieldId\}>/);
  assert.match(source, /<PartnerField id=\{fieldId\} labelId=\{fieldLabelId\}/);
  assert.match(source, /<Label htmlFor="partner-product-picker">Product<\/Label>[\s\S]*<select[\s\S]*id="partner-product-picker"/);
  assert.doesNotMatch(source, /<label className="block max-w-md space-y-1\.5"><Label htmlFor="partner-product-picker">/);
});

test("LA-1 agent lead workspace keeps dynamic fields and stage actions distinguishable", () => {
  assert.match(leadWorkspace, /function FieldInput\(\{[^}]*id[^}]*\}: \{[^}]*id\?: string/);
  assert.match(leadWorkspace, /<select id=\{id\}/);
  assert.match(leadWorkspace, /<div id=\{id\} role="group" aria-labelledby=\{labelId\}/);
  assert.match(leadWorkspace, /<textarea id=\{id\}/);
  assert.match(leadWorkspace, /<Input id=\{id\}/);
  assert.match(leadWorkspace, /const fieldId = `lead-field-\$\{field\.field_key\}`/);
  assert.match(leadWorkspace, /const fieldLabelId = `\$\{fieldId\}-label`/);
  assert.match(leadWorkspace, /<Label id=\{fieldLabelId\} htmlFor=\{isGroup \? undefined : fieldId\}>/);
  assert.match(leadWorkspace, /<FieldInput id=\{fieldId\} labelId=\{fieldLabelId\}/);
  assert.match(leadWorkspace, /aria-label=\{`Move \$\{leadName\(lead\)\} to stage/);
});

test("LA-1 partner team uses text semantics for the fixed role display", () => {
  assert.match(teamWorkspace, /<p className="text-sm font-medium">Role<\/p><div className="flex h-9 items-center/);
  assert.doesNotMatch(teamWorkspace, /<Label htmlFor="partner-team-role">/);
});

test("team access is a standalone page without a duplicate team sub-navigation", () => {
  assert.match(teamWorkspace, /className="portal-partner-team-page mx-auto/);
  assert.doesNotMatch(teamWorkspace, /portal-team-section-tabs/);
});
