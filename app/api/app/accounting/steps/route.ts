import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AccountingStepCounts } from "@/lib/accounting/steps";
import { EDITABLE } from "@/lib/accounting/invoicesCore";

/**
 * The live counts on the one Accounting page's rail (owner 2026-11-02): what waits on a person, per step.
 * Head counts only — never an amount — under the gate its steps share (profit_and_loss, owner and
 * bookkeeper). Each read stands alone: one that fails leaves its step out, and the rail shows no badge.
 *
 *   bank      deposits not yet matched to a carrier payment (the Bank deposits match queue)
 *   bills     vendor invoices still to approve: draft, received or disputed (Vendor bills' "To approve")
 *   expenses  recurring expenses that arrived and wait to be confirmed
 *   payouts   partner payout runs still drafts, waiting to be reviewed and published (LA-7.4, 2026-11-03)
 */
const ROLES = ["owner", "bookkeeper"] as const;

type Count = PromiseLike<{ count: number | null; error: { message: string } | null }>;
type Q = Count & { eq(c: string, v: unknown): Q; in(c: string, v: readonly unknown[]): Q; gt(c: string, v: unknown): Q };
type Db = { from(table: string): { select(columns: string, options: { count: "exact"; head: true }): Q } };

const head = async (query: Count): Promise<number | null> => {
  const { count, error } = await query;
  return error ? null : (count ?? 0);
};

export async function GET() {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const db = getSupabaseServiceClient() as unknown as Db;
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", auth.context.tenantId);

  const [bank, bills, expenses, payouts] = await Promise.all([
    head(count("bank_transaction").gt("amount_cents", 0).in("match_status", ["unmatched", "suggested", "partially_matched"])).catch(() => null),
    // The same invoices Vendor bills' "To approve" figure counts (EDITABLE in lib/accounting/invoicesCore.ts).
    head(count("vendor_invoice").in("status", EDITABLE)).catch(() => null),
    head(count("expense").eq("status", "unconfirmed")).catch(() => null),
    head(count("payout_run").eq("status", "draft")).catch(() => null),
  ]);
  const counts: AccountingStepCounts = {};
  if (bank !== null) counts.bank = bank;
  if (bills !== null) counts.bills = bills;
  if (expenses !== null) counts.expenses = expenses;
  if (payouts !== null) counts.payouts = payouts;
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
