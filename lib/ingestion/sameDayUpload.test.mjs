import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// QA 2026-11-03: a second commission statement dated the same day silently replaced the first one
// (register_carrier_file keeps one current file per carrier, type and day), taking its lines out of the books.
test("a plain upload asks before it replaces the day's file; a corrected-file upload replaces as before", () => {
  const route = read("app/api/app/carrier-files/route.ts");
  assert.match(route, /if \(form\.get\("replace"\) !== "yes" && !separate\) \{[\s\S]*fileItWouldReplace\([\s\S]*code: "would_replace"[\s\S]*status: 409/);
  const registry = read("lib/ingestion/registry.ts");
  const fn = registry.slice(registry.indexOf("export async function fileItWouldReplace"), registry.indexOf("export async function uploadCarrierFile"));
  assert.match(fn, /\.is\("superseded_by_file_id", null\)/, "only the day's current file");
  assert.match(fn, /data\.content_hash === hash\) return null/, "the same bytes are skipped anyway, so they are not asked about");
  const dialog = read("components/app/carrier-file-upload.tsx");
  assert.match(dialog, /if \(replace \|\| preset\?\.fileDate\) form\.set\("replace", "yes"\)/, "Replace with a corrected file still replaces");
  assert.match(dialog, /Yes, it replaces it/);
  assert.match(dialog, /No, change the date/);
});

test("a different commission statement on the same day is kept beside it once 20261103300000 is live", () => {
  const sql = read("supabase/migrations/20261103300000_same_day_commission_statements.sql");
  assert.match(sql, /and file_type <> 'commissions';/, "the one-current-file index leaves commission files out");
  assert.match(sql, /p_replace boolean default true/, "every other door keeps replacing");
  assert.match(sql, /drop function if exists public\.register_carrier_file\(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text\);/, "one signature, so PostgREST sees one candidate");
  const registry = read("lib/ingestion/registry.ts");
  assert.match(registry, /\.\.\.\(args\.replace === false \? \{ p_replace: false \} : \{\}\)/, "p_replace is sent only when false");
  assert.match(registry, /SAME_DAY_PENDING_MESSAGE/);
  const route = read("app/api/app/carrier-files/route.ts");
  assert.match(route, /form\.get\("replace"\) === "no" && fields\.data\.file_type === "commissions"/, "only commission files sit beside the day's");
  assert.match(read("components/app/carrier-file-upload.tsx"), /It&apos;s a different statement/);
});

test("an accepted chargeback saves as accepted, and as dismissed before 20261103301000", () => {
  assert.match(read("supabase/migrations/20261103301000_discrepancy_accepted_resolution.sql"), /when 'accepted' then 'accepted'/);
  const store = read("lib/ingestion/discrepancyStore.ts");
  assert.match(store, /status === "accepted" && error\.code === "22023"[\s\S]*p_status: "dismissed"/);
  assert.match(read("components/app/book/needs-you/item-decide.tsx"), /status: "accepted", note: chargebackAcceptedNote\(note\)/);
});

test("a letter's next step is answered on the item: how it was sent, then what the carrier said", () => {
  const decide = read("components/app/book/needs-you/item-decide.tsx");
  assert.match(decide, /action: "mark_sent", dispute_id: letter\.id/);
  assert.match(decide, /action: "record_outcome", dispute_id: letter\.id, outcome: choice === "carrier_paid" \? "accepted" : "rejected"/);
  assert.match(read("lib/needsYou/store.ts"), /const letter = dispute \? \{ id: dispute\.id, status: dispute\.status, totalCents: dispute\.totalCents \} : null;/);
});

test("unknown-policy items read the per-policy orphan view when it exists (20261103303000)", () => {
  assert.match(read("supabase/migrations/20261103303000_commission_orphan_policies.sql"), /create or replace view public\.commission_orphan_policies/);
  const store = read("lib/needsYou/store.ts");
  assert.match(store, /from\("commission_orphan_policies"\)[\s\S]*\.lte\("first_seen", cutoff\)/);
  assert.match(store, /if \(policies === null\) \{/, "before the view, the lines are read as before");
  assert.match(read("supabase/migrations/20261103302000_sale_linked_policy_producer.sql"), /pm\.matched_to_type = 'deal_flow'/);
});