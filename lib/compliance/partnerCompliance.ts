import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-6 figures kept against a partner (LA-1.18 partner quality, the partner's own portal): transfers
 * the LA-6.2 gate rejected, and accepts that were only screened at submit. Counts only — never which
 * numbers (Q9).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type PartnerGateStats = { rejected: number; screenedLate: number; accepted: number };
/** What the partner sees: how many of their transfers were rejected this month. A count, never the numbers. */
export async function partnerRejectsThisMonth(tenantId: string, partnerId: string, now = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await db()
    .from("transfer_verdict")
    .select("submission_id, id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .eq("verdict", "reject")
    .gte("evaluated_at", monthStart)
    .limit(10000);
  if (error) return 0;
  // One attempt rejected on entry and again at submit counts once.
  return new Set(((data ?? []) as Loose[]).map((r) => r.submission_id ?? r.id)).size;
}

/** Per partner, for the quality page (LA-1.18): rejected attempts and accepts screened only at submit. */
export async function gateStatsByPartner(tenantId: string, from: string, to: string, partnerId?: string): Promise<Map<string, PartnerGateStats>> {
  const out = new Map<string, PartnerGateStats>();
  const seen = new Set<string>();
  for (let page = 0; ; page += 1) {
    let q = db()
      .from("transfer_verdict")
      .select("partner_id, submission_id, id, verdict, stage, screened_before_transfer")
      .eq("tenant_id", tenantId);
    if (partnerId) q = q.eq("partner_id", partnerId);
    const { data, error } = await q
      .gte("evaluated_at", `${from}T00:00:00Z`)
      .lte("evaluated_at", `${to}T23:59:59.999Z`)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) return out;
    const rows = (data ?? []) as Loose[];
    for (const r of rows) {
      if (!r.partner_id) continue;
      const s = out.get(r.partner_id) ?? { rejected: 0, screenedLate: 0, accepted: 0 };
      const key = `${r.verdict}:${r.submission_id ?? r.id}`;
      if (r.verdict === "reject" && !seen.has(key)) s.rejected += 1;
      if (r.stage === "submit" && r.verdict !== "reject") {
        s.accepted += 1;
        if (!r.screened_before_transfer) s.screenedLate += 1;
      }
      seen.add(key);
      out.set(r.partner_id, s);
    }
    if (rows.length < 1000) return out;
  }
}
