// Seals every plain-text staff authenticator secret in admin_users.totp_secret (audit 2026-10-16).
//
//   npm run encrypt:admin-totp            dry run: counts what would change, writes nothing
//   npm run encrypt:admin-totp -- --apply seals each plain-text secret in place
//
// The secrets themselves do not change, so nobody re-enrols and every authenticator keeps working.
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and APPLICATION_DATA_ENCRYPTION_KEY —
// the same key the deployed app has, or the sealed secrets will not open there. Each row is
// written only if it still holds the plain value read, so a sign-in sealing it at the same moment
// is not overwritten. Safe to run again: sealed rows are skipped.
import { createClient } from "@supabase/supabase-js";

import { isSealedTotpSecret, openAdminTotpSecret, sealAdminTotpSecret } from "../lib/adminAuth/totpSecret.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");

if (!url || !serviceKey || !process.env.APPLICATION_DATA_ENCRYPTION_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or APPLICATION_DATA_ENCRYPTION_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data: rows, error } = await supabase.from("admin_users").select("id, email, totp_secret").order("email");
if (error) {
  console.error("Could not read admin_users:", error.message);
  process.exit(1);
}

let sealed = 0;
let plain = 0;
let unenrolled = 0;
let unreadable = 0;
for (const row of rows ?? []) {
  if (!row.totp_secret || !row.totp_secret.trim()) { unenrolled += 1; continue; }
  if (isSealedTotpSecret(row.totp_secret)) {
    if (openAdminTotpSecret(row.id, row.totp_secret)) sealed += 1;
    else { unreadable += 1; console.warn(`  does not open with this key: ${row.email}`); }
    continue;
  }
  plain += 1;
  if (!apply) continue;
  const { data: updated, error: writeError } = await supabase
    .from("admin_users")
    .update({ totp_secret: sealAdminTotpSecret(row.id, row.totp_secret) })
    .eq("id", row.id)
    .eq("totp_secret", row.totp_secret)
    .select("id");
  if (writeError) { console.error(`  could not seal ${row.email}: ${writeError.message}`); process.exitCode = 1; continue; }
  if (!updated?.length) console.warn(`  ${row.email} changed while this ran; left as it is now`);
}

console.log(`${rows?.length ?? 0} admin(s): ${sealed} already sealed, ${plain} plain text${apply ? " (sealed now)" : " (dry run, nothing written; pass --apply)"}, ${unenrolled} not enrolled, ${unreadable} sealed under another key.`);
