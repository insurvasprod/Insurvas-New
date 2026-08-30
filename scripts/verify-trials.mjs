// SA-5.3 acceptance: the trials screen's data, the three admin actions, and the reminder schedule.
//
// Drives the real HTTP route with a minted admin session against throwaway tenants, so the
// permission check, the RPC, the audit write and the entitlement rebuild are all exercised as they
// run in production. The trial subscriptions here have no whop_membership_id, so no sandbox
// membership is touched — the provider leg of extend/cancel is verified separately by inspection
// (backlog), since pausing a real membership is not reversible from a test.
//
// Needs the app running. Everything created is removed. Run: npm run verify:trials
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

import { dueReminders, reminderBody, dueAtFor } from "../lib/trials/reminders.ts";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const DAY = 86_400_000;
const made = { tenants: [], users: [], admins: [] };

const { data: superAdmin } = await supabase
  .from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).single();

const { data: supportAdmin } = await supabase
  .from("admin_users")
  .insert({
    email: `verify-trials-${stamp}@insurvas.invalid`,
    name: "Verification Support Agent",
    role: "support_agent",
    password_hash: "x", totp_secret: "x", is_active: true,
  })
  .select("id").single();
made.admins.push(supportAdmin.id);

const sign = async (adminId, role) =>
  `insurvas_admin_session=${await new SignJWT({ role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET))}`;

const adminCookie = await sign(superAdmin.id, "super_admin");
const supportCookie = await sign(supportAdmin.id, "support_agent");

const { data: plan } = await supabase
  .from("plans").select("id").eq("code", "plan_a").order("version", { ascending: false }).limit(1).single();

/** A trialing tenant with an owner, optionally one who has signed in. */
async function makeTrial(label, { daysLeft, hasLoggedIn }) {
  const { data: user } = await supabase
    .from("users")
    .insert({
      email: `trial_${label}_${stamp}@insurvas.test`,
      name: `Trial ${label}`,
      password_hash: "x",
      status: "active",
      last_login_at: hasLoggedIn ? new Date().toISOString() : null,
    })
    .select("id").single();

  const { data: tenant } = await supabase
    .from("tenants").insert({ name: `Trial ${label} ${stamp}`, status: "active" }).select("id").single();

  await supabase.from("tenant_users").insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

  const trialEndsAt = new Date(Date.now() + daysLeft * DAY);
  const { data: sub } = await supabase
    .from("subscriptions")
    .insert({
      tenant_id: tenant.id,
      plan_id: plan.id,
      status: "trialing",
      billing_cycle: "monthly",
      started_at: new Date(Date.now() - (14 - daysLeft) * DAY).toISOString(),
      trial_ends_at: trialEndsAt.toISOString(),
      current_period_start: new Date().toISOString(),
      current_period_end: trialEndsAt.toISOString(),
    })
    .select("id").single();

  made.tenants.push(tenant.id);
  made.users.push(user.id);
  return { tenantId: tenant.id, userId: user.id, subscriptionId: sub.id, trialEndsAt };
}

async function cleanup() {
  for (const id of made.tenants) {
    const { data: subs } = await supabase.from("subscriptions").select("id").eq("tenant_id", id);
    for (const s of subs ?? []) await supabase.from("trial_reminders").delete().eq("subscription_id", s.id);
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", id);
    await supabase.from("subscriptions").delete().eq("tenant_id", id);
    await supabase.from("tenant_users").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  for (const id of made.users) await supabase.from("users").delete().eq("id", id);
  for (const id of made.admins) {
    await supabase.from("audit_log").delete().eq("actor_id", id);
    await supabase.from("admin_users").delete().eq("id", id);
  }
}

const act = (subscriptionId, cookie, body) =>
  fetch(`${BASE}/api/admin/trials/${subscriptionId}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

try {
  console.log("The screen's data\n");

  const engaged = await makeTrial("engaged", { daysLeft: 9, hasLoggedIn: true });
  const dormant = await makeTrial("dormant", { daysLeft: 2, hasLoggedIn: false });

  const { data: rows } = await supabase
    .from("admin_trials_in_flight").select("*").order("days_remaining", { ascending: true });

  const mine = (rows ?? []).filter((r) => made.tenants.includes(r.tenant_id));
  check("both trials appear in the in-flight view", mine.length === 2, `${mine.length} found`);
  check("sorted soonest-to-end first", mine[0]?.subscription_id === dormant.subscriptionId,
        "the one with 2 days left must lead");
  check("days remaining is computed, not stored", mine[0]?.days_remaining === 2, String(mine[0]?.days_remaining));
  check("days elapsed adds up to the trial length",
        mine[0]?.days_elapsed + mine[0]?.days_remaining === 14,
        `${mine[0]?.days_elapsed} + ${mine[0]?.days_remaining}`);
  check("the owner's email is on the row", mine[0]?.owner_email?.includes(`${stamp}`), String(mine[0]?.owner_email));
  check("the engagement signal is real, not invented",
        mine.find((r) => r.subscription_id === engaged.subscriptionId)?.last_login_at !== null &&
        mine.find((r) => r.subscription_id === dormant.subscriptionId)?.last_login_at === null,
        "one has signed in, one has not, and the view distinguishes them");
  check("no card on file reads as no card on file",
        mine[0]?.has_payment_method === false, String(mine[0]?.has_payment_method));

  console.log("\nWho may touch a trial\n");

  const refused = await act(engaged.subscriptionId, supportCookie, {
    action: "extend", days: 7, reason: "should never happen",
  });
  check("a support_agent cannot extend a trial", refused.status === 403, String(refused.status));

  const anon = await act(engaged.subscriptionId, "", { action: "cancel", reason: "no session at all" });
  check("no session cannot either", anon.status === 401, String(anon.status));

  const noReason = await act(engaged.subscriptionId, adminCookie, { action: "extend", days: 7, reason: "hm" });
  check("an extension without a real reason is rejected", noReason.status === 400, String(noReason.status));

  const silly = await act(engaged.subscriptionId, adminCookie, { action: "extend", days: 400, reason: "far too long" });
  check("a 400-day extension is rejected", silly.status === 400, String(silly.status));

  console.log("\nExtending\n");

  const before = new Date(
    (await supabase.from("subscriptions").select("trial_ends_at").eq("id", engaged.subscriptionId).single())
      .data.trial_ends_at,
  );

  const extended = await act(engaged.subscriptionId, adminCookie, {
    action: "extend", days: 7, reason: "Onboarding call slipped a week",
  });
  const extendedBody = await extended.json();
  check("an extension is accepted", extended.status === 200, JSON.stringify(extendedBody).slice(0, 160));

  const { data: afterExtend } = await supabase
    .from("subscriptions").select("trial_ends_at, current_period_end").eq("id", engaged.subscriptionId).single();
  const after = new Date(afterExtend.trial_ends_at);
  check("trial_ends_at moved exactly 7 days",
        Math.round((after - before) / DAY) === 7, `${(after - before) / DAY} days`);
  check("the period end moved with it — the charge date, not just the label",
        new Date(afterExtend.current_period_end).getTime() === after.getTime(),
        `${afterExtend.current_period_end} vs ${afterExtend.trial_ends_at}`);

  const { data: auditRow } = await supabase
    .from("audit_log").select("action, reason, metadata")
    .eq("target_id", engaged.subscriptionId).eq("action", "trial.extended").maybeSingle();
  check("the extension is in the audit log with its reason",
        auditRow?.reason === "Onboarding call slipped a week", JSON.stringify(auditRow));

  console.log("\nReminders follow the trial, they are not pinned to a date\n");

  // The whole point of defining offsets from the END: an extension re-arms them, with no code
  // that has to remember to move anything.
  const endsIn3 = new Date(Date.now() + 3 * DAY);
  check("a trial with 3 days left is due the 4-day note",
        dueReminders(endsIn3, []).some((r) => r.kind === "four_days_left"), "the window has opened");
  check("but not the final-day note yet",
        !dueReminders(endsIn3, []).some((r) => r.kind === "final_day"), "that is a day out still");
  check("an already-sent reminder is not due again",
        dueReminders(endsIn3, ["four_days_left"]).length === 0, "idempotent by kind");

  const oldEnd = new Date(Date.now() + 1 * DAY);
  const newEnd = new Date(Date.now() + 8 * DAY);
  check("extending un-dues everything that was due",
        dueReminders(oldEnd, []).length === 2 && dueReminders(newEnd, []).length === 0,
        "the reminders moved with the end date, by construction");
  check("the 4-day note is dated 4 days before the end",
        Math.round((newEnd - dueAtFor(newEnd, "four_days_left")) / DAY) === 4, "offset from the end, not the start");
  check("a finished trial gets no reminders at all",
        dueReminders(new Date(Date.now() - DAY), []).length === 0, "nothing to remind about");

  const body = reminderBody("final_day", {
    name: "Sam", businessName: "Sam Insurance", planName: "Plan A",
    priceLabel: "$99.00 / month", daysRemaining: 1, trialEndsAt: newEnd, hasLoggedIn: true,
  });
  check("the reminder carries the customer's real figures, not placeholders",
        body.text.includes("$99.00 / month") && body.text.includes("Plan A") && body.text.includes("Sam Insurance"),
        body.text.slice(0, 120));

  const dormantBody = reminderBody("four_days_left", {
    name: "Alex", businessName: null, planName: "Plan A",
    priceLabel: "$99.00 / month", daysRemaining: 4, trialEndsAt: newEnd, hasLoggedIn: false,
  });
  check("someone who never signed in gets a different message",
        dormantBody.text !== body.text && /sign in/i.test(dormantBody.text), dormantBody.subject);

  // The DB guarantee behind the pure logic: the same reminder cannot be recorded twice.
  const reminderRow = {
    subscription_id: dormant.subscriptionId,
    kind: "four_days_left",
    due_at: new Date().toISOString(),
    trial_ends_at: dormant.trialEndsAt.toISOString(),
    delivered: false,
  };
  await supabase.from("trial_reminders").insert(reminderRow);
  const { error: dupe } = await supabase.from("trial_reminders").insert(reminderRow);
  check("the database refuses a duplicate reminder", dupe?.code === "23505", dupe?.code ?? "it was accepted");

  console.log("\nConverting early\n");

  const cantCharge = await act(dormant.subscriptionId, adminCookie, { action: "convert" });
  const cantBody = await cantCharge.json();
  check("converting with no card on file is refused, clearly",
        cantCharge.status === 409 && /card|customer/i.test(cantBody.error ?? ""), JSON.stringify(cantBody));

  const { data: stillTrialing } = await supabase
    .from("subscriptions").select("status").eq("id", dormant.subscriptionId).single();
  check("and the subscription is untouched by the refusal", stillTrialing.status === "trialing", stillTrialing.status);

  console.log("\nCancelling\n");

  const cancelled = await act(dormant.subscriptionId, adminCookie, {
    action: "cancel", reason: "Customer asked to stop before billing",
  });
  check("a trial can be cancelled", cancelled.status === 200, String(cancelled.status));

  const { data: afterCancel } = await supabase
    .from("subscriptions").select("status, cancel_reason").eq("id", dormant.subscriptionId).single();
  check("it is recorded as cancelled with the reason",
        afterCancel.status === "cancelled" && afterCancel.cancel_reason.startsWith("Customer asked"),
        JSON.stringify(afterCancel));

  const { data: ent } = await supabase
    .from("tenant_entitlements").select("entitlement").eq("tenant_id", dormant.tenantId).maybeSingle();
  check("the entitlement was rebuilt, so access reflects it immediately",
        ent !== null && ent.entitlement.access !== "full",
        `access=${ent?.entitlement?.access ?? "no entitlement row"}`);

  const gone = await act(dormant.subscriptionId, adminCookie, { action: "extend", days: 7, reason: "too late now" });
  check("a cancelled trial cannot then be extended", gone.status === 409, String(gone.status));

  const { data: afterAll } = await supabase
    .from("admin_trials_in_flight").select("subscription_id").eq("subscription_id", dormant.subscriptionId);
  check("and it leaves the in-flight list", (afterAll ?? []).length === 0, `${(afterAll ?? []).length} rows`);
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nAll trial checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
