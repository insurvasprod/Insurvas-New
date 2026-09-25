import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Entitlement } from "@/lib/entitlements/types";
import type { PartnerPayoutModel, PartnerStatus, PartnerType } from "./constants";

export type PartnerRow = {
  id: string;
  tenant_id: string;
  name: string;
  partner_type: PartnerType;
  status: PartnerStatus;
  country: string;
  contact_name: string | null;
  contact_email: string | null;
  timezone: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  offboarded_at: string | null;
  terms: PartnerTermRow[];
  active_term: PartnerTermRow | null;
  lead_volume_this_month: number;
  last_submission: string | null;
  active_user_count: number;
  /** Queue rows the partner sent this month, and how the ones closed this month ended (the tenant's own disposition flags). */
  transfers_this_month: number;
  completed_this_month: number;
  dropped_this_month: number;
  approved_products: string[];
};

export type PartnerTermRow = {
  id: string;
  partner_id: string;
  payout_model: PartnerPayoutModel;
  rate_cents: number | null;
  rate_pct_bp: number | null;
  effective_from: string;
  created_by: string | null;
  created_at: string;
};

type PartnerInput = {
  name: string;
  partner_type: PartnerType;
  country: string;
  contact_name?: string;
  contact_email?: string;
  timezone: string;
  notes?: string;
};

/** Today's date (YYYY-MM-DD) in the given IANA timezone; UTC when the zone is unknown. */
function partnerLocalDate(timezone: string | null | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function listPartners(tenantId: string): Promise<PartnerRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data: partners, error } = await supabase.from("partners").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load partners: ${error.message}`);
  const ids = (partners ?? []).map((partner) => partner.id);
  if (ids.length === 0) return [];

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [terms, users, leads, sent, closed, flags, products] = await Promise.all([
    supabase.from("partner_terms").select("*").in("partner_id", ids).order("effective_from", { ascending: false }),
    supabase.from("partner_users").select("partner_id, status").in("partner_id", ids),
    supabase.from("agent_leads").select("partner_id, created_at").eq("tenant_id", tenantId).in("partner_id", ids).gte("created_at", monthStart).order("created_at", { ascending: false }),
    supabase.from("lead_queue").select("partner_id").eq("tenant_id", tenantId).in("partner_id", ids).gte("created_at", monthStart).limit(50000),
    supabase.from("lead_queue").select("partner_id, disposition").eq("tenant_id", tenantId).in("partner_id", ids).not("disposition", "is", null).gte("disposition_at", monthStart).limit(50000),
    supabase.from("dispositions").select("disposition_key, counts_as_work_completed, closes_as").eq("tenant_id", tenantId),
    supabase.from("partner_products").select("partner_id, product_code").in("partner_id", ids).order("product_code"),
  ]);
  const relatedError = [terms, users, leads, sent, closed, flags, products].find((result) => result.error)?.error;
  if (relatedError) throw new Error(`Could not load partner details: ${relatedError.message}`);
  const termMap = new Map<string, PartnerTermRow[]>();
  for (const term of (terms.data ?? []) as PartnerTermRow[]) termMap.set(term.partner_id, [...(termMap.get(term.partner_id) ?? []), term]);
  const leadMap = new Map<string, string[]>();
  for (const lead of leads.data ?? []) if (lead.partner_id) leadMap.set(lead.partner_id, [...(leadMap.get(lead.partner_id) ?? []), lead.created_at]);
  const activeUsers = new Map<string, number>();
  for (const user of users.data ?? []) if (user.status === "active") activeUsers.set(user.partner_id, (activeUsers.get(user.partner_id) ?? 0) + 1);
  const bump = (map: Map<string, number>, key: string | null) => { if (key) map.set(key, (map.get(key) ?? 0) + 1); };
  const flagByKey = new Map((flags.data ?? []).map((row) => [row.disposition_key, row]));
  const transfers = new Map<string, number>();
  const completed = new Map<string, number>();
  const dropped = new Map<string, number>();
  for (const row of sent.data ?? []) bump(transfers, row.partner_id);
  for (const row of closed.data ?? []) {
    const flag = row.disposition ? flagByKey.get(row.disposition) : undefined;
    if (flag?.counts_as_work_completed) bump(completed, row.partner_id);
    if (flag?.closes_as === "dropped") bump(dropped, row.partner_id);
  }
  const approved = new Map<string, string[]>();
  for (const row of products.data ?? []) if (row.product_code) approved.set(row.partner_id, [...(approved.get(row.partner_id) ?? []), row.product_code]);
  return (partners ?? []).map((partner) => {
    const partnerTerms = termMap.get(partner.id) ?? [];
    const leadDates = leadMap.get(partner.id) ?? [];
    // Terms are newest-first by effective date. A future-dated rate change is scheduled, not active:
    // the term in force is the newest one whose date has arrived in the partner's own timezone.
    const today = partnerLocalDate(partner.timezone);
    return {
      ...partner,
      terms: partnerTerms,
      active_term: partnerTerms.find((term) => term.effective_from <= today) ?? null,
      lead_volume_this_month: leadDates.length,
      last_submission: leadDates[0] ?? null,
      active_user_count: activeUsers.get(partner.id) ?? 0,
      transfers_this_month: transfers.get(partner.id) ?? 0,
      completed_this_month: completed.get(partner.id) ?? 0,
      dropped_this_month: dropped.get(partner.id) ?? 0,
      approved_products: approved.get(partner.id) ?? [],
    } as PartnerRow;
  });
}

export async function createPartner(tenantId: string, userId: string, input: PartnerInput, limits: Entitlement["limits"]) {
  const { data, error } = await getSupabaseServiceClient().rpc("create_partner", {
    p_tenant_id: tenantId, p_name: input.name, p_partner_type: input.partner_type, p_country: input.country,
    p_contact_name: input.contact_name ?? "", p_contact_email: input.contact_email ?? "", p_timezone: input.timezone,
    p_notes: input.notes ?? "", p_created_by: userId, p_max_partners: limits.max_partners ?? null,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not create partner");
  return data as unknown as PartnerRow;
}

export async function createPartnerWithLimits(tenantId: string, userId: string, input: PartnerInput, limits: Entitlement["limits"]) {
  const { data, error } = await getSupabaseServiceClient().rpc("create_partner_with_limits", {
    p_tenant_id: tenantId, p_name: input.name, p_partner_type: input.partner_type, p_country: input.country,
    p_contact_name: input.contact_name ?? "", p_contact_email: input.contact_email ?? "", p_timezone: input.timezone,
    p_notes: input.notes ?? "", p_created_by: userId, p_max_publishers: limits.max_publishers,
    p_max_marketing_partners: limits.max_marketing_partners, p_max_affiliates: limits.max_affiliates,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not create partner");
  return data as unknown as PartnerRow;
}

export async function updatePartner(tenantId: string, partnerId: string, input: PartnerInput, limits: Entitlement["limits"]) {
  const { data, error } = await getSupabaseServiceClient().rpc("update_partner_with_limits", {
    p_tenant_id: tenantId, p_partner_id: partnerId, p_name: input.name, p_partner_type: input.partner_type,
    p_country: input.country, p_contact_name: input.contact_name ?? "", p_contact_email: input.contact_email ?? "",
    p_timezone: input.timezone, p_notes: input.notes ?? "",
    p_max_publishers: limits.max_publishers, p_max_marketing_partners: limits.max_marketing_partners, p_max_affiliates: limits.max_affiliates,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not update partner");
  return data as unknown as PartnerRow;
}

export async function addPartnerTerm(tenantId: string, partnerId: string, userId: string, input: { payout_model: PartnerPayoutModel; rate_cents?: number | null; rate_pct_bp?: number | null; effective_from: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("add_partner_term", {
    p_tenant_id: tenantId, p_partner_id: partnerId, p_payout_model: input.payout_model,
    p_rate_cents: input.rate_cents ?? null, p_rate_pct_bp: input.rate_pct_bp ?? null,
    p_effective_from: input.effective_from, p_created_by: userId,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not add partner terms");
  return data as unknown as PartnerTermRow;
}

export async function transitionPartner(tenantId: string, partnerId: string, nextStatus: PartnerStatus, confirmation: string | undefined, limits: Entitlement["limits"]) {
  const { data, error } = await getSupabaseServiceClient().rpc("transition_partner_with_limits", {
    p_tenant_id: tenantId, p_partner_id: partnerId, p_next_status: nextStatus, p_confirmation: confirmation ?? null,
    p_max_publishers: limits.max_publishers, p_max_marketing_partners: limits.max_marketing_partners, p_max_affiliates: limits.max_affiliates, p_max_partner_users: limits.max_partner_users,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not change partner status");
  return data as unknown as PartnerRow;
}
