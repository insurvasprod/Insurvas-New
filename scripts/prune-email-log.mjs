// SA-4.11 scopes the delivery log to 30 days. This is what enforces it — run from cron, not a
// trigger, so deleting delivery evidence is always something somebody chose to do.
import { createClient } from "@supabase/supabase-js";

const days = Number(process.argv[2] ?? 30);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await supabase.rpc("prune_email_log", { p_days: days });
if (error) { console.error(error.message); process.exit(1); }
console.log(`Removed ${data} email log row(s) older than ${days} days.`);
