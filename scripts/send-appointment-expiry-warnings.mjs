// LA-0.5 · Run daily. Warnings are derived from the current expiry date, so renewal naturally
// stops the old warning and creates a new schedule. email_log.dedupe_key prevents repeat sends.
import { createClient } from "@supabase/supabase-js";

import { dueExpiryWarnings } from "../lib/appointments/warnings.ts";
import { sendExpiryWarning } from "../lib/email/sendExpiryWarning.ts";

const dryRun = process.argv.includes("--dry");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const asOf = process.env.APPOINTMENT_WARNING_DATE ?? new Date().toISOString().slice(0, 10);
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const [licenses, eoPolicies, ceRecords] = await Promise.all([
  supabase.from("licenses").select("id, tenant_id, state, license_number, expires_at, created_at, updated_at"),
  supabase.from("eo_policies").select("id, tenant_id, carrier, policy_number, expires_at, coverage_amount_cents, created_at, updated_at"),
  supabase.from("ce_records").select("id, tenant_id, state, credits_required, credits_completed, deadline, created_at, updated_at"),
]);
const failed = [licenses, eoPolicies, ceRecords].find((result) => result.error)?.error;
if (failed) throw new Error(`Could not load expiry records: ${failed.message}`);

const warnings = dueExpiryWarnings({ licenses: licenses.data ?? [], eoPolicies: eoPolicies.data ?? [], ceRecords: ceRecords.data ?? [] }, asOf);
if (warnings.length === 0) { console.log(`No appointment-vault warnings due on ${asOf}.`); process.exit(0); }

const tenantIds = [...new Set(warnings.map((warning) => (licenses.data ?? []).find((row) => row.id === warning.sourceId)?.tenant_id ?? (eoPolicies.data ?? []).find((row) => row.id === warning.sourceId)?.tenant_id ?? (ceRecords.data ?? []).find((row) => row.id === warning.sourceId)?.tenant_id))].filter(Boolean);
const { data: owners, error: ownersError } = await supabase.from("tenant_users").select("tenant_id, user_id, users!inner(id, name, email, status)").in("tenant_id", tenantIds).eq("role", "owner");
if (ownersError) throw new Error(`Could not load tenant owners: ${ownersError.message}`);

const candidates = warnings.flatMap((warning) => (owners ?? []).filter((owner) => owner.users?.status === "active").map((owner) => ({ warning, owner })));
const dedupeKeys = candidates.map(({ warning, owner }) => `appointment-expiry-${warning.source}-${warning.sourceId}-${warning.expiresAt}-${warning.days}-${owner.user_id}`);
const { data: already } = await supabase.from("email_log").select("dedupe_key").in("dedupe_key", dedupeKeys);
const sentKeys = new Set((already ?? []).map((row) => row.dedupe_key));

let sent = 0;
for (const { warning, owner } of candidates) {
  const dedupeKey = `appointment-expiry-${warning.source}-${warning.sourceId}-${warning.expiresAt}-${warning.days}-${owner.user_id}`;
  if (sentKeys.has(dedupeKey)) continue;
  const user = owner.users;
  console.log(`${warning.label} for ${user.email} — ${warning.days} days remaining`);
  if (dryRun) continue;
  const delivery = await sendExpiryWarning({ to: user.email, userId: user.id, tenantId: owner.tenant_id, name: user.name ?? "there", label: warning.label, days: warning.days, expiresAt: warning.expiresAt, settingsUrl: `${appUrl}/app/settings`, dedupeKey });
  console.log(`  ${delivery.delivered ? "delivered" : `not delivered: ${delivery.reason}`}`);
  sent++;
}

console.log(`\n${sent} appointment-vault warning(s) ${dryRun ? "would be sent" : "processed"}.`);
