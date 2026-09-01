import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
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

export async function listPartners(tenantId: string): Promise<PartnerRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data: partners, error } = await supabase.from("partners").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load partners: ${error.message}`);
  const ids = (partners ?? []).map((partner) => partner.id);
  if (ids.length === 0) return [];

  const [terms, users, leads] = await Promise.all([
    supabase.from("partner_terms").select("*").in("partner_id", ids).order("effective_from", { ascending: false }),
    supabase.from("partner_users").select("partner_id, status").in("partner_id", ids),
    supabase.from("agent_leads").select("partner_id, created_at").eq("tenant_id", tenantId).in("partner_id", ids).gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()).order("created_at", { ascending: false }),
  ]);
  const relatedError = [terms, users, leads].find((result) => result.error)?.error;
  if (relatedError) throw new Error(`Could not load partner details: ${relatedError.message}`);
  const termMap = new Map<string, PartnerTermRow[]>();
  for (const term of (terms.data ?? []) as PartnerTermRow[]) termMap.set(term.partner_id, [...(termMap.get(term.partner_id) ?? []), term]);
  const leadMap = new Map<string, string[]>();
  for (const lead of leads.data ?? []) if (lead.partner_id) leadMap.set(lead.partner_id, [...(leadMap.get(lead.partner_id) ?? []), lead.created_at]);
  const activeUsers = new Map<string, number>();
  for (const user of users.data ?? []) if (user.status === "active") activeUsers.set(user.partner_id, (activeUsers.get(user.partner_id) ?? 0) + 1);
  return (partners ?? []).map((partner) => {
    const partnerTerms = termMap.get(partner.id) ?? [];
    const leadDates = leadMap.get(partner.id) ?? [];
    return { ...partner, terms: partnerTerms, active_term: partnerTerms[0] ?? null, lead_volume_this_month: leadDates.length, last_submission: leadDates[0] ?? null, active_user_count: activeUsers.get(partner.id) ?? 0 } as PartnerRow;
  });
}

export async function createPartner(tenantId: string, userId: string, input: PartnerInput, maxPartners: number | null | undefined) {
  const { data, error } = await getSupabaseServiceClient().rpc("create_partner", {
    p_tenant_id: tenantId, p_name: input.name, p_partner_type: input.partner_type, p_country: input.country,
    p_contact_name: input.contact_name ?? "", p_contact_email: input.contact_email ?? "", p_timezone: input.timezone,
    p_notes: input.notes ?? "", p_created_by: userId, p_max_partners: maxPartners ?? null,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not create partner");
  return data as unknown as PartnerRow;
}

export async function updatePartner(tenantId: string, partnerId: string, input: PartnerInput) {
  const { data, error } = await getSupabaseServiceClient().rpc("update_partner", {
    p_tenant_id: tenantId, p_partner_id: partnerId, p_name: input.name, p_partner_type: input.partner_type,
    p_country: input.country, p_contact_name: input.contact_name ?? "", p_contact_email: input.contact_email ?? "",
    p_timezone: input.timezone, p_notes: input.notes ?? "",
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

export async function transitionPartner(tenantId: string, partnerId: string, nextStatus: PartnerStatus, confirmation?: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("transition_partner", {
    p_tenant_id: tenantId, p_partner_id: partnerId, p_next_status: nextStatus, p_confirmation: confirmation ?? null,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not change partner status");
  return data as unknown as PartnerRow;
}
