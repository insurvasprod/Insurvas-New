import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readBalances } from "@/lib/agency/ledgerStore";
import { mapLimit, READ_CONCURRENCY } from "@/lib/retention/batch";

/**
 * Commissions › Producer pay (board 14, 2026-11-03): per producer, for one month, what was Earned, Advanced and
 * Charged back on the reported basis (the basis payouts are made on, AG-1.12), and what is Owed at the month's end.
 * Reads only: it posts nothing (syncing the ledger is the payout preview's and the reconciliation's own step).
 *
 *   Earned        'earned' / 'split_earned' entries whose carrier line is not an advance
 *   Advanced      'split_advance' entries, and 'earned' entries whose carrier line is an advance (AG-1.5 posts a
 *                 carrier advance as the producer's 'earned'; the carrier line says which it was)
 *   Charged back  'chargeback' / 'split_chargeback' entries (negative)
 *   Owed          the reported balance as of the month's last day: everything above, less payouts, plus adjustments
 *
 * Figures stay apart by basis and are never added across bases.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;
const CHUNK = 200;
const PAGE = 1000;

export type ProducerPayFigure = { producerUserId: string; earnedCents: number; advancedCents: number; chargedBackCents: number; owedCents: number };
type Entry = { producer_user_id: string; entry_type: string; amount_cents: number | string; commission_entry_id: string | null };

const chunks = <T,>(items: T[]) => {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += CHUNK) out.push(items.slice(at, at + CHUNK));
  return out;
};

async function periodEntries(tenantId: string, from: string, to: string): Promise<Entry[]> {
  const rows: Entry[] = [];
  for (let at = 0; at < 100_000; at += PAGE) {
    const { data, error } = await db().from("producer_ledger_entry")
      .select("producer_user_id, entry_type, amount_cents, commission_entry_id")
      .eq("tenant_id", tenantId).eq("basis", "reported").gte("occurred_on", from).lte("occurred_on", to)
      .in("entry_type", ["earned", "split_earned", "split_advance", "chargeback", "split_chargeback"])
      .order("occurred_on").order("id").range(at, at + PAGE - 1);
    if (error) throw new Error(`producer pay: ${error.message}`);
    rows.push(...((data ?? []) as Entry[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** The figures for one month; `viewer` scopes the balances to the producers this session may see (AG-0.5). */
export async function producerPayFigures(viewer: { tenantId: string; userId: string }, from: string, to: string): Promise<ProducerPayFigure[]> {
  const [entries, balances] = await Promise.all([periodEntries(viewer.tenantId, from, to), readBalances(viewer, to)]);
  // Which 'earned' entries came from a carrier advance: their carrier line, read in chunks.
  const lineIds = [...new Set(entries.filter((e) => e.entry_type === "earned" && e.commission_entry_id).map((e) => e.commission_entry_id as string))];
  const lines = (await mapLimit(chunks(lineIds), READ_CONCURRENCY, async (part) => ((await db().from("commission_entry").select("id, entry_type, corrects_type").eq("tenant_id", viewer.tenantId).in("id", part)).data ?? []) as Array<{ id: string; entry_type: string; corrects_type: string | null }>)).flat();
  const advance = new Set(lines.filter((line) => (line.entry_type === "reversal" ? line.corrects_type : line.entry_type) === "advance").map((line) => line.id));

  const scope = balances.scope;
  const out = new Map<string, ProducerPayFigure>();
  const of = (id: string) => {
    const row = out.get(id) ?? { producerUserId: id, earnedCents: 0, advancedCents: 0, chargedBackCents: 0, owedCents: 0 };
    out.set(id, row);
    return row;
  };
  for (const e of entries) {
    if (scope !== null && !scope.includes(e.producer_user_id)) continue;
    const row = of(e.producer_user_id);
    const cents = Number(e.amount_cents);
    if (e.entry_type === "chargeback" || e.entry_type === "split_chargeback") row.chargedBackCents += cents;
    else if (e.entry_type === "split_advance" || (e.commission_entry_id && advance.has(e.commission_entry_id))) row.advancedCents += cents;
    else row.earnedCents += cents;
  }
  for (const b of balances.rows) if (b.basis === "reported") of(b.producerUserId).owedCents = b.balanceCents;
  return [...out.values()];
}

/** The first and last day of a month, `offset` months from this one (UTC), as the board's period switch reads them. */
export function monthRange(offset: number, now = new Date()) {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10),
  };
}
