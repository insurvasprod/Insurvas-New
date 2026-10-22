import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { ISSUED_POLICY_SCHEMA_PENDING, issuedPolicyErrorText, type IssuedPolicy } from "./types";
import { keepVisible, type ProducerScope } from "@/lib/agency/visibility";

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

/** AG-0.5 · the lead a deal (deal_flow.id) is for, so the route can `guardLead` it; null when not this tenant's. */
export async function dealLeadId(tenantId: string, dealId: string): Promise<string | null> {
  if (!UUID.test(dealId)) return null;
  const { data } = await db().from("deal_flow").select("lead_id").eq("tenant_id", tenantId).eq("id", dealId) as unknown as { data: Array<{ lead_id: string | null }> | null };
  return data?.[0]?.lead_id ?? null;
}

/**
 * The policies recorded on one deal, newest first. `writable` is false before 20260925708000.
 * AG-0.5 · with a scope, a policy on an application case another producer opened is left out (issued policies
 * follow their case, D1); one with no case is the deal's own, and the route has already guarded the deal's lead.
 */
export async function listDealPolicies(tenantId: string, dealId: unknown, scope: ProducerScope = null): Promise<{ policies: IssuedPolicy[]; writable: boolean }> {
  const id = uuid(dealId, "deal");
  const caseColumns = scope === null ? "" : ", application_case_id, case_scope:tenant_application_cases!application_case_id(opened_by)";
  const read = (columns: string) => db().from("tenant_issued_policies").select(`${columns}${caseColumns}`).eq("tenant_id", tenantId).eq("deal_id", id).order("issued_at", { ascending: false });
  let result = await read(COLUMNS);
  let writable = true;
  if (result.error && isSchemaGap(result.error)) {
    writable = false;
    result = await read(BASE_COLUMNS);
  }
  if (result.error) throw new Error(`Could not load the deal's policies: ${result.error.message}`);
  type Scoped = Partial<IssuedPolicy> & { application_case_id?: string | null; case_scope?: { opened_by?: string | null } | null };
  const all = (result.data as Array<Scoped> | null) ?? [];
  const onVisibleCase = new Set(keepVisible(scope, all.filter((row) => row.application_case_id), (row) => row.case_scope?.opened_by));
  const rows = scope === null ? all : all.filter((row) => !row.application_case_id || onVisibleCase.has(row));
  return {
    policies: rows.map((scoped) => {
      const row: Scoped = { ...scoped };
      // The scope columns were read only to filter; the payload stays what it was.
      if (scope !== null) { delete row.application_case_id; delete row.case_scope; }
      return { ...row, lapsed_at: row.lapsed_at ?? null } as IssuedPolicy;
    }),
    writable,
  };
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

/**
 * Mark one application's policy issued (LA-3 → Module 4). Each insured's application is its own
 * policy: a household's spouse no longer collides with the primary on their shared deal row
 * (deal_flow allows one deal per lead), because the "already issued" check is per application.
 * Idempotent: the same policy number again returns the policy already recorded. Before migration
 * 20261015570000 the function is missing and the deal-level writer is used, as before.
 */
export async function markApplicationPolicyIssued(tenantId: string, input: { applicationId: string; dealId: string | null; carrier: unknown; policyNumber: unknown; issuedOn: unknown }): Promise<IssuedPolicy> {
  const carrier = typeof input.carrier === "string" ? input.carrier.trim() : "";
  const policyNumber = typeof input.policyNumber === "string" ? input.policyNumber.trim() : "";
  if (!carrier || carrier.length > 160) throw new Error("Enter the carrier that issued the policy (up to 160 characters).");
  if (!policyNumber || policyNumber.length > 120) throw new Error("Enter the policy number (up to 120 characters).");
  const issuedOn = assertPolicyDay(input.issuedOn, "Issue date");
  const { data, error } = await db().rpc("mark_application_policy_issued", { p_tenant_id: tenantId, p_application_id: uuid(input.applicationId, "application"), p_carrier: carrier, p_policy_number: policyNumber, p_issued_on: issuedOn });
  if (error && isMissingFunction(error) && input.dealId) return markDealPolicyIssued(tenantId, { dealId: input.dealId, carrier, policyNumber, issuedOn });
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
