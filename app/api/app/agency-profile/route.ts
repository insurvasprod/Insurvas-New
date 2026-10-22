import { after, NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { checkAgencyNpn, niprConfigured } from "@/lib/agencyProfile/nipr";
import { getAgencyProfile, saveAgencyProfile } from "@/lib/agencyProfile/service";
import { TaxIdKeyMissingError } from "@/lib/agencyProfile/crypto";
import { agencyProfileInputSchema } from "@/lib/agencyProfile/types";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { changedFields, recordSettingsChanges } from "@/lib/settingsAudit/record";

/** What the settings history records for Business identity. The tax ID only ever as its last four. */
const IDENTITY_FIELDS = [
  { key: "dba", label: "Trading name" },
  { key: "legalName", label: "Legal name" },
  { key: "npn", label: "National Producer Number" },
  { key: "entityType", label: "Entity type" },
  { key: "taxIdLast4", label: "Tax ID", mask: (value: unknown) => (value ? `ending ${value}` : null) },
  { key: "addressLine1", label: "Address line 1" },
  { key: "addressLine2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "ZIP code" },
  { key: "phone", label: "Business phone" },
  { key: "email", label: "Business email" },
  { key: "website", label: "Website" },
  { key: "timezone", label: "Business timezone" },
] as const;

/**
 * Settings › Business identity (LA-8.3) — who the business is, on every document it produces. Owners
 * only. The tax ID is never in the response: it is masked, and shown in full only through
 * POST /api/app/agency-profile/tax-id, one audited reveal at a time.
 */
export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getAgencyProfile(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[agency-profile] failed to load", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the agency profile" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = agencyProfileInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid agency profile" }, { status: 400 });
  try {
    const before = (await getAgencyProfile(auth.context.tenantId).catch(() => null))?.profile ?? null;
    const profile = await saveAgencyProfile(auth.context.tenantId, auth.context.userId, parsed.data);
    await recordSettingsChanges({
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      section: "business-identity",
      changes: changedFields(before as Record<string, unknown> | null, profile as unknown as Record<string, unknown>, IDENTITY_FIELDS),
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.agency_profile_saved",
      targetType: "agency_profile",
      targetId: auth.context.tenantId,
      // Which fields changed hands, never their values: the tax ID in particular stays out of the log.
      metadata: { tenantId: auth.context.tenantId, fields: Object.keys(parsed.data).filter((key) => parsed.data[key as keyof typeof parsed.data] !== undefined), taxIdChanged: parsed.data.taxId !== undefined },
      request,
    });
    // A new or changed NPN is checked against NIPR once a client is connected (lib/agencyProfile/nipr.ts).
    // After the response: the lookup is a third-party call, and the next read shows its result.
    if (profile.npn && !profile.npnVerifiedAt && niprConfigured()) {
      const npn = profile.npn;
      after(() => checkAgencyNpn(auth.context.tenantId, npn, profile.legalName).then(() => undefined));
    }
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof SchemaPendingError || error instanceof TaxIdKeyMissingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the agency profile" }, { status: 400 });
  }
}
