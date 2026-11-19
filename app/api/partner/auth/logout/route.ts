import { NextResponse } from "next/server";

import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { PARTNER_SESSION_COOKIE } from "@/lib/partnerAuth/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Signing out of the partner portal ends the person's partner sessions on the server, every
 * browser at once (security review 2026-11, M-2). Every partner token carries users.session_version
 * and requirePartner compares it on each request, so raising the column is what ends a session; a
 * copied cookie stops working with it. Agency accounts never open the partner portal
 * (lib/auth/planeSeparation.ts), so this ends no agency session.
 *
 * Only a session that is still live raises it. A cookie that was already ended changes nothing, or
 * a copied old cookie could keep signing its owner out. The raise is conditional on the version
 * read, so two sign-outs at once cannot skip a number. The cookie is cleared whatever happens.
 */
export async function POST() {
  const context = await resolvePartnerContext();
  if (context) {
    const db = getSupabaseServiceClient();
    const current = await db.from("users").select("session_version").eq("id", context.userId).maybeSingle<{ session_version: number }>();
    if (current.data) {
      const ended = await db
        .from("users")
        .update({ session_version: current.data.session_version + 1 })
        .eq("id", context.userId)
        .eq("session_version", current.data.session_version)
        .select("id");
      if (ended.error) console.error("[partner-logout] could not end the partner's sessions on the server", ended.error.message);
    } else if (current.error) {
      console.error("[partner-logout] could not read the session version", current.error.message);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(PARTNER_SESSION_COOKIE);
  return response;
}
