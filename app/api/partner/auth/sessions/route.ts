import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getPartnerSession, requirePartner } from "@/lib/partnerAuth/requirePartner";
import { PARTNER_SESSION_COOKIE, continuedPartnerSession, partnerSessionCookie, signPartnerSessionToken } from "@/lib/partnerAuth/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({ action: z.literal("sign_out_others") }).strict();

/**
 * "Sign out other sessions" (p-par-settings › Security & sessions).
 *
 * Every session token carries the user's session_version, and every request checks it against the
 * user row (requirePartner / requireTenant). Raising it ends every session at once; this browser is
 * then handed a fresh token at the new version, so the one person pressing the button stays in.
 * The raise is conditional on the version read, so two presses cannot skip a number.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid session action." }, { status: 400 });

  const { tenantId, partnerId, userId } = auth.context;
  const db = getSupabaseServiceClient();
  const current = await db.from("users").select("session_version").eq("id", userId).maybeSingle<{ session_version: number }>();
  if (current.error || !current.data) return NextResponse.json({ error: "Could not sign out other sessions." }, { status: 503 });

  const next = current.data.session_version + 1;
  const updated = await db.from("users").update({ session_version: next }).eq("id", userId).eq("session_version", current.data.session_version).select("id");
  if (updated.error || !updated.data?.length) return NextResponse.json({ error: "Your sessions changed while this was running. Try again." }, { status: 409 });

  await audit({ actorType: "tenant", actorId: userId, action: "tenant.partner_sessions_revoked", targetType: "user", targetId: userId, metadata: { partnerId, actorPlane: "partner", scope: "other_sessions" }, request });
  // The fresh token continues this session: same "Keep me signed in" choice, same expiry. A
  // browser-session sign-in stays a browser session, and re-issuing never lengthens it.
  const session = continuedPartnerSession((await getPartnerSession()) ?? {});
  const token = await signPartnerSessionToken(userId, tenantId, partnerId, next, { remember: session.remember, expiresAt: session.expiresAt });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PARTNER_SESSION_COOKIE, token, partnerSessionCookie(session.remember, session.maxAge));
  return response;
}
