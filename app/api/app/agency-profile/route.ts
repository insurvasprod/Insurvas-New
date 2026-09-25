import { after, NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { checkAgencyNpn, niprConfigured } from "@/lib/agencyProfile/nipr";
import { getAgencyProfile, saveAgencyProfile } from "@/lib/agencyProfile/service";
import { TaxIdKeyMissingError } from "@/lib/agencyProfile/crypto";
import { agencyProfileInputSchema } from "@/lib/agencyProfile/types";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * Settings › Agency profile — the legal identity. Owners only, for reading as well as writing: the
 * response carries the decrypted federal tax ID ("Shown to owners only").
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
    const profile = await saveAgencyProfile(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      // Not in the shared AUDIT_ACTIONS list yet (lib/audit/actions.ts belongs to another change);
      // audit_log.action is free text, so the row is written either way.
      action: "tenant.agency_profile_saved",
      targetType: "agency_profile",
      targetId: auth.context.tenantId,
      // Which fields changed hands, never their values: the tax ID in particular stays out of the log.
      metadata: { fields: Object.keys(parsed.data).filter((key) => parsed.data[key as keyof typeof parsed.data] !== undefined), taxIdChanged: parsed.data.taxId !== undefined },
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
