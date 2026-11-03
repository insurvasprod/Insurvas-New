// SA-5.3 · Sends the trial reminders that are due.
//
// Meant to run daily. Idempotent by construction: a row is written for every reminder sent, keyed
// on (subscription, kind, trial_ends_at), so running twice — a retry, an overlapping cron, a
// manual run — cannot send anything twice. Extending a trial changes trial_ends_at, which
// deliberately re-arms the reminders for the NEW date.
//
// SA-4.11 landed, so these now actually send through the shared SMTP transport. The `delivered`
// column still records which it was: with no SMTP credentials configured the send is skipped and
// the row says so, rather than the reminder silently never going out.
//
// The logic lives in lib/trials/sendDueReminders.ts, shared with the scheduled
// /api/cron/trial-reminders route, so the two cannot drift.
//
// Run with: npm run trials:remind   (add --dry to preview without recording)
import { createClient } from "@supabase/supabase-js";

import { sendDueTrialReminders } from "../lib/trials/sendDueReminders.ts";

const dryRun = process.argv.includes("--dry");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const run = await sendDueTrialReminders(supabase, { dryRun, log: (line) => console.log(line) });

for (const failure of run.errors) console.error(`  ${failure}`);
if (!dryRun && run.notDelivered > 0) {
  console.log(`${run.notDelivered} of them were not delivered — see the email log for the reason.`);
}
if (run.errors.length) process.exit(1);
