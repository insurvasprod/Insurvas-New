import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { expectedPayOn, PARTNER_PAYMENT_METHOD_LABELS, type PartnerPaymentMethod } from "@/lib/accounting/partnerPayoutCore";
import { ITEM_LABELS } from "@/lib/accounting/payoutsCore";
import { ledgerLive, partnerStatementFor } from "@/lib/accounting/payoutStore";
import { loadAccountingSettings } from "@/lib/accounting/settingsStore";
import { startOfTodayIn } from "./counters";
import { attemptSummary, breakdownLines, liveFacts, readyCount, type AttemptSummary, type BreakdownLine, type LiveFact } from "./phoneFactsCore";

/**
 * Reads behind the partner phone app's extra facts (phoneFactsCore.ts says what each one may carry).
 * Every read names the session's tenant, and every queue read the session's partner too; the callers
 * pass only work items and leads the partner-scoped reads already returned. A failed read leaves the
 * fact out — never a failed page, never a wider answer.
 */
// The SLA, presence and payout-profile columns are not all in the generated types; keep the reads loose here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const chunks = <T,>(items: T[], size = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Per work item on the page: the claimer's first name, when it was claimed, and the next open callback. */
export async function pipelineLiveFacts(tenantId: string, partnerId: string, workItemIds: string[]): Promise<Record<string, LiveFact>> {
  const ids = [...new Set(workItemIds)].slice(0, 1000);
  if (!ids.length) return {};
  try {
    const parts = chunks(ids);
    const [queues, callbacks] = await Promise.all([
      Promise.all(parts.map((part) => db().from("lead_queue").select("id, claimed_at, owner_user_id, claimed_by").eq("tenant_id", tenantId).eq("partner_id", partnerId).in("id", part))),
      Promise.all(parts.map((part) => db().from("tenant_callbacks").select("work_item_id, scheduled_at_utc").eq("tenant_id", tenantId).in("work_item_id", part).in("status", ["scheduled", "due"]))),
    ]);
    const failed = [...queues, ...callbacks].find((r: Loose) => r.error);
    if (failed) { console.error(`[partner-phone] live facts failed: ${failed.error.message}`); return {}; }
    const queueRows = queues.flatMap((r: Loose) => r.data ?? []);
    // Callbacks are kept only for work items the partner-scoped queue read returned.
    const own = new Set(queueRows.map((q: Loose) => q.id as string));
    const callbackRows = callbacks.flatMap((r: Loose) => r.data ?? []).filter((c: Loose) => own.has(c.work_item_id));
    const holders = [...new Set(queueRows.flatMap((q: Loose) => [q.owner_user_id, q.claimed_by]).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (holders.length) {
      const users = await db().from("users").select("id, name").in("id", holders);
      if (!users.error) for (const u of users.data ?? []) if (u.name) names.set(u.id, u.name);
    }
    return liveFacts(queueRows, names, callbackRows);
  } catch (error) {
    console.error(`[partner-phone] live facts failed: ${error instanceof Error ? error.message : error}`);
    return {};
  }
}

/** One lead's extras: dialer attempts (count and span) and how many agents are ready now. */
export async function leadPhoneFacts(tenantId: string, leadId: string): Promise<{ attempts: AttemptSummary | null; agentsReady: number | null }> {
  const [attempts, presence] = await Promise.all([
    db().from("tenant_call_attempts").select("attempted_at").eq("tenant_id", tenantId).eq("lead_id", leadId).limit(500).then((r: Loose) => (r.error ? null : r.data ?? []), () => null),
    db().from("agent_presence").select("status, last_seen_at").eq("tenant_id", tenantId).then((r: Loose) => (r.error ? null : r.data ?? []), () => null),
  ]);
  return { attempts: attempts ? attemptSummary(attempts) : null, agentsReady: presence ? readyCount(presence) : null };
}

/** The first moment of this month in the partner's timezone. */
function monthStartIn(zone: string): Date {
  const today = startOfTodayIn(zone);
  let day = 1;
  try { day = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, day: "numeric" }).format(new Date())); } catch { day = new Date().getUTCDate(); }
  // Noon on the first, then that day's midnight in the zone, so a daylight-saving change cannot shift it.
  return startOfTodayIn(zone, today.getTime() - (day - 1) * 86_400_000 + 12 * 3_600_000);
}

/** Leads each member submitted this month (partner timezone), by user id. Missing when a count failed. */
export async function sentThisMonth(tenantId: string, partnerId: string, userIds: string[], zone: string): Promise<Record<string, number>> {
  const since = monthStartIn(zone).toISOString();
  const out: Record<string, number> = {};
  await Promise.all([...new Set(userIds)].slice(0, 100).map(async (userId) => {
    const { count, error } = await db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("created_by", userId).gte("created_at", since);
    if (!error && typeof count === "number") out[userId] = count;
  }));
  return out;
}

export type PayoutFacts = {
  /** How the agency pays this partner ("Bank transfer"), from the partner's payout profile. */
  method: string | null;
  /** When each published, unpaid statement is expected to be paid, by run id (the invoice PDF's own rule). */
  expectedOn: Record<string, string>;
  /** The next statement's per-unit lines: "41 sold leads × $95 + 12 transfers × $35". */
  next: { runId: string; lines: BreakdownLine[]; revenueShareCents: number | null } | null;
};

export async function partnerPayoutFacts(tenantId: string, partnerId: string, runs: Array<{ id: string; status: string; periodEnd: string; netCents: number }>): Promise<PayoutFacts> {
  const facts: PayoutFacts = { method: null, expectedOn: {}, next: null };
  try {
    const live = await ledgerLive();
    const [profile, settings] = await Promise.all([
      live ? db().from("partner_payout_profile").select("payment_method, cadence").eq("tenant_id", tenantId).eq("partner_id", partnerId).maybeSingle().then((r: Loose) => (r.error ? null : r.data), () => null) : Promise.resolve(null),
      loadAccountingSettings(tenantId).catch(() => null),
    ]);
    const method = profile?.payment_method as PartnerPaymentMethod | undefined;
    facts.method = method ? PARTNER_PAYMENT_METHOD_LABELS[method] ?? null : null;
    const cadence = profile?.cadence ?? settings?.payoutCadence ?? "monthly";
    for (const run of runs) if (run.status === "published" && run.netCents > 0) facts.expectedOn[run.id] = expectedPayOn(cadence, run.periodEnd, run.periodEnd, 0);
    const next = runs.find((r) => r.status === "published");
    if (next) {
      const statement = await partnerStatementFor(tenantId, partnerId, next.id).catch(() => null);
      if (statement) facts.next = { runId: next.id, lines: breakdownLines(statement.lines, ITEM_LABELS), revenueShareCents: statement.revenueShare?.amountCents ?? null };
    }
  } catch (error) {
    console.error(`[partner-phone] payout facts failed: ${error instanceof Error ? error.message : error}`);
  }
  return facts;
}
