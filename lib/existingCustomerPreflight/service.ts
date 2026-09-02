import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizePhone, normalizeText } from "@/lib/contacts/normalization";
import type { Json } from "@/lib/supabase/database.types";
import type { PreflightMatch, PreflightResult, PreflightStatus } from "./types";

const CONTROL_OR_MARKUP = /[\u0000-\u001f\u007f<>]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_KEYS = ["phone", "phone_number", "primary_phone"];
const NAME_KEYS = ["full_name", "name"];
const OUTCOME_SOLD = /^(sold|issued|approved|won|converted|submitted)$/i;

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, max = 240) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max && !CONTROL_OR_MARKUP.test(trimmed) ? trimmed : null;
}
function firstText(values: Record<string, unknown>, keys: string[]) { for (const key of keys) { const value = text(values[key]); if (value) return value; } return null; }
function fullName(values: Record<string, unknown>) { return firstText(values, NAME_KEYS) ?? ([text(values.first_name, 120), text(values.last_name, 120)].filter(Boolean).join(" ") || null); }
function address(values: Record<string, unknown>) { return ["address_line1", "address", "city", "state", "state_code", "postal_code", "zip"].map((key) => text(values[key], 120)).filter(Boolean).join(" ") || null; }
function dateValue(values: Record<string, unknown>) { const value = firstText(values, ["dob", "date_of_birth"]); return value && DATE.test(value) ? value : null; }
function phoneValue(values: Record<string, unknown>) {
  const direct = firstText(values, PHONE_KEYS);
  const phones = Array.isArray(values.phones) ? values.phones : [];
  const alternate = phones.map((item) => record(item).phone).find((value) => typeof value === "string") as string | undefined;
  const digits = normalizePhone(direct ?? alternate);
  return /^\d{10}$/.test(digits) ? digits : null;
}

function mapMatch(row: { lead_id: unknown; contact_id: unknown; submitted_at: unknown; partner_id: unknown; partner_name: unknown; product_line: unknown; outcome: unknown; score: unknown; matched_on: unknown; source_type: unknown }): PreflightMatch {
  return {
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    contactId: typeof row.contact_id === "string" ? row.contact_id : null,
    submittedAt: String(row.submitted_at),
    partnerId: typeof row.partner_id === "string" ? row.partner_id : null,
    partnerName: typeof row.partner_name === "string" ? row.partner_name : null,
    productLine: typeof row.product_line === "string" ? row.product_line : null,
    outcome: typeof row.outcome === "string" ? row.outcome : null,
    score: Number(row.score),
    matchedOn: Array.isArray(row.matched_on) ? row.matched_on.filter((item): item is string => typeof item === "string") : [],
    sourceType: row.source_type === "contact" ? "contact" : "lead",
  };
}

function statusFor(matches: PreflightMatch[]): PreflightStatus {
  if (!matches.length) return "new_household";
  if (matches.some((match) => match.sourceType === "lead" && match.outcome && OUTCOME_SOLD.test(match.outcome.trim()))) return "already_customer";
  return "spoken_before";
}

export async function runExistingCustomerPreflight(params: { tenantId: string; leadId: string; values: unknown }): Promise<PreflightResult> {
  const values = record(params.values);
  const checkedAt = new Date().toISOString();
  const full = fullName(values);
  const { data, error } = await getSupabaseServiceClient().rpc("find_existing_customer_preflight", {
    p_tenant_id: params.tenantId,
    p_full_name: full ? normalizeText(full) : null,
    p_dob: dateValue(values),
    p_phone_digits: phoneValue(values),
    p_address_search: address(values) ? normalizeText(address(values)!) : null,
    p_exclude_lead_id: params.leadId,
    p_limit: 20,
  });
  if (error) throw new Error(`Could not complete existing-customer pre-flight: ${error.message}`);
  const matches = ((data ?? []) as unknown as Array<Parameters<typeof mapMatch>[0]>).map(mapMatch);
  const status = statusFor(matches);
  const result: PreflightResult = { status, policyMatchingIncluded: false, policyMatchingNote: "Policy matching is not included yet; this check covers prior leads and contacts only.", checkedAt, matches };
  const stored = await getSupabaseServiceClient().from("agent_leads").update({ preflight_status: status, preflight_checked_at: checkedAt, preflight_result: result as unknown as Json }).eq("tenant_id", params.tenantId).eq("id", params.leadId);
  if (stored.error) throw new Error(`Could not store existing-customer pre-flight: ${stored.error.message}`);
  return result;
}

export async function loadStoredPreflight(value: unknown): Promise<PreflightResult> {
  const result = record(value);
  const matches = Array.isArray(result.matches) ? result.matches : [];
  return {
    status: result.status === "already_customer" || result.status === "spoken_before" || result.status === "not_checked" ? result.status : "new_household",
    policyMatchingIncluded: false,
    policyMatchingNote: typeof result.policyMatchingNote === "string"
      ? result.policyMatchingNote
      : typeof result.policy_matching_note === "string"
        ? result.policy_matching_note
        : "Policy matching is not included yet; this check covers prior leads and contacts only.",
    checkedAt: typeof result.checkedAt === "string" ? result.checkedAt : null,
    matches: matches as PreflightMatch[],
    ...(typeof result.error === "string" ? { error: result.error } : {}),
  };
}
