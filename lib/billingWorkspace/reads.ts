import "server-only";

import { cache } from "react";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { readPlatformState } from "@/lib/adminAlerts/service";
import { listUsageMonitor } from "@/lib/creditsLimits/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { calendarDaysLeft } from "@/lib/trials/boardModel";
import type { NeedsInput } from "./needs";

/**
 * The reads behind the billing workspace's Needs you, its status line and the rail's badges
 * (GET /api/admin/billing/steps). One input, read once a request (React's `cache`), so the badge, the line and
 * the card can never disagree. Every read settles on its own: one failing query leaves its row "Couldn't check"
 * and its badge out, and the rest stand.
 *
 * The webhooks, billing run and trials are the staff alerts' minute-cached platform state, so the workspace and
 * the bell agree too. Read-only, all of it.
 */

// webhook_events and admin_trials_in_flight are not in the generated types; access stays untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

async function settle<T>(work: () => PromiseLike<T>, label: string): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    console.error(`[admin-billing] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

type Rows<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };
function rowsOf<T>(result: Rows<T>, label: string): T[] {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/;

async function readNeedsInput(adminId: string, role: AdminRole): Promise<NeedsInput> {
  const now = Date.now();
  const [state, pastDue, overdue, mismatched, notes, overLimit] = await Promise.all([
    settle(() => readPlatformState(now), "platform state"),
    settle(async () => {
      const subs = rowsOf<{ plan_id: string; billing_cycle: string }>(await db().from("subscriptions").select("plan_id, billing_cycle").eq("status", "past_due"), "past-due subscriptions");
      if (!subs.length) return { count: 0, atRiskCents: null };
      const prices = await db().from("plan_prices").select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents").in("plan_id", [...new Set(subs.map((s) => s.plan_id))]);
      if (prices.error) return { count: subs.length, atRiskCents: null };
      const by = new Map(((prices.data ?? []) as Record<string, number | string | null>[]).map((p) => [p.plan_id as string, p]));
      const atRisk = subs.reduce((sum, s) => sum + Number(by.get(s.plan_id)?.[`price_${s.billing_cycle}_cents`] ?? 0), 0);
      return { count: subs.length, atRiskCents: atRisk || null };
    }, "past due"),
    settle(async () => {
      const rows = rowsOf<{ total_cents: number }>(await db().from("platform_invoices").select("total_cents").eq("status", "overdue"), "overdue invoices");
      return { count: rows.length, owedCents: rows.reduce((sum, row) => sum + row.total_cents, 0) };
    }, "overdue invoices"),
    settle(async () => {
      const result = await db().from("platform_invoices").select("id", { count: "exact", head: true }).eq("reconciliation", "mismatched");
      if (result.error) throw new Error(result.error.message);
      return (result.count ?? 0) as number;
    }, "mismatched invoices"),
    settle(async () => rowsOf<{ requested_by: string | null }>(await db().from("credit_notes").select("requested_by").eq("status", "pending_approval"), "credit notes"), "credit notes"),
    // Only platform config and super admin open Credits & limits; no other role pays for the monitor's read.
    role === "super_admin" || role === "platform_config"
      ? settle(async () => new Set((await listUsageMonitor(true)).filter((row) => row.alert_level === "over" || row.alert_level === "exhausted").map((row) => row.tenant_id)).size, "usage limits")
      : Promise.resolve(null),
  ]);

  const nowDate = new Date(now);
  return {
    now,
    billingRun: state?.billingRun ? { ...state.billingRun, lastFinishedAt: state.billingRun.description.match(ISO)?.[0] ?? null } : null,
    stuckWebhooks: state?.stuckWebhooks ? { count: state.stuckWebhooks.count, oldestReceivedAt: state.stuckWebhooks.oldestReceivedAt } : null,
    pastDue,
    overdue,
    mismatched,
    trials: state?.trials ? state.trials.filter((trial) => trial.trialEndsAt).map((trial) => ({ daysLeft: calendarDaysLeft(trial.trialEndsAt as string, nowDate), hasPaymentMethod: Boolean(trial.hasPaymentMethod) })) : null,
    creditNotesToApprove: notes ? notes.filter((note) => note.requested_by !== adminId).length : null,
    creditNotesOwn: notes ? notes.filter((note) => note.requested_by === adminId).length : null,
    overLimit,
  };
}

/** The request's one read of the needs input, keyed on strings so every caller shares it. */
export const billingNeedsInput = cache((adminId: string, role: AdminRole) => readNeedsInput(adminId, role));
