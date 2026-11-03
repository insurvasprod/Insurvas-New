import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Settings › Products (owner 2026-10-27): one rule decides what an agency sells, and every product
// picker and server check reads it. These source checks keep a picker from drifting back to a typed
// code or the whole catalogue.
const ROOT = process.cwd();
const read = (file) => readFileSync(join(ROOT, file), "utf8");

test("sold = switched on AND in the plan; a plan with no product list does not narrow", () => {
  const rule = read("lib/products/agencyProducts.ts");
  assert.match(rule, /const inPlan = plan === null \|\| plan\.has\(product\.code\);/);
  assert.match(rule, /sold: inPlan && on/);
  assert.match(rule, /return codes\.length \? new Set\(codes\) : null;/);
});

test("the partner side reads the same rule", () => {
  const partners = read("lib/partnerProducts/service.ts");
  assert.match(partners, /is_enabled: product\.sold/);
  assert.match(partners, /listTenantProducts\(tenantId\)/, "partner approvals start from the sold list");
});

test("every product picker offers only what the agency sells", () => {
  const pickers = {
    "components/app/deal-flow-workspace.tsx": /useSoldProducts\(\)/,
    "components/app/campaign-workspace.tsx": /useSoldProducts\(\)/,
    "components/app/assignment/rule-editor.tsx": /<ProductChips/,
    "components/app/settings/sales/templates-dialogs.tsx": /p\.sold !== false/,
    "components/app/settings/carrier-card.tsx": /sells\(p\.productCode\)/,
    "components/app/partner-form-studio.tsx": /is_enabled !== false/,
    "lib/applications/catalog.ts": /soldProductCodes\(tenantId\)/,
    "lib/agentTemplates/service.ts": /soldProductCodes\(tenantId\)/,
    "lib/salesSettings/carriers.ts": /soldProductCodes\(tenantId\)/,
  };
  for (const [file, pattern] of Object.entries(pickers)) assert.match(read(file), pattern, `${file} does not read the agency's products`);
  assert.doesNotMatch(read("components/app/deal-flow-workspace.tsx"), /placeholder="e\.g\. term_life"/, "deal flow's product filter is a typed code again");
  assert.doesNotMatch(read("components/app/campaign-workspace.tsx"), /<span>Product code<\/span>/, "campaigns ask for a typed product code again");
});

test("writes refuse a product the agency does not sell", () => {
  assert.match(read("lib/dealFlow/service.ts"), /await assertSoldProduct\(tenantId, productLine\);/);
  assert.match(read("app/api/app/campaigns/route.ts"), /assertSoldProduct\(auth\.context\.tenantId, parsed\.data\.product_code\)/);
  const settings = read("lib/products/settingsView.ts");
  assert.match(settings, /if \(sold && !product\.inPlan\) throw new ProductNotSoldError\(productCode, "not_in_plan"\);/);
});

test("lead import is for a product the agency sells, carried through the staged batch", () => {
  const helper = read("lib/products/importProduct.ts");
  assert.match(helper, /products\.some\(\(product\) => product\.code === PRODUCT_CODE\) \? PRODUCT_CODE : products\[0\]\.code/, "unnamed, Term Life when sold, else the first sold");
  for (const route of ["app/api/app/leads/import/route.ts", "app/api/app/leads/import/preflight/route.ts", "app/api/app/leads/import/mappings/route.ts"]) {
    assert.match(read(route), /importTemplateFor\(/, `${route} does not pick the product's form`);
    assert.doesNotMatch(read(route), /getAgentTemplate\(auth/, `${route} is back on the Term Life form`);
  }
  const preflight = read("lib/agentTemplates/importPreflight.ts");
  assert.match(preflight, /productCode: input\.template\.template\.product_code,/, "the batch remembers its product");
  assert.match(read("app/api/app/leads/import/preflight/route.ts"), /batchProductCode\(auth\.context\.tenantId, product\.batchId\) \?\? PRODUCT_CODE/, "a batch staged before products is Term Life");
  assert.match(read("components/app/lead-import-workspace.tsx"), /id="lead-product"/);
});

test("Settings › Products is an owner-only Agency section with its panel", () => {
  const sections = read("lib/settings/sections.ts");
  assert.match(sections, /group: "Agency", id: "products", label: "Products", sort_order: 15, owned_by_module: "LA-1\.3", required_roles: OWNER/);
  assert.match(read("components/app/settings/panels.tsx"), /products: \(\) => <ProductsSettings \/>/);
  assert.match(read("app/api/app/settings/products/route.ts"), /requireTenant\(\["owner"\]\)/);
});
