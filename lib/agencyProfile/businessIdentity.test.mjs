// LA-8.3 (Notion sprint, Module 8 — Settings) · Business identity.
// Run with: node --experimental-strip-types --test lib/agencyProfile/businessIdentity.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { addressLinesOf, BUSINESS_DOCUMENTS, BUSINESS_FIELD_ANCHORS, DOCUMENT_REQUIREMENTS, missingFor, requirementMessage } from "./requirements.ts";
import { agencyProfileInputSchema, maskTaxId, normalizeTaxId } from "./types.ts";
import { SETTINGS_SECTIONS } from "../settings/sections.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("supabase/migrations/20261015300000_la_8_3_business_identity.sql");

const FULL = { tradingName: "Power Policies", legalName: "Masood Insurance Services LLC", npn: "18442907", addressLine1: "4820 Bluebonnet Ln", city: "Austin", state: "TX", postalCode: "78745", phone: "(512) 555-0142", hasTaxId: true };

test("each document requires only its own fields, checked independently", () => {
  for (const doc of BUSINESS_DOCUMENTS) assert.deepEqual(missingFor(FULL, doc), [], doc);
  assert.deepEqual(DOCUMENT_REQUIREMENTS.welcome_pack.fields, ["trading_name", "phone"]);
  assert.deepEqual(DOCUMENT_REQUIREMENTS.payout_statement.fields, ["trading_name", "address"]);
  assert.deepEqual(DOCUMENT_REQUIREMENTS.dispute_letter.fields, ["trading_name", "npn", "address"]);
  assert.deepEqual(DOCUMENT_REQUIREMENTS.doi_response.fields, ["legal_name", "npn"]);
  assert.deepEqual(DOCUMENT_REQUIREMENTS.tax_export.fields, ["legal_name", "tax_id"]);
  // A welcome pack does not need an NPN; a dispute letter does.
  const noNpn = { ...FULL, npn: null };
  assert.deepEqual(missingFor(noNpn, "welcome_pack"), []);
  assert.deepEqual(missingFor(noNpn, "dispute_letter"), ["npn"]);
  // An address is street, city, state and ZIP — a street alone cannot be posted to.
  assert.deepEqual(missingFor({ ...FULL, city: null }, "payout_statement"), ["address"]);
  assert.deepEqual(missingFor(null, "tax_export"), ["legal_name", "tax_id"], "no identity saved: everything it needs is missing");
});

test("a blocked document names the field and the document, not 'complete your profile'", () => {
  assert.equal(requirementMessage("payout_statement", ["address"]), "Add your business address before generating a payout statement. Partner statements must show who they are from.");
  assert.equal(requirementMessage("welcome_pack", ["trading_name", "phone"]), "Add your trading name and business phone before generating a welcome pack. Clients need to see who sent it and how to reach you.");
  assert.equal(requirementMessage("dispute_letter", ["trading_name", "npn", "address"]), "Add your trading name, NPN and business address before generating a commission dispute letter. A carrier matches a dispute to the agency by its NPN and address.");
  assert.match(requirementMessage("doi_response", ["npn"]), /^Add your NPN before preparing a DOI complaint response\./);
  assert.match(requirementMessage("tax_export", ["tax_id"]), /^Add your tax ID before exporting your tax summary\./);
  for (const doc of BUSINESS_DOCUMENTS) assert.doesNotMatch(requirementMessage(doc, DOCUMENT_REQUIREMENTS[doc].fields), /complete your profile/i);
  // Each prompt can link to the field that fixes it, and every anchor is on the settings form.
  const form = read("components/app/settings/business-identity.tsx");
  for (const anchor of Object.values(BUSINESS_FIELD_ANCHORS)) assert.ok(form.includes(`id="${anchor}"`), anchor);
});

test("the database asks the same question the app does", () => {
  const fn = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.business_identity_missing"), MIGRATION.indexOf("-- ─── saving"));
  for (const doc of BUSINESS_DOCUMENTS) {
    const fields = DOCUMENT_REQUIREMENTS[doc].fields.map((f) => `'${f}'`).join(", ");
    assert.ok(fn.includes(`when '${doc}' then array[${fields}]`), `${doc} differs between SQL and lib/agencyProfile/requirements.ts`);
  }
  assert.match(fn, /'address' = any\(v_need\) and \(nullif\(btrim\(a\.address_line1\), ''\) is null or nullif\(btrim\(a\.city\), ''\) is null or a\.state is null or a\.postal_code is null\)/);
  // Publishing a statement — by hand or overnight — refuses with the app's own words.
  const publish = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.publish_payout_run"), MIGRATION.indexOf("create or replace function public.payout_drafts_due"));
  assert.match(publish, /v_missing := public\.business_identity_missing\(p_tenant_id, 'payout_statement'\);/);
  assert.match(publish, /'publish_payout_run: Add your % before generating a payout statement\. Partner statements must show who they are from\.'/);
  assert.equal(DOCUMENT_REQUIREMENTS.payout_statement.why, "Partner statements must show who they are from.");
  // The overnight run keeps the draft when it cannot publish, rather than losing it.
  const drafts = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.payout_drafts_due"));
  assert.match(drafts, /if s\.payout_auto_publish then\n\s+begin\n\s+perform public\.publish_payout_run\(s\.tenant_id, v_run, null\);\n\s+exception when others then/);
});

test("legal name and trading name are independent; the tax ID is encrypted, masked, and revealed with an audit row", () => {
  const parsed = agencyProfileInputSchema.parse({ legalName: "Masood Insurance Services LLC", dba: "Power Policies", taxIdType: "ssn", taxId: "123456789" });
  assert.equal(parsed.legalName, "Masood Insurance Services LLC");
  assert.equal(parsed.dba, "Power Policies");
  assert.equal(normalizeTaxId("123456789", "ssn"), "123-45-6789");
  assert.equal(normalizeTaxId("884410932", "ein"), "88-4410932");
  assert.equal(maskTaxId("ssn", "6789"), "•••-••-6789");
  assert.equal(maskTaxId("ein", "0932"), "••-•••0932");
  assert.equal(agencyProfileInputSchema.safeParse({ legalName: "X", taxIdType: "ein", taxId: "123-45-6789" }).success, false, "an SSN-shaped number is not an EIN");
  assert.match(MIGRATION, /nullif\(btrim\(p_identity->>'trading_name'\), ''\),/);
  assert.match(MIGRATION, /t := nullif\(btrim\(p_identity->>'legal_name'\), ''\);/);
  // The profile never carries the number; only the reveal does, and it audits first.
  const service = read("lib/agencyProfile/service.ts");
  const toView = service.slice(service.indexOf("async function toView"), service.indexOf("async function readRow"));
  assert.doesNotMatch(toView, /\btaxId:/);
  assert.doesNotMatch(read("lib/agencyProfile/types.ts"), /^\s+taxId: string \| null;/m);
  const reveal = service.slice(service.indexOf("export async function revealAgencyTaxId"), service.indexOf("const LOGO_TYPES"));
  assert.ok(reveal.indexOf('action: "tenant.agency_tax_id_revealed"') > 0 && reveal.indexOf('action: "tenant.agency_tax_id_revealed"') < reveal.indexOf("decryptTaxId("), "the audit row is written before the number is decrypted");
  assert.match(read("app/api/app/agency-profile/tax-id/route.ts"), /export async function POST[\s\S]*requireTenant\(\["owner"\]\)/);
  assert.doesNotMatch(read("app/api/app/agency-profile/tax-id/route.ts"), /export async function GET/);
});

test("every document reads this record, never its own copy", () => {
  const docs = {
    "lib/applications/welcomePack.ts": 'requireBusinessIdentity(actor.tenantId, "welcome_pack")',
    "lib/accounting/payoutStore.ts": 'requireBusinessIdentity(tenantId, "payout_statement")',
    "lib/discrepancies/letter.ts": 'requireBusinessIdentity(tenantId, "dispute_letter")',
    "lib/ingestion/discrepancyStore.ts": 'requireBusinessIdentity(tenantId, "dispute_letter")',
    "lib/compliance/complaintStore.ts": 'missingFor(identity, "doi_response")',
    "lib/accounting/taxStore.ts": 'requireBusinessIdentity(tenantId, "tax_export")',
  };
  for (const [file, call] of Object.entries(docs)) {
    const src = read(file);
    assert.ok(src.includes(call), `${file} does not read the business identity`);
    assert.doesNotMatch(src, /from\("agency_profiles"\)/, `${file} reads agency_profiles directly`);
    assert.doesNotMatch(src, /"Our agency"|tenants\.name|from\("tenants"\)\.select\("name"\)/, `${file} falls back to a name of its own`);
  }
  assert.doesNotMatch(read("lib/agencyProfile/identity.ts"), /tax_id_ciphertext/, "documents learn whether a tax ID exists, and never read the ciphertext");
  assert.match(MIGRATION, /case when p_tax_id_change then p_tax_id_ciphertext end,\n\s+case when p_tax_id_change then p_tax_id_last4 end,/, "the last four travel with the number");
  // The one writer: the old save function is dropped, and nothing calls it.
  assert.match(MIGRATION, /drop function if exists public\.save_agency_profile\(uuid, uuid, text, text, text, boolean, text, text, text, text\);/);
  for (const dir of ["lib", "app", "scripts"]) {
    for (const file of readdirSync(join(root, dir), { recursive: true }).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.endsWith(".test.mjs"))) {
      assert.doesNotMatch(read(`${dir}/${file}`), /rpc\("save_agency_profile"/, `${dir}/${file}`);
    }
  }
});

test("timezone sets display and scheduling only; calling windows stay with the customer's state", () => {
  for (const file of readdirSync(join(root, "lib/callingWindow")).filter((f) => f.endsWith(".ts"))) {
    const src = read(`lib/callingWindow/${file}`);
    assert.doesNotMatch(src, /agency_profiles|getWorkspaceTimezone|agencyProfile/, `lib/callingWindow/${file} reads the business timezone`);
  }
  assert.match(read("lib/callingWindow/engine.ts"), /const timezone = input\.timezones\[state\];/, "the window's zone is the lead's state's");
  assert.match(read("components/app/settings/business-identity.tsx"), /It does not set calling hours: those always follow each customer’s own state\./);
});

test("a missing logo prints the trading name as text; the logo is small, typed and checked by its bytes", () => {
  const pack = read("lib/applications/welcomePack.ts");
  assert.match(pack, /if \(logo\) \{[\s\S]*?page\.drawImage\(logo[\s\S]*?\} else \{\n\s+text\(input\.from\.name, \{ size: 14, f: bold \}\);/);
  assert.match(pack, /\.catch\(\(\) => null\) : null;/, "a logo that will not embed falls back to text too");
  assert.match(read("components/app/settings/business-identity.tsx"), /: <span className="text-base font-semibold">\{tradingName \|\| "Your trading name"\}<\/span>/);
  assert.match(MIGRATION, /values \('business-logos', 'business-logos', false, 524288, array\['image\/png', 'image\/jpeg'\]::text\[\]\)/);
  assert.match(MIGRATION, /logo_path like tenant_id::text \|\| '\/%'/, "a logo path is inside the agency's own folder");
  const service = read("lib/agencyProfile/service.ts");
  assert.match(service, /if \(!kind\.magic\(bytes\)\) throw new BusinessIdentityError/);
});

test("changes keep a dated history row and an audit row", () => {
  const save = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.save_business_identity"), MIGRATION.indexOf("create or replace function public.set_business_logo"));
  assert.match(save, /insert into public\.agency_profile_history \(/);
  assert.match(MIGRATION.slice(MIGRATION.indexOf("create or replace function public.set_business_logo")), /insert into public\.agency_profile_history \(/);
  assert.match(read("app/api/app/agency-profile/route.ts"), /action: "tenant\.agency_profile_saved"/);
  assert.match(read("app/api/app/agency-profile/logo/route.ts"), /action: "tenant\.business_logo_changed"/);
  // The older readers keep their one-line address, composed from the parts.
  assert.match(save, /update public\.agency_profiles set principal_address = nullif\(left\(concat_ws\(', ',/);
  assert.deepEqual(addressLinesOf({ addressLine1: "4820 Bluebonnet Ln", addressLine2: "Suite 210", city: "Austin", state: "TX", postalCode: "78745" }), ["4820 Bluebonnet Ln", "Suite 210", "Austin, TX 78745"]);
});

test("Business identity is a settings section of its own, the owner's, and the agency profile no longer edits it", () => {
  const section = SETTINGS_SECTIONS.find((s) => s.id === "business-identity");
  assert.equal(section.owned_by_module, "LA-8.3");
  assert.deepEqual([...section.required_roles], ["owner"]);
  assert.equal(section.group, "Agency");
  // Agency profile folded in (2026-10-15): one section edits the agency's identity, nowhere else.
  assert.ok(!SETTINGS_SECTIONS.some((s) => s.id === "agency-profile"));
  assert.match(read("components/app/settings/business-identity.tsx"), /<PartnerSupportCard \/>\s+<OwnershipCard team=\{team\} workspace=\{workspace\} \/>/);
});
