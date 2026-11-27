import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { advanceMonthsByCarrier, CHARGEBACK_TYPES, policyMonth, teamFacts, type TeamFact } from "./payFactsCore";

/**
 * Reads behind payFactsCore for the phone's pay screens (boards G1, G2, G4). Every read is tenant-scoped and only
 * reads; a table this database does not have yet leaves its fact out (an empty answer), never fails the screen.
 */
type Loose = Record<string, unknown>;
// The generated database types do not list every table these read; the reads only select named columns.
const db = () => getSupabaseServiceClient() as unknown as { from(t: string): { select(c: string): Q } };
type Q = { eq(c: string, v: unknown): Q; in(c: string, v: unknown[]): Q; gte(c: string, v: unknown): Q; lte(c: string, v: unknown): Q; range(a: number, b: number): Promise<{ data: Loose[] | null; error: unknown }> } & PromiseLike<{ data: Loose[] | null; error: unknown }>;

export type PayFactEntry = { id: string; entryType: string; policyNumber: string | null; carrierId: string | null; occurredOn: string };
export type PayFacts = {
  /** Per carrier id: the months its advance covers, when every rule for it agrees. */
  advanceMonthsByCarrier: Record<string, number>;
  /** Per chargeback entry id: the month of the policy's life it came back in. */
  policyMonthByEntry: Record<string, number>;
};

const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function readPayFacts(tenantId: string, entries: readonly PayFactEntry[]): Promise<PayFacts> {
  const carriers = [...new Set(entries.map((e) => e.carrierId).filter((c): c is string => !!c))];
  const backs = entries.filter((e) => (CHARGEBACK_TYPES as readonly string[]).includes(e.entryType) && e.policyNumber);
  const policies = [...new Set(backs.map((e) => e.policyNumber as string))];
  const [rules, pcs] = await Promise.all([
    carriers.length ? db().from("advance_rules").select("carrier_id, advance_months").eq("tenant_id", tenantId).in("carrier_id", carriers).then((r) => (r.error ? [] : r.data ?? [])) : Promise.resolve([] as Loose[]),
    Promise.all(chunks(policies).map((part) => db().from("policy_current").select("carrier_id, policy_number, effective_date").eq("tenant_id", tenantId).in("policy_number", part).then((r) => (r.error ? [] : r.data ?? []))))
      .then((xs) => xs.flat()),
  ]);
  const effective = new Map<string, string>();
  for (const p of pcs) if (typeof p.effective_date === "string") effective.set(`${p.carrier_id}:${p.policy_number}`, p.effective_date);
  const policyMonthByEntry: Record<string, number> = {};
  for (const e of backs) {
    const m = policyMonth(effective.get(`${e.carrierId}:${e.policyNumber}`), e.occurredOn);
    if (m !== null) policyMonthByEntry[e.id] = m;
  }
  return {
    advanceMonthsByCarrier: advanceMonthsByCarrier(rules.map((r) => ({ carrierId: String(r.carrier_id), advanceMonths: Number(r.advance_months) }))),
    policyMonthByEntry,
  };
}

/** A payout month's facts per person (G4): their share of the advance, policies, chargebacks and applications. */
export async function readTeamFacts(tenantId: string, from: string, to: string): Promise<Record<string, TeamFact>> {
  const rows: Loose[] = [];
  for (let at = 0; at < 50_000; at += 1000) {
    const { data, error } = await db().from("producer_ledger_entry").select("producer_user_id, entry_type, policy_number, split_pct_bp_applied")
      .eq("tenant_id", tenantId).eq("basis", "reported").gte("occurred_on", from).lte("occurred_on", to).range(at, at + 999);
    if (error) return {};
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return teamFacts(rows.map((r) => ({
    producerUserId: String(r.producer_user_id), entryType: String(r.entry_type), policyNumber: (r.policy_number as string | null) ?? null,
    shareBps: r.split_pct_bp_applied == null ? null : Number(r.split_pct_bp_applied),
  })));
}
