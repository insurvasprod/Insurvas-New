import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readBook, statusChangedAt } from "@/lib/ledger/service";
import { normalisePolicyNumber } from "@/lib/ledger/statementMatch";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { readPaged, type PageResult } from "@/lib/supabase/readPaged";
import { keepVisible, type ProducerScope } from "@/lib/agency/visibility";

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

type Rows<T> = PromiseLike<PageResult<T>>;
type Ranged<T> = { order(column: string): Ranged<T>; range(from: number, to: number): Rows<T> };
type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): Ranged<Record<string, string | null>> } } };
const db = () => getSupabaseServiceClient() as unknown as Loose;

/**
 * Every row of one of the lead-source tables, paged. A table that is not there yet (a schema gap)
 * is honestly empty; any other failure is reported, so a read error never passes for "every policy
 * is unattributed".
 */
async function readAll(table: string, columns: string, tenantId: string): Promise<{ rows: Array<Record<string, string | null>>; failed: boolean }> {
  const { rows, error } = await readPaged<Record<string, string | null>>((from, to) => db().from(table).select(columns).eq("tenant_id", tenantId).order("id").range(from, to));
  if (!error) return { rows, failed: false };
  if (isSchemaGap(error)) return { rows: [], failed: false };
  console.error(`[persistency] could not read ${table}`, error);
  return { rows: [], failed: true };
}

export const UNATTRIBUTED = "Unattributed";
/** What a policy's lead source reads as when the lead-source tables could not be read just now. */
export const SOURCE_UNAVAILABLE = "unavailable right now";

/** Policy numbers compare as statement matching compares them: no case, spaces or punctuation. */
const sourceKey = (policyNumber: string) => normalisePolicyNumber(policyNumber);

function sourceIndex(issued: Array<Record<string, string | null>>, vendors: Array<Record<string, string | null>>, campaigns: Array<Record<string, string | null>>): Map<string, string> {
  const vendorName = new Map(vendors.map((row) => [row.id, row.name]));
  const campaignName = new Map(campaigns.map((row) => [row.id, row.name]));
  const sourceByNumber = new Map<string, string>();
  for (const row of issued) {
    if (!row.policy_number) continue;
    const name = (row.vendor_id && vendorName.get(row.vendor_id)) || (row.campaign_id && campaignName.get(row.campaign_id)) || null;
    if (name) sourceByNumber.set(sourceKey(row.policy_number), name);
  }
  return sourceByNumber;
}

async function readSources(tenantId: string): Promise<{ sourceByNumber: Map<string, string>; unavailable: boolean }> {
  const [issued, vendors, campaigns] = await Promise.all([
    readAll("tenant_issued_policies", "id, policy_number, vendor_id, campaign_id", tenantId),
    readAll("tenant_lead_vendors", "id, name", tenantId),
    readAll("tenant_campaigns", "id, name", tenantId),
  ]);
  return { sourceByNumber: sourceIndex(issued.rows, vendors.rows, campaigns.rows), unavailable: issued.failed || vendors.failed || campaigns.failed };
}

type Narrow = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        ilike(column: string, pattern: string): { limit(count: number): PromiseLike<PageResult<Record<string, string | null>>> };
        eq(column: string, value: unknown): { maybeSingle(): PromiseLike<{ data: Record<string, string | null> | null; error: { message: string; code?: string } | null }> };
      };
    };
  };
};

/**
 * One policy's lead source, named as the report names it (LA-4.9's policy page). It reads only
 * what this policy needs: the issued-policy records whose number could be this one (a pattern on
 * its letters and digits, confirmed with the same normalisation the report uses), then that one
 * vendor or campaign. It does not read the whole tenant's sources for one name.
 */
export async function leadSourceOf(tenantId: string, policyNumber: string): Promise<string> {
  const key = sourceKey(policyNumber);
  if (!key) return UNATTRIBUTED;
  const narrow = getSupabaseServiceClient() as unknown as Narrow;
  // Letters and digits only, so the pattern needs no escaping; any punctuation may sit between them.
  const candidates = await narrow.from("tenant_issued_policies").select("policy_number, vendor_id, campaign_id").eq("tenant_id", tenantId).ilike("policy_number", `%${key.split("").join("%")}%`).limit(50);
  if (candidates.error) {
    if (isSchemaGap(candidates.error)) return UNATTRIBUTED;
    console.error("[persistency] could not read the policy's issued record", candidates.error);
    return SOURCE_UNAVAILABLE;
  }
  const issued = (candidates.data ?? []).find((row) => row.policy_number && sourceKey(row.policy_number) === key);
  if (!issued) return UNATTRIBUTED;
  // The vendor and the campaign are read together, then taken in that order (the vendor's name wins).
  const sources = [["tenant_lead_vendors", issued.vendor_id], ["tenant_campaigns", issued.campaign_id]] as const;
  const reads = await Promise.all(sources.map(([table, id]) => (id ? narrow.from(table).select("name").eq("tenant_id", tenantId).eq("id", id).maybeSingle() : null)));
  for (const [index, [table, id]] of sources.entries()) {
    if (!id) continue;
    const named = reads[index]!;
    if (named.error && !isSchemaGap(named.error)) { console.error(`[persistency] could not read ${table}`, named.error); return SOURCE_UNAVAILABLE; }
    if (named.data?.name) return named.data.name;
  }
  return UNATTRIBUTED;
}

/**
 * AG-0.5 · `scope` (from the session, scopeFor) drops every policy whose producer (created_by, as `canView`
 * reads it) is outside the agency scope BEFORE the percentages are computed: a rate over a book that includes
 * another producer's policies would still show that book. null/absent = no change.
 */
export async function getPersistencyReport(input: { tenantId: string; canView: (producerUserId: string | undefined) => boolean; today?: string; scope?: ProducerScope }): Promise<PersistencyReport & { leadSourcesUnavailable: boolean }> {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const [book, { sourceByNumber, unavailable }] = await Promise.all([readBook(input.tenantId), readSources(input.tenantId)]);
  const policies: PersistencyPolicy[] = keepVisible(input.scope ?? null, book, (row) => row.created_by)
    .filter((row) => input.canView(row.created_by ?? undefined))
    .map((row) => ({
      id: row.id,
      status: row.status,
      effectiveDate: row.effective_date,
      endedOn: statusChangedAt(row),
      carrier: row.carrier,
      leadSource: sourceByNumber.get(sourceKey(row.policy_number)) ?? UNATTRIBUTED,
    }));
  // When the lead-source tables could not be read, the by-lead-source table is not offered as fact.
  return { ...computePersistency(policies, today), leadSourcesUnavailable: unavailable };
}
