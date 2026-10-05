import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getCarrierLibrary } from "@/lib/carriers/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
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
 *
 * LA-4.7: the book is read in pages, so a book past PostgREST's 1,000-row cap is read whole (it used
 * to stop silently at 1,000). A lapse or cancellation dates from `status_changed_at`, which only a
 * change of status moves; before migration 20261002120000 it falls back to `updated_at`.
 */

export type BookPolicyRow = {
  id: string; policy_number: string; insured_name: string; carrier: string; product: string; effective_date: string;
  annual_premium_cents: number; status: string; updated_at: string; created_by: string | null; status_changed_at?: string | null;
};

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
type Ranged = { order(column: string, options?: { ascending?: boolean }): Ranged; range(from: number, to: number): Page };
type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): Ranged } } };
const PAGE = 1000;
const COLUMNS_V1 = "id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, updated_at, created_by";
const COLUMNS = `${COLUMNS_V1}, status_changed_at`;

/** Every policy in the book, paged, with its status date when the column exists. */
export async function readBook(tenantId: string): Promise<BookPolicyRow[]> {
  const read = async (columns: string) => {
    const rows: BookPolicyRow[] = [];
    for (let start = 0; ; start += PAGE) {
      const page = await (getSupabaseServiceClient() as unknown as Loose).from("tenant_policies").select(columns).eq("tenant_id", tenantId).order("effective_date", { ascending: false }).order("id").range(start, start + PAGE - 1);
      if (page.error) return { rows, error: page.error };
      const data = (page.data ?? []) as BookPolicyRow[];
      rows.push(...data);
      if (data.length < PAGE) return { rows, error: null };
    }
  };
  let result = await read(COLUMNS);
  if (result.error && isSchemaGap(result.error)) result = await read(COLUMNS_V1);
  if (result.error) throw new Error(`Could not load policies: ${result.error.message}`);
  return result.rows;
}

/** When a lapsed or cancelled policy was marked so: the status date, else (before LA-4.7) the last edit. */
export function statusChangedAt(row: Pick<BookPolicyRow, "status" | "updated_at" | "status_changed_at">): string | null {
  if (row.status !== "lapsed" && row.status !== "cancelled") return null;
  return row.status_changed_at ?? row.updated_at;
}

export async function getCommissionLedger(input: { tenantId: string; canView: (producerUserId: string | undefined) => boolean; today?: string }): Promise<LedgerResult & { policiesRead: number }> {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const [rows, library] = await Promise.all([readBook(input.tenantId), getCarrierLibrary(input.tenantId)]);

  const visible: LedgerPolicy[] = rows
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
      statusChangedAt: statusChangedAt(row),
      createdBy: row.created_by,
    }));

  const result = computeLedger(visible, library, today);
  return { ...result, totals: totalsOf(result.entries, result.exposure), policiesRead: visible.length };
}
