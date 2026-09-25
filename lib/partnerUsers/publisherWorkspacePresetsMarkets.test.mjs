import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("publisher workspace stores immutable presets and private market profiles", async () => {
  const migration = await source(
    "supabase/migrations/20260916130000_partner_presets_and_market_access.sql",
  );
  assert.match(
    migration,
    /create table if not exists public\.partner_form_presets/i,
  );
  assert.match(
    migration,
    /create table if not exists public\.partner_form_preset_revisions/i,
  );
  assert.match(
    migration,
    /create table if not exists public\.partner_market_access_profile_revisions/i,
  );
  assert.match(migration, /revoke all on table public\.partner_form_presets/i);
  assert.match(
    migration,
    /grant execute on function public\.save_partner_market_access_profile_revision/i,
  );
});

test("the portal requires server-resolved markets and keeps configured catalog fields scoped", async () => {
  const [portal, leads, templateService] = await Promise.all([
    source("components/partner/partner-portal-workspace.tsx"),
    source("app/api/partner/leads/route.ts"),
    source("lib/agentTemplates/service.ts"),
  ]);
  assert.match(portal, /api\/partner\/markets/);
  assert.match(portal, /carrier_id: market\.carrier_id/);
  assert.match(leads, /assertPartnerMarketAccess/);
  assert.match(templateService, /Additional information/);
});
