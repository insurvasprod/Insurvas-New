// SA-5.3 · Sends the trial reminders that are due — the one implementation behind both
// `npm run trials:remind` (scripts/send-trial-reminders.mjs) and the scheduled
// /api/cron/trial-reminders route.
//
// Idempotent by construction, exactly as the script always was: a row is written for every reminder
// sent, keyed on (subscription, kind, trial_ends_at), so running twice — a retry, an overlapping
// cron, a manual run — cannot record anything twice, and the delivery's dedupe key is that same
// tuple. Extending a trial changes trial_ends_at, which deliberately re-arms the reminders for the
// NEW date.
//
// The Supabase client is an argument and nothing here is `server-only`, with relative `.ts` value
// imports, so plain Node can load it from the script — the same arrangement as lib/billing/collect.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

import { dueReminders, reminderBody, REMINDER_LABELS, type TrialReminderKind } from "./reminders.ts";
import { calendarDaysUntil } from "./banner.ts";
import { sendTrialReminder } from "../email/sendTrialReminder.ts";

type TrialInFlight = {
  subscription_id: string;
  tenant_id: string;
  tenant_name: string;
  trial_ends_at: string;
  plan_code: string;
  plan_name: string;
  billing_cycle: "monthly" | "quarterly" | "yearly";
  owner_name: string | null;
  owner_email: string;
  business_name: string | null;
  last_login_at: string | null;
};

export type TrialReminderRun = {
  trials: number;
  /** Reminders recorded by this run. */
  sent: number;
  /** Of those, how many the transport did not deliver (the row says so; chase it in the email log). */
  notDelivered: number;
  /** Trials with nothing due. */
  skipped: number;
  /** Per-reminder failures that were not recorded; the next run picks them up again. */
  errors: string[];
};

const PRICE_COLUMN = { monthly: "price_monthly_cents", quarterly: "price_quarterly_cents", yearly: "price_yearly_cents" } as const;

export async function sendDueTrialReminders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the script passes an untyped client; the view and table are read loosely
  supabase: SupabaseClient<any>,
  options: { dryRun?: boolean; log?: (line: string) => void; now?: Date } = {},
): Promise<TrialReminderRun> {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();

  const { data, error: trialsError } = await supabase.from("admin_trials_in_flight").select("*").order("days_remaining");
  if (trialsError) throw new Error(`Could not read the trials in flight: ${trialsError.message}`);
  const trials = (data ?? []) as TrialInFlight[];

  const run: TrialReminderRun = { trials: trials.length, sent: 0, notDelivered: 0, skipped: 0, errors: [] };
  if (trials.length === 0) {
    log("No trials in flight.");
    return run;
  }
  log(`${trials.length} trial(s) in flight${options.dryRun ? " (dry run)" : ""}\n`);

  for (const trial of trials) {
    const trialEndsAt = new Date(trial.trial_ends_at);

    // Only what was sent for THIS end date counts — an extension re-arms them on purpose.
    const { data: already, error: alreadyError } = await supabase
      .from("trial_reminders")
      .select("kind")
      .eq("subscription_id", trial.subscription_id)
      .eq("trial_ends_at", trial.trial_ends_at);
    if (alreadyError) {
      // Unknown means unknown: sending now could send a reminder twice.
      run.errors.push(`${trial.subscription_id}: could not read reminders already sent (${alreadyError.message})`);
      continue;
    }

    const due = dueReminders(trialEndsAt, ((already ?? []) as { kind: TrialReminderKind }[]).map((r) => r.kind), now);
    if (due.length === 0) {
      run.skipped++;
      continue;
    }

    // Real figures, not placeholders — the ticket's criterion.
    const { data: plan } = await supabase
      .from("plans").select("id").eq("code", trial.plan_code).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!plan) {
      run.errors.push(`${trial.subscription_id}: plan ${trial.plan_code} not found`);
      continue;
    }
    const { data: prices } = await supabase.from("plan_prices").select("*").eq("plan_id", plan.id).maybeSingle();
    const cents = Number((prices as Record<string, unknown> | null)?.[PRICE_COLUMN[trial.billing_cycle]] ?? 0);
    const priceLabel = `$${(cents / 100).toFixed(2)} / ${trial.billing_cycle.replace("ly", "")}`;

    for (const candidate of due) {
      const body = reminderBody(candidate.kind, {
        name: trial.owner_name ?? "there",
        businessName: trial.business_name,
        planName: trial.plan_name,
        priceLabel,
        // Counted here rather than taken from the view, whose ceil() reports "3 days" for a trial
        // ending in two days and one minute — the email would then name a date that contradicts it.
        daysRemaining: calendarDaysUntil(trialEndsAt, now),
        trialEndsAt,
        hasLoggedIn: Boolean(trial.last_login_at),
      });

      log(`  ${trial.tenant_name.padEnd(28)} ${REMINDER_LABELS[candidate.kind].padEnd(12)} -> ${trial.owner_email}`);
      log(`     ${body.subject}`);

      if (options.dryRun) continue;

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
      if (!delivery.delivered) log(`     not delivered: ${delivery.reason}`);

      const { error } = await supabase.from("trial_reminders").insert({
        subscription_id: trial.subscription_id,
        kind: candidate.kind,
        due_at: candidate.dueAt.toISOString(),
        trial_ends_at: trial.trial_ends_at,
        delivered,
      });

      // 23505 means another run already sent it — the guarantee doing its job, not an error.
      if (error && error.code !== "23505") {
        log(`     could not record: ${error.message}`);
        run.errors.push(`${trial.subscription_id}/${candidate.kind}: could not record (${error.message})`);
        continue;
      }
      if (!error) {
        run.sent++;
        if (!delivered) run.notDelivered++;
      }
    }
  }

  log(`\n${run.sent} reminder(s) sent, ${run.skipped} trial(s) had nothing due.`);
  return run;
}
