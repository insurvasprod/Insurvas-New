import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../components/partner/partner-portal-workspace.tsx", import.meta.url), "utf8");
const leadWorkspace = await readFile(new URL("../../components/app/lead-workspace.tsx", import.meta.url), "utf8");
const teamWorkspace = await readFile(new URL("../../components/partner/partner-team-workspace.tsx", import.meta.url), "utf8");

test("LA-1 partner lead fields keep labels associated with every rendered control", () => {
  assert.match(source, /function PartnerField\(\{[^}]*id[^}]*\}: \{[^}]*id\?: string/);
  assert.match(source, /<SelectMenu\s+id=\{id\}\s+label=\{field\.label\}/);
  assert.match(source, /<div id=\{id\} role="group" aria-labelledby=\{labelId\}/);
  assert.match(source, /<textarea id=\{id\}/);
  assert.match(source, /<Input id=\{id\}/);
  assert.match(source, /<label htmlFor=\{`screen-phone-\$\{productCode\}`\}>/);
  assert.match(source, /<PartnerField\s+id=\{`screen-phone-\$\{productCode\}`\}/);
  assert.match(source, /const fieldId = `partner-field-\$\{productCode\}-\$\{field\.field_key\}`/);
  assert.match(source, /const fieldLabelId = `\$\{fieldId\}-label`/);
  assert.match(source, /<label id=\{fieldLabelId\} htmlFor=\{isGroup \? undefined : fieldId\}>/);
  assert.match(source, /<PartnerField\s+id=\{fieldId\}\s+labelId=\{fieldLabelId\}/);
  // The product and carrier pickers use the shared searchable menu, which names its trigger via label.
  assert.match(source, /<div className="portal-partner-submit-select">\s*<span>Product<\/span>\s*<SelectMenu\s+label="Product"/);
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
  // The fixed role is a SelectMenu as of 2026-10-30 (UI-CONSISTENCY §5b: no native <select>).
  // The contract is unchanged in substance: a visible name beside the control, the control named
  // for assistive technology, and partner_admin present but not selectable — shown with the reason
  // rather than hidden, so the control explains itself instead of ignoring the press.
  assert.match(teamWorkspace, /<span className=\{labelText\}>Role<\/span>/);
  assert.match(teamWorkspace, /<SelectMenu\s+label="Role"\s+value="partner_user"/);
  assert.match(teamWorkspace, /value: "partner_admin"[^}]*disabled: true/);
  assert.doesNotMatch(teamWorkspace, /<select/, "the portal has no native dropdowns");
  assert.doesNotMatch(teamWorkspace, /<Label htmlFor="partner-team-role">/);
});

test("team access is a standalone page without a duplicate team sub-navigation", () => {
  // 2026-09-28 consistency standard: one page title, the member list in a TableCard.
  assert.equal((teamWorkspace.match(/<PageHeader title="Team access"/g) ?? []).length, 2, "each branch draws the one title, once");
  assert.doesNotMatch(teamWorkspace, /eyebrow=/);
  assert.match(teamWorkspace, /<TableCard/);
  assert.doesNotMatch(teamWorkspace, /portal-team-section-tabs/);
});
