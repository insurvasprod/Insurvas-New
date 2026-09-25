import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { claimConsentCertificate, outboundLimitResponse } from "@/lib/compliance/consentClaims";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const schema = z.object({ artefact_id: z.string().uuid(), stored_copy: z.record(z.string(), z.unknown()).default({}) }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A consent certificate and stored copy are required" }, { status: 400 });
  try { return NextResponse.json({ artefact: await claimConsentCertificate({ tenantId: auth.context.tenantId, artefactId: parsed.data.artefact_id, storedCopy: parsed.data.stored_copy }) }); }
  catch (error) { const limit = outboundLimitResponse(error); if (limit) return NextResponse.json(limit, { status: 403 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Could not claim consent certificate" }, { status: 400 }); }
}
