import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { emailButton, emailParagraph, emailShell, escapeHtml } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/transport";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { calendarDaysLeft } from "@/lib/trials/boardModel";
import { cardReminderEmail } from "@/lib/trials/cardReminder";

/**
 * POST /api/admin/trials/card-reminders — "Email a card reminder" on Admin › Billing › Trials (billing-r2 screen 3):
 * one email to each chosen trial's owner, asking them to add a card before the trial ends. Takes several trials
 * at once (the page's bulk bar), each sent and recorded on its own: one audit row per trial (trial.reminder_sent,
 * metadata.kind "card"), and the delivery log's dedupe key keeps a double click from sending twice the same day.
 *
 * Only trials still in flight with no card on file are sent; the rest come back as skipped with the reason.
 * Same roles as every trial action (CAN_MANAGE_SUBSCRIPTIONS).
 */

const schema = z.object({ subscriptionIds: z.array(z.string().uuid()).min(1, "Choose at least one trial").max(50, "Send at most 50 at a time") });

type Trial = {
  subscription_id: string;
  tenant_id: string;
  tenant_name: string;
  plan_name: string;
  trial_ends_at: string;
  owner_name: string | null;
  owner_email: string | null;
  business_name: string | null;
  has_payment_method: boolean | null;
};

function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.insurvas.com").trim().replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const ids = [...new Set(parsed.data.subscriptionIds)];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin_trials_in_flight is a view outside the generated types
  const db = getSupabaseServiceClient() as any;
  const { data, error } = await db.from("admin_trials_in_flight").select("subscription_id, tenant_id, tenant_name, plan_name, trial_ends_at, owner_name, owner_email, business_name, has_payment_method").in("subscription_id", ids);
  if (error) {
    console.error("[admin/trials] card reminders: could not read trials:", error.message);
    return NextResponse.json({ error: "The trials could not be read. Nothing was sent." }, { status: 500 });
  }
  const byId = new Map(((data ?? []) as Trial[]).map((row) => [row.subscription_id, row]));
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const billingUrl = `${appUrl()}/app/settings#billing`;

  const sent: string[] = [];
  const notDelivered: { id: string; reason: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    const trial = byId.get(id);
    if (!trial) { skipped.push({ id, reason: "no longer in trial" }); continue; }
    if (trial.has_payment_method) { skipped.push({ id, reason: "already has a card on file" }); continue; }
    if (!trial.owner_email) { skipped.push({ id, reason: "has no owner email" }); continue; }

    const business = trial.business_name?.trim() || trial.tenant_name;
    const email = cardReminderEmail({
      ownerName: trial.owner_name,
      businessName: business,
      planName: trial.plan_name,
      trialEndsAt: trial.trial_ends_at,
      daysLeft: calendarDaysLeft(trial.trial_ends_at, now),
      billingUrl,
    });
    const html = emailShell(
      escapeHtml(email.headline),
      emailParagraph(`Hi ${escapeHtml(trial.owner_name?.trim() || "there")},`) +
        emailParagraph(escapeHtml(email.paragraphs[0])) +
        emailParagraph(escapeHtml(email.paragraphs[1])) +
        emailButton(billingUrl, email.buttonLabel) +
        emailParagraph(escapeHtml(email.paragraphs[2])),
      { eyebrow: "Your trial", preheader: email.subject },
    );

    const delivery = await sendEmail({
      to: trial.owner_email,
      subject: email.subject,
      text: email.text,
      html,
      templateKey: "subscription.trial_ending",
      tenantId: trial.tenant_id,
      dedupeKey: `trial-card-reminder-${id}-${today}`,
    });

    await audit({
      actorId: auth.session.sub,
      action: "trial.reminder_sent",
      targetType: "subscription",
      targetId: id,
      metadata: { tenantId: trial.tenant_id, kind: "card", to: trial.owner_email, delivered: delivery.delivered, trialEndsAt: trial.trial_ends_at },
      request,
    });
    if (delivery.delivered) sent.push(id);
    else notDelivered.push({ id, reason: delivery.reason });
  }

  return NextResponse.json({ ok: true, sent: sent.length, notDelivered, skipped });
}
