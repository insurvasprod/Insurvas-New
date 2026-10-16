import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { listSecurityEvents } from "@/lib/users/securityEvents";

/**
 * LA-8.2 · my security log: what happened to how my account signs in, and failed sign-in bursts.
 * The person's own events only — the ids come from the session, never the request. Every role.
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { data: user } = await getSupabaseServiceClient().from("users").select("email").eq("id", auth.context.userId).maybeSingle<{ email: string }>();
  try {
    const events = await listSecurityEvents(auth.context.userId, user?.email ?? "");
    return NextResponse.json({ events, available: events !== null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[profile/security-events]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Your security log could not be read." }, { status: 503 });
  }
}
