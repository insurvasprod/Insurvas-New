import { NextResponse, type NextRequest } from "next/server";

import { getAppointmentVault } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The appointment vault: the agency's licences, carriers and appointments.
 *
 * `?mine=1` (the phone's Licences, mobile board I7 "your licences") adds `mine`: the states the signed-in person is
 * licensed in themselves and the day each lapses, as the owner recorded them on the team page — their own rows only,
 * read by the session's user id, never a parameter. Null when they cannot be read.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", [
    "owner",
    "producer",
  ]);
  if (auth instanceof NextResponse) return auth;
  try {
    const wantMine = request.nextUrl.searchParams.get("mine") === "1";
    const [vault, mine] = await Promise.all([
      getAppointmentVault(auth.context.tenantId),
      wantMine ? ownLicences(auth.context.tenantId, auth.context.userId) : Promise.resolve(undefined),
    ]);
    return NextResponse.json(wantMine ? { ...vault, mine } : vault, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load the appointment vault" },
      { status: 500 },
    );
  }
}

/** The person's own licensed states with their expiry (before 20260925702000 the rows carry none). */
async function ownLicences(tenantId: string, userId: string): Promise<{ state: string; expiresOn: string | null }[] | null> {
  const db = getSupabaseServiceClient();
  const read = (columns: string) => db.from("tenant_user_licensed_states" as never).select(columns).eq("tenant_id", tenantId).eq("user_id", userId);
  let result = await read("state, expires_on");
  if (result.error && /expires_on/.test((result.error as { message?: string }).message ?? "")) result = await read("state");
  if (result.error) return null;
  const rows = (result.data ?? []) as unknown as Array<{ state: string; expires_on?: string | null }>;
  return rows.map((r) => ({ state: r.state, expiresOn: r.expires_on ?? null })).sort((a, b) => a.state.localeCompare(b.state));
}
