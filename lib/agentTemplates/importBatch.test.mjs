import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyImportFailure, IMPORT_UNAVAILABLE_MESSAGE } from "./errors.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260914160000_la_2_2_atomic_lead_import.sql", import.meta.url), "utf8");
const compatibilityFix = readFileSync(new URL("../../supabase/migrations/20260914193000_la_2_2_import_actor_membership_fix.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");

test("LA-2.2 import commit is one service-only database transaction", () => {
  assert.match(migration, /create or replace function public\.import_agent_lead_batch/);
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path = public, pg_catalog/is);
  assert.match(migration, /for update/);
  assert.match(migration, /import_agent_lead_source/);
  assert.match(migration, /revoke all on function public\.import_agent_lead_batch/);
  assert.match(migration, /grant execute on function public\.import_agent_lead_batch.*service_role/);
  const importBody = service.slice(service.indexOf("export async function importAgentLeads"), service.indexOf("export async function updateAgentLead"));
  // Both import paths commit through importCommit.ts (LA-2.2-9): the one-transaction function, or
  // import_agent_lead_batch before its migration.
  assert.match(importBody, /commitLeadImport\(\{/);
  assert.doesNotMatch(importBody, /\.from\("agent_leads"\)\.insert/);
  const writer = readFileSync(new URL("./importCommit.ts", import.meta.url), "utf8");
  assert.match(writer, /rpc\("commit_reviewed_lead_import"/);
  assert.match(writer, /rpc\("import_agent_lead_batch"/);
  assert.doesNotMatch(writer, /\.from\("agent_leads"\)\.insert/);
});

test("LA-2.2 actor validation follows the live tenant membership bridge", () => {
  assert.match(compatibilityFix, /from public\.tenant_users tu\s+join public\.users u on u\.id = tu\.user_id/);
  assert.match(compatibilityFix, /tu\.tenant_id = p_tenant_id/);
  assert.doesNotMatch(compatibilityFix, /users\s+where id = p_created_by and tenant_id = p_tenant_id/);
  assert.match(compatibilityFix, /set search_path = public, pg_catalog/);
});

test("LA-2.2 database-contract failures use a safe unavailable response", () => {
  const failure = classifyImportFailure(new Error('column "tenant_id" does not exist'));
  // `cause` carries the original text for the operator. The user-facing `message` must still give
  // nothing away, which is what the doesNotMatch below is for — the two are checked separately
  // because they serve opposite audiences.
  assert.deepEqual(failure, {
    code: "import_unavailable",
    message: IMPORT_UNAVAILABLE_MESSAGE,
    status: 503,
    cause: 'column "tenant_id" does not exist',
  });
  assert.doesNotMatch(failure.message, /tenant_id|postgres|column/i);

  for (const error of [
    new Error("Could not find the function public.record_campaign_scrub_rejections in the schema cache"),
    new Error('relation "public.tenant_campaign_costs" does not exist'),
  ]) {
    assert.deepEqual(classifyImportFailure(error), {
      code: "import_unavailable",
      message: IMPORT_UNAVAILABLE_MESSAGE,
      status: 503,
      cause: error.message,
    });
  }
});

test("LA-2.2 a contract failure is written down, not only handled", () => {
  // The cause must survive classification. Before this, all three import routes classified the
  // error and dropped it in the same expression, so a missing relation produced a 503 that told the
  // user to retry a permanent fault and told the operator nothing whatsoever.
  const original = "Could not find the table 'public.tenant_campaign_costs' in the schema cache";
  assert.equal(classifyImportFailure(new Error(original)).cause, original);

  // An ordinary business-rule refusal is NOT a contract failure: the function's own guards come back
  // as bare codes (verified against the live RPC — `IMPORT_BATCH_SIZE_INVALID` and friends), and
  // turning those into "try again later" would be wrong in the other direction.
  const refusal = classifyImportFailure(new Error("IMPORT_BATCH_SIZE_INVALID"));
  assert.equal(refusal.code, "import_failed");
  assert.equal(refusal.status, 400);
  assert.equal(refusal.message, "IMPORT_BATCH_SIZE_INVALID");
});
