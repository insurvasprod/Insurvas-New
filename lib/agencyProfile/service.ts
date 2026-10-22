import "server-only";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema, SchemaPendingError } from "@/lib/carriers/schemaGap";
import { decryptTaxId, encryptTaxId } from "./crypto";
import { niprConfigured } from "./nipr";
import { normalizeTaxId, type AgencyProfileInput, type AgencyProfileResponse, type AgencyProfileView, type EntityType, type NpnCheckStatus, type TaxIdType } from "./types";

/** agency_profiles is not in the shared generated types yet; typed here. */
type AgencyProfileRecord = {
  tenant_id: string;
  legal_name: string;
  dba: string | null;
  npn: string | null;
  npn_verified_at: string | null;
  npn_check_status?: NpnCheckStatus | null;
  npn_checked_at?: string | null;
  entity_type: EntityType | null;
  tax_id_type: TaxIdType | null;
  tax_id_ciphertext: string | null;
  tax_id_last4: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  principal_address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_path: string | null;
  timezone: string | null;
  updated_at: string;
};

export const LOGO_BUCKET = "business-logos";
export const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_URL_SECONDS = 300;

const COLUMNS = "tenant_id, legal_name, dba, npn, npn_verified_at, npn_check_status, npn_checked_at, entity_type, tax_id_type, tax_id_ciphertext, tax_id_last4, address_line1, address_line2, city, state, postal_code, country, principal_address, phone, email, website, logo_path, timezone, updated_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table and RPCs are not in database.types.ts (shared; not ours to regenerate)
const untyped = () => getSupabaseServiceClient() as any;

export class BusinessIdentityError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BusinessIdentityError";
  }
}

async function logoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await untyped().storage.from(LOGO_BUCKET).createSignedUrl(path, LOGO_URL_SECONDS);
  return data?.signedUrl ?? null;
}

async function toView(row: AgencyProfileRecord): Promise<AgencyProfileView> {
  return {
    legalName: row.legal_name,
    dba: row.dba,
    npn: row.npn,
    npnVerifiedAt: row.npn_verified_at,
    npnCheckStatus: row.npn_check_status ?? null,
    npnCheckedAt: row.npn_checked_at ?? null,
    entityType: row.entity_type,
    taxIdType: row.tax_id_type,
    hasTaxId: Boolean(row.tax_id_ciphertext),
    taxIdLast4: row.tax_id_last4,
    // Whether this server could show it — decided here, the value itself never leaves.
    taxIdReadable: !row.tax_id_ciphertext || decryptTaxId(row.tax_id_ciphertext) !== null,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country ?? "US",
    principalAddress: row.principal_address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    logoUrl: await logoUrl(row.logo_path),
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

/** The columns before 20261015300000, so the stored identity still shows until the migration is applied. */
const LEGACY_COLUMNS = "tenant_id, legal_name, dba, npn, npn_verified_at, tax_id_ciphertext, tax_id_last4, principal_address, timezone, updated_at";

async function readRow(tenantId: string): Promise<{ row: AgencyProfileRecord | null; schemaReady: boolean }> {
  const stored = await untyped().from("agency_profiles").select(COLUMNS).eq("tenant_id", tenantId).maybeSingle();
  if (stored.error && isPendingSchema(stored.error)) {
    const legacy = await untyped().from("agency_profiles").select(LEGACY_COLUMNS).eq("tenant_id", tenantId).maybeSingle();
    if (legacy.error || !legacy.data) return { row: null, schemaReady: false };
    // The old one-line address shows as line 1, as the migration's backfill will store it.
    return { row: { entity_type: null, tax_id_type: legacy.data.tax_id_ciphertext ? "ein" : null, address_line1: legacy.data.principal_address, address_line2: null, city: null, state: null, postal_code: null, country: "US", phone: null, email: null, website: null, logo_path: null, ...legacy.data }, schemaReady: false };
  }
  if (stored.error) throw new Error(`Could not load the business identity: ${stored.error.message}`);
  return { row: (stored.data as AgencyProfileRecord | null) ?? null, schemaReady: true };
}

/**
 * The stored identity — or, before the owner has saved one, what the product already knows: the
 * business name and NPN from the signup questionnaire, else the workspace name.
 */
export async function getAgencyProfile(tenantId: string): Promise<AgencyProfileResponse> {
  const { row, schemaReady } = await readRow(tenantId);
  if (row) return { profile: await toView(row), schemaReady, niprConfigured: niprConfigured() };

  const supabase = getSupabaseServiceClient();
  const [business, tenant] = await Promise.all([
    supabase.from("business_profiles").select("business_name, npn").eq("tenant_id", tenantId).maybeSingle<{ business_name: string; npn: string }>(),
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle<{ name: string }>(),
  ]);
  return {
    schemaReady,
    niprConfigured: niprConfigured(),
    profile: {
      legalName: business.data?.business_name ?? tenant.data?.name ?? "",
      dba: null, npn: business.data?.npn ?? null, npnVerifiedAt: null, npnCheckStatus: null, npnCheckedAt: null,
      entityType: null, taxIdType: null, hasTaxId: false, taxIdLast4: null, taxIdReadable: true,
      addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: "US", principalAddress: null,
      phone: null, email: null, website: null, logoUrl: null, timezone: null, updatedAt: null,
    },
  };
}

/** Encrypts a changed tax ID, then saves the row and its dated history entry in one RPC. */
export async function saveAgencyProfile(tenantId: string, actorId: string, input: AgencyProfileInput): Promise<AgencyProfileView> {
  const taxIdChange = input.taxId !== undefined;
  const taxIdType = input.taxIdType ?? "ein";
  const taxId = input.taxId && input.taxId.trim() ? normalizeTaxId(input.taxId, taxIdType) : null;
  const { data, error } = await untyped()
    .rpc("save_business_identity", {
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_identity: {
        legal_name: input.legalName, trading_name: input.dba, npn: input.npn, entity_type: input.entityType,
        tax_id_type: taxId ? taxIdType : input.taxIdType,
        address_line1: input.addressLine1, address_line2: input.addressLine2, city: input.city, state: input.state, postal_code: input.postalCode,
        phone: input.phone, email: input.email, website: input.website, timezone: input.timezone,
      },
      p_tax_id_change: taxIdChange,
      p_tax_id_ciphertext: taxId ? encryptTaxId(taxId) : null,
      p_tax_id_last4: taxId ? taxId.replace(/\D/g, "").slice(-4) : null,
    })
    .single();
  if (error && isPendingSchema(error)) throw new SchemaPendingError();
  if (error || !data) throw new Error(error?.message?.replace(/^\w+: /, "") ?? "Could not save the business identity");
  return toView(data as AgencyProfileRecord);
}

/**
 * Reveal the business tax ID — one audit row per reveal, written before anything is decrypted: no
 * audit row, no reveal. The same handling as an applicant's SSN (LA-3.7), because for a sole
 * proprietor this number is one.
 */
export async function revealAgencyTaxId(tenantId: string, userId: string, request: Request): Promise<string> {
  const { row } = await readRow(tenantId);
  if (!row?.tax_id_ciphertext) throw new BusinessIdentityError("No tax ID is on file.", 404);
  await audit({
    actorType: "tenant",
    actorId: userId,
    action: "tenant.agency_tax_id_revealed",
    targetType: "agency_profile",
    targetId: tenantId,
    metadata: { tenantId, taxIdType: row.tax_id_type, last4: row.tax_id_last4 },
    request,
  });
  const value = decryptTaxId(row.tax_id_ciphertext);
  if (!value) throw new BusinessIdentityError("The tax ID is stored, but this server has no key to show it.", 503);
  return value;
}

const LOGO_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};

/** Store a new logo (PNG or JPEG, at most 512 KB, checked by its bytes as well as its type) and point the identity at it. */
export async function setBusinessLogo(tenantId: string, actorId: string, file: File): Promise<AgencyProfileView> {
  const kind = LOGO_TYPES[file.type];
  if (!kind) throw new BusinessIdentityError("A logo is a PNG or JPEG image.", 400);
  if (file.size > LOGO_MAX_BYTES) throw new BusinessIdentityError("A logo can be at most 512 KB.", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!kind.magic(bytes)) throw new BusinessIdentityError("That file is not the image its name says it is.", 400);
  const path = `${tenantId}/logo-${Date.now()}.${kind.ext}`;
  const up = await untyped().storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error) throw new BusinessIdentityError(`The logo could not be stored: ${up.error.message}`, 500);
  const { data: old, error } = await untyped().rpc("set_business_logo", { p_tenant_id: tenantId, p_actor_id: actorId, p_path: path });
  if (error) {
    await untyped().storage.from(LOGO_BUCKET).remove([path]);
    if (isPendingSchema(error)) throw new SchemaPendingError();
    throw new BusinessIdentityError(error.message.replace(/^\w+: /, ""), 400);
  }
  if (typeof old === "string" && old.startsWith(`${tenantId}/`)) await untyped().storage.from(LOGO_BUCKET).remove([old]);
  const { row } = await readRow(tenantId);
  return toView(row!);
}

/** Remove the logo: documents print the trading name as text instead. */
export async function removeBusinessLogo(tenantId: string, actorId: string): Promise<AgencyProfileView> {
  const { data: old, error } = await untyped().rpc("set_business_logo", { p_tenant_id: tenantId, p_actor_id: actorId, p_path: null });
  if (error) {
    if (isPendingSchema(error)) throw new SchemaPendingError();
    throw new BusinessIdentityError(error.message.replace(/^\w+: /, ""), 400);
  }
  if (typeof old === "string" && old.startsWith(`${tenantId}/`)) await untyped().storage.from(LOGO_BUCKET).remove([old]);
  const { row } = await readRow(tenantId);
  return toView(row!);
}
