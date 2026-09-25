import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { ISSUED_POLICY_SCHEMA_PENDING, issuedPolicyErrorText, type IssuedPolicy } from "./types";

/**
 * Mark issued / Mark lapsed on a deal. Both writes go through SQL functions (20260925708300) that
 * lock the deal or policy and insert/update tenant_issued_policies, whose BEFORE trigger
 * (enforce_issued_policy_attribution) fills and checks the campaign and vendor. Nothing here
 * decides attribution.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type DbError = { message: string; code?: string } | null;
type Query = PromiseLike<{ data: unknown; error: DbError }> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }> };
function db() { return getSupabaseServiceClient() as unknown as Db; }

/** The write needs a migration that is not applied. Routes answer 503 with the shared sentence. */
export class IssuedPolicySchemaPendingError extends Error {
  constructor() { super(ISSUED_POLICY_SCHEMA_PENDING); }
}

function isMissingFunction(error: DbError) {
  return Boolean(error) && (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function|function .* does not exist/i.test(error?.message ?? ""));
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export function assertPolicyDay(value: unknown, label: string): string {
  if (typeof value !== "string" || !DAY.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real calendar date`);
  return value;
}

const COLUMNS = "id, deal_id, lead_id, campaign_id, vendor_id, carrier, policy_number, status, issued_at, lapsed_at, created_at";
const BASE_COLUMNS = "id, deal_id, lead_id, campaign_id, vendor_id, carrier, policy_number, status, issued_at, created_at";

/** The policies recorded on one deal, newest first. `writable` is false before 20260925708000. */
export async function listDealPolicies(tenantId: string, dealId: unknown): Promise<{ policies: IssuedPolicy[]; writable: boolean }> {
  const id = uuid(dealId, "deal");
  const read = (columns: string) => db().from("tenant_issued_policies").select(columns).eq("tenant_id", tenantId).eq("deal_id", id).order("issued_at", { ascending: false });
  let result = await read(COLUMNS);
  let writable = true;
  if (result.error && isSchemaGap(result.error)) {
    writable = false;
    result = await read(BASE_COLUMNS);
  }
  if (result.error) throw new Error(`Could not load the deal's policies: ${result.error.message}`);
  const rows = (result.data as Array<Partial<IssuedPolicy>> | null) ?? [];
  return { policies: rows.map((row) => ({ ...row, lapsed_at: row.lapsed_at ?? null }) as IssuedPolicy), writable };
}

function refusal(error: NonNullable<DbError>, fallback: string): Error {
  if (isMissingFunction(error) || isSchemaGap(error)) return new IssuedPolicySchemaPendingError();
  return new Error(issuedPolicyErrorText(error.message) ?? `${fallback}: ${error.message}`);
}

export async function markDealPolicyIssued(tenantId: string, input: { dealId: unknown; carrier: unknown; policyNumber: unknown; issuedOn: unknown }): Promise<IssuedPolicy> {
  const dealId = uuid(input.dealId, "deal");
  const carrier = typeof input.carrier === "string" ? input.carrier.trim() : "";
  const policyNumber = typeof input.policyNumber === "string" ? input.policyNumber.trim() : "";
  if (!carrier || carrier.length > 160) throw new Error("Enter the carrier that issued the policy (up to 160 characters).");
  if (!policyNumber || policyNumber.length > 120) throw new Error("Enter the policy number (up to 120 characters).");
  const issuedOn = assertPolicyDay(input.issuedOn, "Issue date");
  const { data, error } = await db().rpc("mark_deal_policy_issued", { p_tenant_id: tenantId, p_deal_id: dealId, p_carrier: carrier, p_policy_number: policyNumber, p_issued_on: issuedOn });
  if (error) throw refusal(error, "Could not record the issued policy");
  if (!data || typeof data !== "object") throw new Error("The issued policy did not come back");
  return { ...(data as IssuedPolicy), lapsed_at: (data as IssuedPolicy).lapsed_at ?? null };
}

export async function markIssuedPolicyLapsed(tenantId: string, input: { policyId: unknown; lapsedOn: unknown }): Promise<IssuedPolicy> {
  const policyId = uuid(input.policyId, "policy");
  const lapsedOn = assertPolicyDay(input.lapsedOn, "Lapse date");
  const { data, error } = await db().rpc("mark_issued_policy_lapsed", { p_tenant_id: tenantId, p_policy_id: policyId, p_lapsed_on: lapsedOn });
  if (error) throw refusal(error, "Could not mark the policy lapsed");
  if (!data || typeof data !== "object") throw new Error("The lapsed policy did not come back");
  return data as IssuedPolicy;
}
