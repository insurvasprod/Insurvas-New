// AG-0.8 · the rehearsal: what agency_upgrade_from_solo WOULD change for a tenant, read-only. Attach the numbers
// to the Notion task before running the upgrade for real. Needs migration 20261018160000.
//   node --env-file=.env.local scripts/agency/rehearse-upgrade.mjs <tenant-id>
import { createClient } from "@supabase/supabase-js";

const tenantId = process.argv[2];
if (!tenantId) { console.error("usage: rehearse-upgrade.mjs <tenant-id>"); process.exit(1); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.rpc("agency_upgrade_preview", { p_tenant_id: tenantId });
if (error) { console.error(error.message); process.exit(1); }
console.log(`AG-0.8 rehearsal for ${tenantId} — rows that would gain the owner as producer:`);
for (const [key, value] of Object.entries(data)) console.log(`  ${key.padEnd(20)} ${value}`);
