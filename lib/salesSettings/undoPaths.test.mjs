// Settings › Sales: everything an owner can put in force can also be taken out of force from the
// same panel. Found in the 2026-09-29 QA pass — a published quotation template, a published field
// set, a published disclosure and a saved portal account each had no way back, so a mistake stayed
// live for good. Structural: the panel offers the action and the route it calls exists.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("every template panel that publishes also retires", () => {
  for (const panel of ["underwriting.tsx", "quotation.tsx", "field-sets.tsx"]) {
    const src = read(`components/app/settings/sales/${panel}`);
    assert.match(src, /PublishDialog/, `${panel} publishes`);
    assert.match(src, /<RetireDialog/, `${panel} has no Retire`);
    assert.match(src, /api\.retire\(/, `${panel} never calls the retire route`);
  }
  assert.match(read("app/api/app/settings/sales/templates/[id]/retire/route.ts"), /export async function POST/);
});

test("a retire toast says what keeps the retired version, per kind", () => {
  const src = read("components/app/settings/sales/templates-data.ts");
  for (const kind of ["underwriting", "quotation", "application_field_set"]) assert.match(src, new RegExp(`${kind}: "`), kind);
});

test("a published disclosure can be retired (PATCH { status: 'retired' }), owners only, audited", () => {
  const route = read("app/api/app/settings/sales/disclosures/[id]/route.ts");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /z\.literal\("retired"\)/);
  assert.match(route, /requireFeatureRole\("applications", \["owner"\], \{ write: true \}\)[\s\S]*retireDisclosure/);
  const lib = read("lib/salesSettings/disclosures.ts");
  assert.match(lib, /export async function retireDisclosure[\s\S]*?\.eq\("tenant_id", actor\.tenantId\)[\s\S]*?tenant\.application_disclosure_retired/);
  assert.match(read("lib/salesSettings/settings.ts"), /"tenant\.application_disclosure_retired"/);
  assert.match(read("components/app/settings/sales/disclosures.tsx"), /method: "PATCH", body: JSON\.stringify\(\{ status: "retired" \}\)/);
});

test("a saved portal account can be removed, owners only, tenant-scoped and audited", () => {
  const route = read("app/api/app/settings/sales/portals/route.ts");
  assert.match(route, /export async function DELETE[\s\S]*requireFeatureRole\("applications", \["owner"\], \{ write: true \}\)[\s\S]*removePortalAccount/);
  const lib = read("lib/salesSettings/portals.ts");
  const fn = lib.slice(lib.indexOf("export async function removePortalAccount"));
  assert.match(fn, /\.delete\(\)\.eq\("tenant_id", actor\.tenantId\)\.eq\("id", id\)/);
  assert.match(fn, /auditSalesSetting\([\s\S]*removed: true/);
  assert.match(read("components/app/settings/sales/carriers.tsx"), /method: "DELETE"/);
});
