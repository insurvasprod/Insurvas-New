import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerType, PartnerStatus } from "@/lib/partners/constants";

export type AffiliateLink = {
  id: string;
  tenant_id: string;
  partner_id: string;
  slug: string;
  campaign: string | null;
  is_active: boolean;
  click_count: number;
  created_at: string;
  updated_at: string;
  partner_name: string;
  partner_status: PartnerStatus;
  partner_timezone: string;
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

function normalizeSlug(value: string) {
  return value.trim().toLowerCase();
}

function rowToLink(row: Record<string, unknown>): AffiliateLink {
  const partner = (row.partners ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id), tenant_id: String(row.tenant_id), partner_id: String(row.partner_id), slug: String(row.slug), campaign: typeof row.campaign === "string" ? row.campaign : null,
    is_active: Boolean(row.is_active), click_count: Number(row.click_count ?? 0), created_at: String(row.created_at), updated_at: String(row.updated_at),
    partner_name: String(partner.name ?? ""), partner_status: partner.status as PartnerStatus, partner_timezone: String(partner.timezone ?? "UTC"),
  };
}

export async function listAffiliateLinks(tenantId: string, partnerId: string) {
  const { data, error } = await getSupabaseServiceClient().from("affiliate_links").select("id, tenant_id, partner_id, slug, campaign, is_active, click_count, created_at, updated_at, partners!inner(name, status, timezone, partner_type)").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("partners.partner_type", "affiliate").order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load affiliate links: ${error.message}`);
  return (data ?? []).map((row) => rowToLink(row as unknown as Record<string, unknown>));
}

export async function createAffiliateLink(tenantId: string, partnerId: string, input: { slug?: string; campaign?: string | null }) {
  const supabase = getSupabaseServiceClient();
  const partner = await supabase.from("partners").select("id, partner_type, status").eq("id", partnerId).eq("tenant_id", tenantId).maybeSingle<{ id: string; partner_type: PartnerType; status: PartnerStatus }>();
  if (partner.error) throw new Error(`Could not load affiliate partner: ${partner.error.message}`);
  if (!partner.data || partner.data.partner_type !== "affiliate") throw new Error("affiliate_partner_required");
  if (partner.data.status === "offboarded") throw new Error("partner_offboarded");
  const slug = normalizeSlug(input.slug || `affiliate-${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  if (!SLUG_PATTERN.test(slug)) throw new Error("invalid_affiliate_slug");
  const campaign = input.campaign?.trim() || null;
  const { data, error } = await supabase.from("affiliate_links").insert({ tenant_id: tenantId, partner_id: partnerId, slug, campaign }).select("id, tenant_id, partner_id, slug, campaign, is_active, click_count, created_at, updated_at, partners!inner(name, status, timezone, partner_type)").single();
  if (error || !data) throw new Error(error?.code === "23505" ? "affiliate_slug_taken" : error?.message ?? "Could not create affiliate link");
  return rowToLink(data as unknown as Record<string, unknown>);
}

export async function updateAffiliateLink(tenantId: string, partnerId: string, linkId: string, isActive: boolean) {
  const { data, error } = await getSupabaseServiceClient().from("affiliate_links").update({ is_active: isActive }).eq("id", linkId).eq("tenant_id", tenantId).eq("partner_id", partnerId).select("id, tenant_id, partner_id, slug, campaign, is_active, click_count, created_at, updated_at, partners!inner(name, status, timezone, partner_type)").single();
  if (error || !data) throw new Error(error?.message ?? "Could not update affiliate link");
  return rowToLink(data as unknown as Record<string, unknown>);
}

export async function getAffiliateLinkBySlug(slug: string) {
  const normalized = normalizeSlug(slug);
  if (!SLUG_PATTERN.test(normalized)) return null;
  const { data, error } = await getSupabaseServiceClient().from("affiliate_links").select("id, tenant_id, partner_id, slug, campaign, is_active, click_count, created_at, updated_at, partners!inner(name, status, timezone, partner_type)").eq("slug", normalized).eq("partners.partner_type", "affiliate").maybeSingle();
  if (error) throw new Error(`Could not load affiliate link: ${error.message}`);
  return data ? rowToLink(data as unknown as Record<string, unknown>) : null;
}

export async function recordAffiliateClick(slug: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("record_affiliate_link_click", { p_slug: normalizeSlug(slug) });
  if (error) throw new Error(`Could not record affiliate click: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? {
    id: row.id, tenant_id: row.tenant_id, partner_id: row.partner_id, slug: row.slug, campaign: row.campaign ?? null,
    is_active: true, click_count: Number(row.click_count ?? 0), created_at: "", updated_at: "", partner_name: row.partner_name,
    partner_status: row.partner_status as PartnerStatus, partner_timezone: row.partner_timezone,
  } satisfies AffiliateLink : null;
}
