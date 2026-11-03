import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { BusinessIdentityError, LOGO_MAX_BYTES, removeBusinessLogo, setBusinessLogo } from "@/lib/agencyProfile/service";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * LA-8.3 · the business logo the welcome pack and statements print. Owners only. A PNG or JPEG of at
 * most 512 KB, into the agency's own folder of a private bucket. Without one, documents print the
 * trading name as text.
 */
import { recordSettingsChanges } from "@/lib/settingsAudit/record";

async function respond(request: NextRequest, run: (tenantId: string, userId: string) => Promise<unknown>, change: "replaced" | "removed") {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const profile = await run(auth.context.tenantId, auth.context.userId);
    await recordSettingsChanges({
      tenantId: auth.context.tenantId,
      actorId: auth.context.userId,
      section: "business-identity",
      changes: [{ key: "logo", label: "Logo", from: change === "replaced" ? null : "Logo", to: change === "replaced" ? "New logo uploaded" : null, changeType: change === "replaced" ? "update" : "delete" }],
    });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.business_logo_changed", targetType: "agency_profile", targetId: auth.context.tenantId, metadata: { tenantId: auth.context.tenantId, change }, request });
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof BusinessIdentityError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("[agency-profile] logo", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The logo could not be saved" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LOGO_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "A logo can be at most 512 KB." }, { status: 413 });
  return respond(request, async (tenantId, userId) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new BusinessIdentityError("Choose an image to upload.", 400);
    return setBusinessLogo(tenantId, userId, file);
  }, "replaced");
}

export async function DELETE(request: NextRequest) {
  return respond(request, (tenantId, userId) => removeBusinessLogo(tenantId, userId), "removed");
}
