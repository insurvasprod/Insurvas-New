// Run with: npm test
//
// Lead sources clean-up (owner 2026-10-29): delete an empty campaign or vendor, discard a staged
// file. Each delete is server-enforced: refused while anything points at the row, tenant-scoped,
// gated like the edit it sits beside, audited; a discard never touches an imported batch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const guards = read("lib", "campaigns", "deleteGuards.ts");
const campaignRoute = read("app", "api", "app", "campaigns", "[id]", "route.ts");
const vendorRoute = read("app", "api", "app", "vendors", "route.ts");
const batchRoute = read("app", "api", "app", "leads", "import", "batches", "[id]", "route.ts");

/** Every (table, column) whose foreign key to `target` is SET NULL or RESTRICT, read off the migrations. */
function referencing(target) {
  const dir = join(root, "supabase", "migrations");
  const found = new Set();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    let table = null;
    for (const line of readFileSync(join(dir, file), "utf8").split(/\r?\n/)) {
      const opened = /(?:create table if not exists|alter table)\s+public\.(\w+)/i.exec(line);
      if (opened) table = opened[1];
      const fk = new RegExp(`^\\s*(?:add column if not exists\\s+)?(\\w+)\\s+uuid\\b.*references public\\.${target}\\(id\\) on delete (set null|restrict)`, "i").exec(line);
      if (fk && table) found.add(`${table}.${fk[1]}`);
    }
  }
  return found;
}

function listed(name) {
  const block = guards.slice(guards.indexOf(`export const ${name}`), guards.indexOf("];", guards.indexOf(`export const ${name}`)));
  return new Set([...block.matchAll(/table: "(\w+)", column: "(\w+)"/g)].map((match) => `${match[1]}.${match[2]}`));
}

test("every SET NULL / RESTRICT reference to a campaign is checked before it is deleted", () => {
  const fks = referencing("tenant_campaigns");
  assert.ok(fks.has("agent_leads.campaign_id"), "the migration reader is broken, not the guard");
  const checked = listed("CAMPAIGN_REFERENCES");
  const missing = [...fks].filter((key) => !checked.has(key));
  assert.deepEqual(missing, [], `a delete would orphan or trip on: ${missing.join(", ")}`);
});

test("every SET NULL / RESTRICT reference to a vendor is checked before it is deleted", () => {
  const fks = referencing("tenant_lead_vendors");
  assert.ok(fks.has("tenant_campaigns.vendor_id"));
  const checked = listed("VENDOR_REFERENCES");
  const missing = [...fks].filter((key) => !checked.has(key));
  assert.deepEqual(missing, [], `a delete would orphan or trip on: ${missing.join(", ")}`);
});

test("a campaign with leads is refused with a 409 and the way out, before any delete", () => {
  assert.match(guards, /table: "agent_leads", column: "campaign_id", reason: `It has leads — \$\{EXHAUST\}\.`/);
  assert.match(guards, /const EXHAUST = "mark it exhausted instead"/);
  // Only a discarded (failed) file lets a campaign go; an imported or waiting one holds it.
  assert.match(guards, /only: \{ column: "status", values: \["completed"\] \}/);
  assert.match(guards, /only: \{ column: "status", values: \["processing"\] \}/);
  // A read that fails is never "nothing there": only a not-deployed table is skipped.
  assert.match(guards, /if \(isSchemaGap\(error\)\) return null;\s*throw new Error/);

  const del = code(campaignRoute.slice(campaignRoute.indexOf("export async function DELETE")));
  assert.match(del, /requireFeatureRole\("outbound_dialing", roles, \{ write: true/);
  assert.match(campaignRoute, /const roles = \["owner", "producer"\] as const;/);
  assert.match(del, /refuseNarrowInAgency\(auth\.context, "Campaigns"\)/);
  const check = del.indexOf("deleteBlocker(");
  const remove = del.indexOf(".delete()");
  assert.ok(check > 0 && remove > check, "the blocker check runs before the delete");
  assert.match(del, /if \(blocker\) return NextResponse\.json\(\{ error: blocker, code: "campaign_in_use" \}, \{ status: 409 \}\)/);
  assert.match(del, /\.delete\(\)\.eq\("id", id\)\.eq\("tenant_id", tenantId\)/);
  assert.match(del, /isForeignKeyRefusal\(removed\.error\)\) return NextResponse\.json\([^)]*\{ status: 409 \}/);
  assert.match(del, /action: "tenant\.campaign_deleted"/);
});

test("a vendor with any campaign is refused the same way, inactive being the way out", () => {
  assert.match(guards, /table: "tenant_campaigns", column: "vendor_id", reason: `It has campaigns — \$\{INACTIVE\}\.`/);
  const del = code(vendorRoute.slice(vendorRoute.indexOf("export async function DELETE")));
  assert.match(del, /requireFeatureRole\("outbound_dialing", roles, \{ write: true/);
  assert.match(del, /refuseNarrowInAgency\(/);
  assert.ok(del.indexOf("deleteBlocker(") < del.indexOf(".delete()"));
  assert.match(del, /code: "vendor_in_use" \}, \{ status: 409 \}/);
  assert.match(del, /\.delete\(\)\.eq\("id", id\)\.eq\("tenant_id", tenantId\)/);
  assert.match(del, /action: "tenant\.lead_vendor_deleted"/);
});

test("a vendor goes with its campaigns only on the explicit flag, every campaign's guard checked before anything is deleted", () => {
  const src = code(vendorRoute);
  const del = src.slice(src.indexOf("export async function DELETE"));
  // Without the flag, today's path: the flag is optional and only `true` is accepted.
  assert.match(del, /withCampaigns: z\.literal\(true\)\.optional\(\)/);
  assert.match(del, /if \(withCampaigns\) return await deleteWithCampaigns\(/);
  assert.ok(del.indexOf("refuseNarrowInAgency(") < del.indexOf("deleteWithCampaigns("), "same agency gate before the cascade");

  // The plan: every campaign of the vendor through the empty-campaign guard, and the vendor through
  // its own guard apart from its campaigns. It deletes nothing.
  const plan = src.slice(src.indexOf("async function cascadePlan"), src.indexOf("async function deleteCheck"));
  assert.match(plan, /\.from\("tenant_campaigns"\)\.select\("id, name, status"\)\.eq\("tenant_id", tenantId\)\.eq\("vendor_id", vendorId\)/);
  assert.match(plan, /for \(const campaign of campaigns\) \{\s*const reason = await deleteBlocker\(service as GuardDb, tenantId, campaign\.id, CAMPAIGN_REFERENCES\);\s*if \(reason\) blocked\.push/);
  assert.match(plan, /deleteBlocker\(service as GuardDb, tenantId, vendorId, VENDOR_OWN_REFERENCES\)/);
  assert.match(src, /const VENDOR_OWN_REFERENCES = VENDOR_REFERENCES\.filter\(\(reference\) => reference\.table !== "tenant_campaigns"\);/);
  assert.doesNotMatch(plan, /\.delete\(/, "the plan never deletes");

  // The cascade: the whole plan is checked first and any blocked campaign refuses with the list.
  const cascade = src.slice(src.indexOf("async function deleteWithCampaigns"), src.indexOf("export async function DELETE"));
  const planned = cascade.indexOf("await cascadePlan(");
  const refuse = cascade.indexOf("if (plan.blocked.length > 0)");
  const vendorRefuse = cascade.indexOf("if (plan.vendorBlocker)");
  const firstDelete = cascade.indexOf(".delete()");
  assert.ok(planned > 0 && refuse > planned && vendorRefuse > planned, "the plan is read before any refusal");
  assert.ok(firstDelete > refuse && firstDelete > vendorRefuse, "nothing is deleted before every campaign passed");
  assert.match(cascade, /code: "campaigns_in_use", blocked: plan\.blocked \}, \{ status: 409 \}/);
  // One by one, each re-checked right before its own delete, stopping at the first refusal.
  const loop = cascade.slice(cascade.indexOf("for (const campaign of plan.campaigns)"));
  assert.ok(loop.indexOf("deleteBlocker(service as GuardDb, tenantId, campaign.id, CAMPAIGN_REFERENCES)") < loop.indexOf(".delete()"));
  assert.match(loop, /if \(reason\) return stopped\(/);
  assert.match(loop, /\.from\("tenant_campaigns"\)\.delete\(\)\.eq\("id", campaign\.id\)\.eq\("tenant_id", tenantId\)/);
  assert.match(loop, /action: "tenant\.campaign_deleted"/);
  // The vendor last, through its FULL guard (a campaign added meanwhile still holds it).
  const tail = cascade.slice(cascade.lastIndexOf("deleteBlocker("));
  assert.match(tail, /^deleteBlocker\(service as GuardDb, tenantId, vendor\.id, VENDOR_REFERENCES\)/);
  assert.match(tail, /\.from\("tenant_lead_vendors"\)\.delete\(\)\.eq\("id", vendor\.id\)\.eq\("tenant_id", tenantId\)/);
  assert.match(tail, /action: "tenant\.lead_vendor_deleted"/);
  assert.match(cascade, /deletedCampaigns: deleted\.map/, "a stop reports what was already deleted");

  // The read-only check behind the second warning is gated like the delete.
  const check = src.slice(src.indexOf("async function deleteCheck"), src.indexOf("async function deleteWithCampaigns"));
  assert.match(check, /requireFeatureRole\("outbound_dialing", roles, \{ write: true, prefetchScope: true \}\)/);
  assert.match(check, /refuseNarrowInAgency\(auth\.context, "Vendors"\)/);
  assert.doesNotMatch(check, /\.delete\(/);
});

test("discarding a staged file only ever touches a batch still in 'processing'", () => {
  const del = code(batchRoute.slice(batchRoute.indexOf("export async function DELETE")));
  assert.match(batchRoute, /const LEAD_IMPORT_ROLES = \["owner", "producer", "assistant"\] as const;/);
  assert.match(batchRoute, /requireFeatureRole\("lead_import", LEAD_IMPORT_ROLES, \{ write, prefetchScope: true \}\)/);
  assert.match(batchRoute, /refuseNarrowInAgency\(auth\.context, "Lead import"\)/);
  assert.match(del, /\.update\(\{ status: "failed", error_message: `Discarded by \$\{who\}` \}\)\s*\.eq\("tenant_id", tenantId\)\s*\.eq\("id", id\)\s*\.eq\("status", "processing"\)/);
  assert.doesNotMatch(del, /\.delete\(/, "a discard marks the batch, it never deletes the row");
  assert.doesNotMatch(del, /status: "completed"/);
  assert.match(del, /action: "tenant\.lead_import_discarded"/);
  // A discarded batch is never offered for review or commit again.
  const service = read("lib", "agentTemplates", "importPreflight.ts");
  const loader = service.slice(service.indexOf("export async function loadImportReview"));
  assert.match(loader, /if \(row\.data\.status === "failed"\) return \{ state: "missing", plan: null \};/);
  const step = service.slice(service.indexOf("export async function advancePreflightScreening"));
  assert.match(step, /if \(row\.status === "failed"\) return \{ state: "missing" \};/);
});

test("the new route is registered on both sides of the money boundary checks", () => {
  assert.match(read("lib", "entitlements", "agentApiPolicy.ts"), /\{ sourceFile: "app\/api\/app\/leads\/import\/batches\/\[id\]\/route\.ts", featureKey: "lead_import", allowedRoles: \["owner", "producer", "assistant"\] \}/);
  assert.match(read("lib", "tenantAuth", "moneyRoutes.test.mjs"), /"leads\/import\/batches\/\[id\]\/route\.ts",/);
  const actions = read("lib", "audit", "actions.ts");
  for (const action of ["tenant.campaign_deleted", "tenant.lead_vendor_deleted", "tenant.lead_import_discarded"]) {
    assert.equal(actions.split(`"${action}"`).length - 1, 2, `${action} is declared and labelled once each`);
  }
});

test("every delete in the UI asks through the kit's dialog, and Lists offers it only for an empty list", () => {
  const files = [
    ["components", "app", "campaign-workspace.tsx"],
    ["components", "app", "vendor-roster.tsx"],
    ["components", "app", "lead-list-index.tsx"],
    ["components", "app", "import-discard.ts"],
  ];
  for (const parts of files) {
    const source = code(read(...parts));
    assert.doesNotMatch(source, /window\.confirm/, parts.join("/"));
    assert.match(source, /confirmAction\(/, parts.join("/"));
  }
  const index = read("components", "app", "lead-list-index.tsx");
  assert.match(index, /\{state === "empty" && canDelete && \(/);
  assert.match(read("components", "app", "lead-sources", "pages.tsx"), /canDeleteLists = canCampaigns && outbound\.entitled && outbound\.entitlement\.access !== "read_only"/);
  // The rail forgets a file only on a clear answer from the server.
  assert.match(read("components", "app", "lead-sources", "leads-in-rail.tsx"), /body\?\.state === "missing" \|\| body\?\.state === "committed"/);
});
