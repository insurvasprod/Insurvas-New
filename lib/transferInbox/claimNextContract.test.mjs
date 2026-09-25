import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const migration = await read("supabase/migrations/20260924335100_claim_next_transfer.sql");
const inbox = await read("supabase/migrations/20260924250000_transfer_inbox_claimed_means_with_an_agent.sql");
const route = await read("app/api/app/inbound/claim-next/route.ts");
const component = await read("components/app/transfer-inbox.tsx");

test("claim next picks the oldest waiting inbound row under a skip-locked lock, then claims through the one claim path", () => {
  assert.match(migration, /and q\.partner_id is not null/);
  assert.match(migration, /and q\.status = 'unclaimed'/);
  assert.match(migration, /order by q\.queued_at asc, q\.id asc\s+limit 1\s+for update of q skip locked;/);
  assert.match(migration, /raise exception using errcode = 'P0002', message = 'NO_TRANSFER_WAITING';/);
  assert.match(migration, /return public\.claim_transfer_lead\(p_tenant_id, v_work_item_id, p_user_id, p_owner_role\);/);
  assert.doesNotMatch(migration, /update public\.lead_queue/i, "the claim itself belongs to claim_transfer_lead");
});

test("its filters are the inbox's own, spelled the same way", () => {
  for (const clause of [
    "(p_partner_id is null or q.partner_id = p_partner_id)",
    "(p_product_line is null or q.product_line = p_product_line)",
    "(p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)",
    "(p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)",
  ]) {
    assert.ok(inbox.includes(clause), `list_transfer_inbox no longer filters with: ${clause}`);
    assert.ok(migration.includes(clause), `claim_next_transfer does not filter with: ${clause}`);
  }
});

test("service role only, and the route keeps Claim transfer's roles and write gate", () => {
  assert.match(migration, /revoke all on function public\.claim_next_transfer\(uuid, uuid, text, uuid, text, text, text\) from public, anon, authenticated, tenant_app;/);
  assert.match(migration, /grant execute on function public\.claim_next_transfer\(uuid, uuid, text, uuid, text, text, text\) to service_role;/);
  assert.match(migration, /raise exception 'claim_next_transfer is callable from the browser'/);
  assert.match(route, /requireFeatureRole\("inbound_transfers", \["owner", "producer", "assistant"\], \{ write: true \}\)/);
  assert.match(route, /announceTransferClaim\(/);
  assert.match(route, /\.strict\(\)/);
});

test("the inbox sends its filters and routes to verification like Claim transfer", () => {
  assert.match(component, /fetch\("\/api\/app\/inbound\/claim-next"/);
  assert.match(component, /router\.push\(`\/app\/inbound\/\$\{workItemId\}\/verification`\)/);
  assert.match(component, /router\.push\(`\/app\/inbound\/\$\{id\}\/verification`\)/);
  assert.match(component, /response\.status === 409/);
});
