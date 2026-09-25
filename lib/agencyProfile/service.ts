import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema, SchemaPendingError } from "@/lib/carriers/schemaGap";
import { decryptTaxId, encryptTaxId } from "./crypto";
import { niprConfigured } from "./nipr";
import { normalizeTaxId, type AgencyProfileInput, type AgencyProfileResponse, type AgencyProfileView, type NpnCheckStatus } from "./types";

/** agency_profiles is not in the shared generated types yet; typed here. */
type AgencyProfileRecord = {
  tenant_id: string;
  legal_name: string;
  dba: string | null;
  npn: string | null;
  npn_verified_at: string | null;
  /** Migration 20260924220000; absent before it. */
  npn_check_status?: NpnCheckStatus | null;
  npn_checked_at?: string | null;
  tax_id_ciphertext: string | null;
  tax_id_last4: string | null;
  principal_address: string | null;
  timezone: string | null;
  updated_at: string;
};

const COLUMNS = "tenant_id, legal_name, dba, npn, npn_verified_at, tax_id_ciphertext, tax_id_last4, principal_address, timezone, updated_at";
/** COLUMNS plus the NIPR check (migration 20260924220000), read first and dropped if not there yet. */
const COLUMNS_WITH_CHECK = `${COLUMNS}, npn_check_status, npn_checked_at`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the new table and RPC are not in database.types.ts (shared; not ours to regenerate)
const untyped = () => getSupabaseServiceClient() as any;

function toView(row: AgencyProfileRecord): AgencyProfileView {
  const taxId = decryptTaxId(row.tax_id_ciphertext);
  return {
    legalName: row.legal_name,
    dba: row.dba,
    npn: row.npn,
    npnVerifiedAt: row.npn_verified_at,
    npnCheckStatus: row.npn_check_status ?? null,
    npnCheckedAt: row.npn_checked_at ?? null,
    taxId,
    taxIdLast4: row.tax_id_last4,
    taxIdReadable: !row.tax_id_ciphertext || taxId !== null,
    principalAddress: row.principal_address,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

/**
 * The stored legal identity — or, before the owner has saved one, what the product already knows:
 * the business name and NPN from the signup questionnaire, else the workspace name.
 */
export async function getAgencyProfile(tenantId: string): Promise<AgencyProfileResponse> {
  const supabase = getSupabaseServiceClient();
  const withCheck = await untyped().from("agency_profiles").select(COLUMNS_WITH_CHECK).eq("tenant_id", tenantId).maybeSingle();
  const stored = withCheck.error && isPendingSchema(withCheck.error)
    ? await untyped().from("agency_profiles").select(COLUMNS).eq("tenant_id", tenantId).maybeSingle()
    : withCheck;
  const schemaReady = !(stored.error && isPendingSchema(stored.error));
  if (stored.error && schemaReady) throw new Error(`Could not load the agency profile: ${stored.error.message}`);
  if (stored.data) return { profile: toView(stored.data as AgencyProfileRecord), schemaReady, niprConfigured: niprConfigured() };

  const [business, tenant] = await Promise.all([
    supabase.from("business_profiles").select("business_name, npn").eq("tenant_id", tenantId).maybeSingle<{ business_name: string; npn: string }>(),
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle<{ name: string }>(),
  ]);
  return {
    schemaReady,
    niprConfigured: niprConfigured(),
    profile: {
      legalName: business.data?.business_name ?? tenant.data?.name ?? "",
      dba: null,
      npn: business.data?.npn ?? null,
      npnVerifiedAt: null,
      npnCheckStatus: null,
      npnCheckedAt: null,
      taxId: null,
      taxIdLast4: null,
      taxIdReadable: true,
      principalAddress: null,
      timezone: null,
      updatedAt: null,
    },
  };
}

/** Encrypts a changed tax ID, then saves the row and its dated history entry in one RPC. */
export async function saveAgencyProfile(tenantId: string, actorId: string, input: AgencyProfileInput): Promise<AgencyProfileView> {
  const taxIdChange = input.taxId !== undefined;
  const taxId = input.taxId ? normalizeTaxId(input.taxId) : null;
  const { data, error } = await untyped()
    .rpc("save_agency_profile", {
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_legal_name: input.legalName,
      p_dba: input.dba,
      p_npn: input.npn,
      p_tax_id_change: taxIdChange,
      p_tax_id_ciphertext: taxId ? encryptTaxId(taxId) : null,
      p_tax_id_last4: taxId ? taxId.replace(/\D/g, "").slice(-4) : null,
      p_principal_address: input.principalAddress,
      p_timezone: input.timezone,
    })
    .single();
  if (error && isPendingSchema(error)) throw new SchemaPendingError();
  if (error || !data) throw new Error(error?.message ?? "Could not save the agency profile");
  return toView(data as AgencyProfileRecord);
}
