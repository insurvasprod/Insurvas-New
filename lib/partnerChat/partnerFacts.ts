import "server-only";

import { intakeLocalDate, localRangeToUtc } from "@/lib/dealFlow/localDate";
import { formatCentsAsCurrency } from "@/lib/money";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * What the PartnerChat concept board puts beside each partner channel: how many transfers the
 * partner sent today, how many ended as completed work and how many dropped, whether the partner is
 * paused, and the payout terms in force. All read from records; nothing here is typed in.
 *
 * "Completed" and "dropped" are the tenant's own disposition flags (counts_as_work_completed,
 * closes_as = 'dropped') on outcomes logged today, the same flags the partner's outcome cards use.
 */
export type PartnerChannelFacts = {
  partnerId: string;
  status: string;
  transfersToday: number;
  completedToday: number;
  droppedToday: number;
  payout: string | null;
};

type Term = { partner_id: string; payout_model: string; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string };

export function payoutLabel(term: Pick<Term, "payout_model" | "rate_cents" | "rate_pct_bp"> | null): string | null {
  if (!term) return null;
  if (term.payout_model === "revenue_share") return term.rate_pct_bp == null ? null : `${(term.rate_pct_bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% revenue share`;
  if (term.rate_cents == null) return null;
  const unit = ({ per_transfer: "transfer", per_lead: "lead", per_sale: "sale", per_issued_policy: "issued policy" } as Record<string, string>)[term.payout_model] ?? term.payout_model.replace(/_/g, " ");
  return `${formatCentsAsCurrency(term.rate_cents)} / ${unit}`;
}

export async function getPartnerChannelFacts(tenantId: string, timeZone: string | null): Promise<PartnerChannelFacts[]> {
  const db = getSupabaseServiceClient();
  const zone = timeZone || "UTC";
  const today = intakeLocalDate(zone);
  const { gte, lt } = localRangeToUtc(today, today, zone);

  const partners = await db.from("partners").select("id, status").eq("tenant_id", tenantId);
  if (partners.error) throw new Error(`Could not read partners: ${partners.error.message}`);
  const ids = (partners.data ?? []).map((partner) => partner.id);
  if (!ids.length) return [];

  const [terms, sent, closed, dispositions] = await Promise.all([
    db.from("partner_terms").select("partner_id, payout_model, rate_cents, rate_pct_bp, effective_from").in("partner_id", ids).lte("effective_from", today).order("effective_from", { ascending: false }),
    db.from("lead_queue").select("partner_id").eq("tenant_id", tenantId).in("partner_id", ids).gte("created_at", gte).lt("created_at", lt).limit(10000),
    db.from("lead_queue").select("partner_id, disposition").eq("tenant_id", tenantId).in("partner_id", ids).not("disposition", "is", null).gte("disposition_at", gte).lt("disposition_at", lt).limit(10000),
    db.from("dispositions").select("disposition_key, counts_as_work_completed, closes_as").eq("tenant_id", tenantId),
  ]);
  for (const result of [terms, sent, closed, dispositions]) if (result.error) throw new Error(`Could not read partner activity: ${result.error.message}`);

  const flags = new Map((dispositions.data ?? []).map((row) => [row.disposition_key, row]));
  const current = new Map<string, Term>();
  for (const term of (terms.data ?? []) as Term[]) if (!current.has(term.partner_id)) current.set(term.partner_id, term);
  const count = (rows: Array<{ partner_id: string | null }>, keep: (row: never) => boolean = () => true) => {
    const map = new Map<string, number>();
    for (const row of rows) if (row.partner_id && keep(row as never)) map.set(row.partner_id, (map.get(row.partner_id) ?? 0) + 1);
    return map;
  };
  const closedRows = (closed.data ?? []) as Array<{ partner_id: string | null; disposition: string }>;
  const transfers = count((sent.data ?? []) as Array<{ partner_id: string | null }>);
  const completed = count(closedRows, (row: { disposition: string }) => flags.get(row.disposition)?.counts_as_work_completed === true);
  const dropped = count(closedRows, (row: { disposition: string }) => flags.get(row.disposition)?.closes_as === "dropped");

  return (partners.data ?? []).map((partner) => ({
    partnerId: partner.id,
    status: String(partner.status),
    transfersToday: transfers.get(partner.id) ?? 0,
    completedToday: completed.get(partner.id) ?? 0,
    droppedToday: dropped.get(partner.id) ?? 0,
    payout: payoutLabel(current.get(partner.id) ?? null),
  }));
}
