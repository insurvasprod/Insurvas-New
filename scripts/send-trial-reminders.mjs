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
// Run with: npm run trials:remind   (add --dry to preview without recording)
import { createClient } from "@supabase/supabase-js";

import { dueReminders, reminderBody, REMINDER_LABELS } from "../lib/trials/reminders.ts";
import { calendarDaysUntil } from "../lib/trials/banner.ts";
import { sendTrialReminder } from "../lib/email/sendTrialReminder.ts";

const dryRun = process.argv.includes("--dry");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: trials } = await supabase.from("admin_trials_in_flight").select("*").order("days_remaining");

if (!trials?.length) {
  console.log("No trials in flight.");
  process.exit(0);
}

console.log(`${trials.length} trial(s) in flight${dryRun ? " (dry run)" : ""}\n`);

let sent = 0;
let skipped = 0;

for (const trial of trials) {
  const trialEndsAt = new Date(trial.trial_ends_at);

  // Only what was sent for THIS end date counts — an extension re-arms them on purpose.
  const { data: already } = await supabase
    .from("trial_reminders")
    .select("kind")
    .eq("subscription_id", trial.subscription_id)
    .eq("trial_ends_at", trial.trial_ends_at);

  const due = dueReminders(trialEndsAt, (already ?? []).map((r) => r.kind));

  if (due.length === 0) {
    skipped++;
    continue;
  }

  // Real figures, not placeholders — the ticket's criterion.
  const { data: plan } = await supabase
    .from("plans").select("id").eq("code", trial.plan_code).order("version", { ascending: false }).limit(1).single();
  const { data: prices } = await supabase
    .from("plan_prices").select("*").eq("plan_id", plan.id).maybeSingle();

  const column = { monthly: "price_monthly_cents", quarterly: "price_quarterly_cents", yearly: "price_yearly_cents" }[
    trial.billing_cycle
  ];
  const cents = prices?.[column] ?? 0;
  const priceLabel = `$${(cents / 100).toFixed(2)} / ${trial.billing_cycle.replace("ly", "")}`;

  for (const candidate of due) {
    const body = reminderBody(candidate.kind, {
      name: trial.owner_name ?? "there",
      businessName: trial.business_name,
      planName: trial.plan_name,
      priceLabel,
      // Counted here rather than taken from the view, whose ceil() reports "3 days" for a trial
      // ending in two days and one minute — the email would then name a date that contradicts it.
      daysRemaining: calendarDaysUntil(trialEndsAt, new Date()),
      trialEndsAt,
      hasLoggedIn: Boolean(trial.last_login_at),
    });

    console.log(`  ${trial.tenant_name.padEnd(28)} ${REMINDER_LABELS[candidate.kind].padEnd(12)} -> ${trial.owner_email}`);
    console.log(`     ${body.subject}`);

    if (dryRun) continue;

    // Recorded either way. The decision to send was made, and it must not be made twice — so a
    // failed delivery is written down as a failed delivery rather than left to be retried
    // forever. Chase a `delivered: false` row from the email log, which has the reason.
    const delivery = await sendTrialReminder({
      to: trial.owner_email,
      subject: body.subject,
      text: body.text,
      tenantId: trial.tenant_id,
      dedupeKey: `trial-${candidate.kind}-${trial.subscription_id}-${trial.trial_ends_at}`,
    });
    const delivered = delivery.delivered;
    if (!delivered) console.log(`     not delivered: ${delivery.reason}`);

    const { error } = await supabase.from("trial_reminders").insert({
      subscription_id: trial.subscription_id,
      kind: candidate.kind,
      due_at: candidate.dueAt.toISOString(),
      trial_ends_at: trial.trial_ends_at,
      delivered,
    });

    // 23505 means another run already sent it — the guarantee doing its job, not an error.
    if (error && error.code !== "23505") {
      console.error(`     could not record: ${error.message}`);
      continue;
    }
    if (!error) sent++;
  }
}

console.log(`\n${sent} reminder(s) sent, ${skipped} trial(s) had nothing due.`);
if (!dryRun && sent > 0) {
  console.log("Delivery is false for all of them: no email transport is configured yet (SA-4.11).");
}
