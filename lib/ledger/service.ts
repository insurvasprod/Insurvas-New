import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getCarrierLibrary } from "@/lib/carriers/service";
import { computeLedger, totalsOf, type LedgerPolicy, type LedgerResult } from "./compute";

/**
 * The commission ledger for one tenant, as the viewer may see it.
 *
 * Reads the book of business (tenant_policies) and the carrier library, and multiplies the one by
 * the other in computeLedger. Nothing is stored: the ledger is always the library's current rows
 * applied to the current book, so a rate corrected in Settings is corrected here.
 *
 * Scoping (LA-0.2 criterion 3) is the caller's: `canView` is asked about each policy's producer —
 * tenant_policies.created_by, the only attribution the book carries — and the route answers it with
 * roleCanViewCommission, so a producer sees only the policies they recorded.
 */
export async function getCommissionLedger(input: { tenantId: string; canView: (producerUserId: string | undefined) => boolean; today?: string }): Promise<LedgerResult & { policiesRead: number }> {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const [policies, library] = await Promise.all([
    getSupabaseServiceClient()
      .from("tenant_policies")
      .select("id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, updated_at, created_by")
      .eq("tenant_id", input.tenantId)
      .order("effective_date", { ascending: false }),
    getCarrierLibrary(input.tenantId),
  ]);
  if (policies.error) throw new Error(`Could not load policies: ${policies.error.message}`);

  const visible: LedgerPolicy[] = (policies.data ?? [])
    .filter((row) => input.canView(row.created_by ?? undefined))
    .map((row) => ({
      id: row.id,
      policyNumber: row.policy_number,
      insuredName: row.insured_name,
      carrier: row.carrier,
      product: row.product,
      effectiveDate: row.effective_date,
      annualPremiumCents: row.annual_premium_cents,
      status: row.status,
      statusChangedAt: row.status === "lapsed" || row.status === "cancelled" ? row.updated_at : null,
      createdBy: row.created_by,
    }));

  const result = computeLedger(visible, library, today);
  return { ...result, totals: totalsOf(result.entries, result.exposure), policiesRead: visible.length };
}
