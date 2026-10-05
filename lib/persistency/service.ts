import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readBook, statusChangedAt } from "@/lib/ledger/service";

import { computePersistency, type PersistencyPolicy, type PersistencyReport } from "./compute";

/**
 * LA-4.8 · the persistency report for one tenant, as the viewer may see it.
 *
 * The book is read whole (paged, lib/ledger/service.ts readBook) with the lapse date LA-4.7 keeps.
 * Lead source is where the policy came from: the issued-policy record LA-2.17 writes when a sale
 * closes (tenant_issued_policies, joined by policy number) names its vendor, else its campaign; a
 * policy entered by hand or imported has no such record and is "Unattributed". Attribution is
 * never copied onto tenant_policies (20260913420000).
 *
 * `canView` is asked about each policy's producer, as the ledger does, so a producer's persistency
 * is their own book's.
 */

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
type Ranged<T> = { order(column: string): Ranged<T>; range(from: number, to: number): Rows<T> };
type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): Ranged<Record<string, string | null>> } } };
const db = () => getSupabaseServiceClient() as unknown as Loose;

async function readAll(table: string, columns: string, tenantId: string): Promise<Array<Record<string, string | null>>> {
  const rows: Array<Record<string, string | null>> = [];
  for (let start = 0; ; start += 1000) {
    const page = await db().from(table).select(columns).eq("tenant_id", tenantId).order("id").range(start, start + 999);
    if (page.error) throw new Error(`Could not read ${table}: ${page.error.message}`);
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < 1000) return rows;
  }
}

export const UNATTRIBUTED = "Unattributed";

function sourceIndex(issued: Array<Record<string, string | null>>, vendors: Array<Record<string, string | null>>, campaigns: Array<Record<string, string | null>>): Map<string, string> {
  const vendorName = new Map(vendors.map((row) => [row.id, row.name]));
  const campaignName = new Map(campaigns.map((row) => [row.id, row.name]));
  const sourceByNumber = new Map<string, string>();
  for (const row of issued) {
    if (!row.policy_number) continue;
    const name = (row.vendor_id && vendorName.get(row.vendor_id)) || (row.campaign_id && campaignName.get(row.campaign_id)) || null;
    if (name) sourceByNumber.set(row.policy_number.trim().toUpperCase(), name);
  }
  return sourceByNumber;
}

const readSources = (tenantId: string) => Promise.all([
  readAll("tenant_issued_policies", "id, policy_number, vendor_id, campaign_id", tenantId).catch(() => []),
  readAll("tenant_lead_vendors", "id, name", tenantId).catch(() => []),
  readAll("tenant_campaigns", "id, name", tenantId).catch(() => []),
]).then(([issued, vendors, campaigns]) => sourceIndex(issued, vendors, campaigns));

/** One policy's lead source, named as the report names it (LA-4.9's policy page). */
export async function leadSourceOf(tenantId: string, policyNumber: string): Promise<string> {
  return (await readSources(tenantId)).get(policyNumber.trim().toUpperCase()) ?? UNATTRIBUTED;
}

export async function getPersistencyReport(input: { tenantId: string; canView: (producerUserId: string | undefined) => boolean; today?: string }): Promise<PersistencyReport> {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const [book, sourceByNumber] = await Promise.all([readBook(input.tenantId), readSources(input.tenantId)]);
  const policies: PersistencyPolicy[] = book
    .filter((row) => input.canView(row.created_by ?? undefined))
    .map((row) => ({
      id: row.id,
      status: row.status,
      effectiveDate: row.effective_date,
      endedOn: statusChangedAt(row),
      carrier: row.carrier,
      leadSource: sourceByNumber.get(row.policy_number.trim().toUpperCase()) ?? UNATTRIBUTED,
    }));
  return computePersistency(policies, today);
}
