import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { addressLinesOf, missingFor, requirementMessage, type BusinessDocument, type BusinessField, type IdentityFacts } from "./requirements";
import { LOGO_BUCKET } from "./service";

/**
 * LA-8.3 (Notion sprint) · the business identity as documents read it. Every document the platform
 * produces — the welcome pack, the payout statement, the dispute letter, the DOI response block, the
 * tax export — gets the business's name, address and numbers here, from the one record, rather than
 * a copy of its own (lib/agencyProfile/businessIdentity.test.mjs checks each one by grep).
 *
 * Never the tax ID itself: a document that needs it asks whether one is on file.
 */
export type BusinessIdentity = IdentityFacts & {
  addressLine2: string | null;
  email: string | null;
  website: string | null;
  logoPath: string | null;
  taxIdType: "ein" | "ssn" | null;
  taxIdLast4: string | null;
  /** "Street", "City, ST 12345" — empty when no address is stored. */
  addressLines: string[];
};

export class BusinessIdentityMissingError extends Error {
  readonly status = 409;
  readonly code = "BUSINESS_IDENTITY_MISSING";
  constructor(readonly document: BusinessDocument, readonly missing: BusinessField[]) {
    super(requirementMessage(document, missing));
    this.name = "BusinessIdentityMissingError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agency_profiles is not in database.types.ts
const db = () => getSupabaseServiceClient() as any;

/** The identity, or null when none has been saved. A failed read is an error, never an empty identity. */
export async function loadBusinessIdentity(tenantId: string): Promise<BusinessIdentity | null> {
  let { data, error } = await db().from("agency_profiles")
    .select("legal_name, dba, npn, address_line1, address_line2, city, state, postal_code, phone, email, website, logo_path, tax_id_type, tax_id_last4")
    .eq("tenant_id", tenantId).maybeSingle();
  // Before 20261015300000 the record has no address parts or phone: read what it has, so a document
  // that needs neither still works and the rest name the field that is missing, instead of failing.
  if (error && isPendingSchema(error)) {
    ({ data, error } = await db().from("agency_profiles").select("legal_name, dba, npn, tax_id_last4").eq("tenant_id", tenantId).maybeSingle());
  }
  if (error) throw new Error(`Could not read the business identity: ${error.message}`);
  if (!data) return null;
  const facts = {
    tradingName: data.dba ?? null,
    legalName: data.legal_name ?? null,
    npn: data.npn ?? null,
    addressLine1: data.address_line1 ?? null,
    addressLine2: data.address_line2 ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    postalCode: data.postal_code ?? null,
    phone: data.phone ?? null,
  };
  return {
    ...facts,
    email: data.email ?? null,
    website: data.website ?? null,
    logoPath: data.logo_path ?? null,
    taxIdType: data.tax_id_type ?? null,
    taxIdLast4: data.tax_id_last4 ?? null,
    // The last four are stored with every tax ID and cleared with it, so a document learns that one is on
    // file without the ciphertext ever being read.
    hasTaxId: Boolean(data.tax_id_last4),
    addressLines: addressLinesOf(facts),
  };
}

/** The identity, checked for one document: throws a prompt naming the missing fields and the document. */
export async function requireBusinessIdentity(tenantId: string, document: BusinessDocument): Promise<BusinessIdentity> {
  const identity = await loadBusinessIdentity(tenantId);
  const missing = missingFor(identity, document);
  if (missing.length || !identity) throw new BusinessIdentityMissingError(document, missing);
  return identity;
}

/** The logo's bytes for a PDF, or null — then the document prints the trading name as text, never a broken image. */
export async function businessLogo(identity: Pick<BusinessIdentity, "logoPath">, tenantId: string): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!identity.logoPath || !identity.logoPath.startsWith(`${tenantId}/`)) return null;
  const file = await db().storage.from(LOGO_BUCKET).download(identity.logoPath);
  if (file.error || !file.data) return null;
  return { bytes: new Uint8Array(await file.data.arrayBuffer()), type: identity.logoPath.endsWith(".png") ? "png" : "jpg" };
}
