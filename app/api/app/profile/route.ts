import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { ownProfileInputSchema } from "@/lib/users/ownProfile";
import { OwnProfileError, readOwnProfile, saveOwnProfile } from "@/lib/users/ownProfileService";

/**
 * The signed-in person's own profile. Every role may read and edit their own — it is theirs, not
 * the agency's — and the ids come only from the verified session, never from the body.
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ profile: await readOwnProfile(auth.context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof OwnProfileError ? error.status : 503;
    return NextResponse.json({ error: error instanceof OwnProfileError ? error.message : "Your profile could not be loaded." }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = ownProfileInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the highlighted fields." }, { status: 400 });
  }
  try {
    const profile = await saveOwnProfile(auth.context, parsed.data);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.own_profile_updated",
      targetType: "user",
      targetId: auth.context.userId,
      // Which fields, not their values: a phone number and licence numbers do not belong in the log.
      metadata: { tenantId: auth.context.tenantId, fields: Object.keys(parsed.data) },
      request,
    });
    return NextResponse.json({ profile });
  } catch (error) {
    const status = error instanceof OwnProfileError ? error.status : 503;
    return NextResponse.json({ error: error instanceof OwnProfileError ? error.message : "Your profile could not be saved." }, { status });
  }
}
