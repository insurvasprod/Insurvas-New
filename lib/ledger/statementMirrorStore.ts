import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { normalisePolicyNumber, type MatchCarrier } from "./statementMatch";
import { mirrorRow, numbersToMirror, type CarrierCurrent } from "./statementMirror";
import type { ParsedStatementLine } from "./statementParse";
import type { PolicyRow } from "./statementService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mirror's source and policy_current's columns are not in the generated types
const db = () => getSupabaseServiceClient() as any;

/**
 * Lines whose policy the hand book lacks but the carrier's own file lists (owner 2026-11-19): their mirrors in
 * tenant_policies (lib/ledger/statementMirror.ts), so they match like any other. `write` false (a preview) only
 * stands them in with an id of their own and writes nothing. Before 20261120100000 the database refuses the
 * mirror's source: then nothing is mirrored and the lines stay unmatched, as before.
 */
export async function carrierPolicyMirrors(tenantId: string, lines: ParsedStatementLine[], held: PolicyRow[], carrier: MatchCarrier, write: boolean, actorUserId: string | null): Promise<PolicyRow[]> {
  const numbers = numbersToMirror(lines, held.filter((row) => normalisePolicyNumber(row.carrier) === normalisePolicyNumber(carrier.name) || normalisePolicyNumber(row.carrier) === normalisePolicyNumber(carrier.code)).map((row) => row.policy_number), normalisePolicyNumber);
  if (!numbers.length) return [];
  const read = await db().from("policy_current").select("policy_number, status_normalized, issue_date, effective_date, annualised_premium_cents, product_code, agent_user_id").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).in("policy_number", numbers);
  const currents = (read.error ? [] : (read.data ?? [])) as CarrierCurrent[];
  if (!currents.length) return [];
  // The product family each carrier code is matched to (the agency's own match first, then Insurvas'), by name.
  const codes = [...new Set(currents.map((row) => row.product_code).filter((code): code is string => Boolean(code)))];
  const families = codes.length ? await db().from("carrier_product_family").select("tenant_id, carrier_product_code, product_code").eq("carrier_id", carrier.id).in("carrier_product_code", codes).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) : { data: [], error: null };
  const familyOf = new Map<string, string>();
  for (const row of [...((families.data ?? []) as Array<{ tenant_id: string | null; carrier_product_code: string; product_code: string }>)].sort((a, b) => (a.tenant_id ? 1 : 0) - (b.tenant_id ? 1 : 0))) familyOf.set(row.carrier_product_code, row.product_code);
  const products = familyOf.size ? await db().from("products").select("code, name").in("code", [...new Set(familyOf.values())]) : { data: [], error: null };
  const productName = new Map(((products.data ?? []) as Array<{ code: string; name: string }>).map((row) => [row.code, row.name]));
  const insuredOf = new Map(lines.filter((line) => line.policyNumber).map((line) => [normalisePolicyNumber(line.policyNumber as string), line.insuredName ?? null]));
  const rows = currents.map((current) => ({
    ...mirrorRow(current, { carrierName: carrier.name, insuredName: insuredOf.get(normalisePolicyNumber(current.policy_number)) ?? null, productName: current.product_code ? productName.get(familyOf.get(current.product_code) ?? "") ?? null : null }),
    created_by: current.agent_user_id ?? actorUserId,
  }));
  if (!write) return rows.map((row) => ({ id: `mirror:${row.policy_number}`, policy_number: row.policy_number, insured_name: row.insured_name, carrier: row.carrier, created_by: row.created_by }));
  const made = await db().from("tenant_policies").insert(rows.map((row) => ({ ...row, tenant_id: tenantId }))).select("id, policy_number, insured_name, carrier, created_by");
  if (made.error) {
    // 23514: the source check before the migration; anything else is logged and the lines stay unmatched.
    if (made.error.code !== "23514") console.error("[statements] carrier policy mirrors", made.error.message);
    return [];
  }
  return (made.data ?? []) as PolicyRow[];
}

