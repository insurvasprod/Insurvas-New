// Run with: npm test
//
// LA-1.4 acceptance criterion 6: "The preview matches the partner's view exactly."
//
// The agent-side form studio renders a "Partner preview" panel. It used to draw **every** field as a
// disabled text box, whatever its type — so a single-select, a long text area and a phone number all
// looked identical, and the panel said "The Partner Portal will show exactly these fields" while
// showing something else. Ray could not tell from the preview whether he had picked the right field
// type, which is most of what the preview is for.
//
// The preview now renders one control per field type. The durable fix is for both sides to share
// `PartnerField` from `components/partner/partner-portal-workspace.tsx` — it is already a clean
// presentational function of `{ field, value, error, onChange }` and belongs in its own module. That
// extraction was not done here because that file was being edited by another session at the time.
//
// Until it is, this is the anti-drift device: the preview names the types it handles, and a new
// field type cannot be added to the product without this list — and therefore the preview — being
// updated too.
//
// A source scan rather than an import, because the studio is a JSX client component and the test
// runner strips types without transforming JSX.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { TEMPLATE_FIELD_TYPES } from "./constants.ts";

const STUDIO = join(process.cwd(), "components", "app", "partner-form-studio.tsx");
const PORTAL = join(process.cwd(), "components", "partner", "partner-portal-workspace.tsx");

function declaredPreviewTypes(source) {
  const match = source.match(/partnerFormStudioPreviewTypes\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) return null;
  return [...match[1].matchAll(/['"`]([a-z_]+)['"`]/g)].map((entry) => entry[1]);
}

test("the form studio preview handles every field type a product can use", () => {
  if (!existsSync(STUDIO)) return;
  const declared = declaredPreviewTypes(readFileSync(STUDIO, "utf8"));

  assert.ok(
    declared,
    "partnerFormStudioPreviewTypes is gone from the form studio — the preview can no longer be " +
      "checked against the field types a product can use",
  );
  assert.deepEqual(
    [...declared].sort(),
    [...TEMPLATE_FIELD_TYPES].sort(),
    "the studio preview and TEMPLATE_FIELD_TYPES disagree. A field type the preview does not " +
      "handle renders as a plain text box, which is the divergence LA-1.4 criterion 6 forbids",
  );
});

test("the preview does not claim an exactness it cannot yet guarantee", () => {
  // Kept until the two sides share one renderer. The panel may describe what it shows; it may not
  // promise the portal looks identical while drawing its own controls.
  if (!existsSync(STUDIO)) return;
  // Comments are allowed to quote the old claim when explaining why it went; rendered copy is not.
  const source = readFileSync(STUDIO, "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(
    !/will show exactly these fields/i.test(source),
    "the preview promises the portal shows exactly these fields. It renders its own controls, so " +
      "that is only true once both sides import the same field renderer",
  );
});

test("the portal still renders each field type distinctly, which is what the preview mirrors", () => {
  // If the portal ever collapsed to one generic control, the preview mirroring per-type controls
  // would become the wrong half of the pair. This pins the assumption the test above rests on.
  if (!existsSync(PORTAL)) return;
  const source = readFileSync(PORTAL, "utf8");

  const distinct = ["boolean", "single_select", "multi_select", "long_text"].filter((type) =>
    new RegExp(`field\\.type\\s*===\\s*['"\`]${type}['"\`]`).test(source),
  );

  assert.deepEqual(
    distinct,
    ["boolean", "single_select", "multi_select", "long_text"],
    "the partner portal no longer renders these field types distinctly — re-check what the studio " +
      "preview should be mirroring",
  );
});
