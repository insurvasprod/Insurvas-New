import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { outboundLimitResponse } from "@/lib/compliance/consentClaims";
import { claimConsentWithProvider, ConsentClaimRefusal } from "@/lib/consent/claim";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";

// The copy is optional now: with provider credentials configured it is fetched from the provider.
const schema = z.object({ artefact_id: z.string().uuid(), stored_copy: z.record(z.string(), z.unknown()).default({}) }).strict();

/**
 * LA-2.6-2 · claim a consent certificate inside its provider's claim window, fetching the copy from
 * the provider when this server has its credentials, and saying so plainly when it does not.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the consent certificate to claim" }, { status: 400 });
  try {
    const result = await claimConsentWithProvider({ tenantId: auth.context.tenantId, artefactId: parsed.data.artefact_id, storedCopy: parsed.data.stored_copy });
    if (!result.alreadyClaimed)
      await audit({
        actorType: "tenant", actorId: auth.context.userId,
        action: "tenant.consent_certificate_claimed",
        targetType: "tenant_consent_artefact", targetId: parsed.data.artefact_id,
        metadata: { providerFetched: result.providerFetched, claimableUntil: result.claimableUntil },
        request,
      });
    return NextResponse.json({ artefact: result.artefact, alreadyClaimed: result.alreadyClaimed, providerFetched: result.providerFetched, note: result.note, claimableUntil: result.claimableUntil });
  } catch (error) {
    if (error instanceof ConsentClaimRefusal) {
      if ((error as ConsentClaimRefusal & { expiredNow?: boolean }).expiredNow || error.code === "provider_says_expired")
        await audit({
          actorType: "tenant", actorId: auth.context.userId,
          action: "tenant.consent_certificate_expired",
          targetType: "tenant_consent_artefact", targetId: parsed.data.artefact_id,
          metadata: { reason: error.code, message: error.message },
          request,
        });
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const limit = outboundLimitResponse(error);
    if (limit) return NextResponse.json(limit, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not claim consent certificate" }, { status: 400 });
  }
}
