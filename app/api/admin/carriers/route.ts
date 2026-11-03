import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CARRIER_COLUMNS, listPlatformCarriers, platformCodeTaken, readCarrierUsage } from "@/lib/carriers/adminService";
import { createCarrierSchema } from "@/lib/carriers/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const ROLES = ["super_admin", "platform_config"] as const;
const DUPLICATE = "A carrier with that code already exists";

/**
 * The platform carrier library (organization_id is null). `?picker=1` returns active carriers only
 * and skips usage; otherwise every platform carrier plus who uses it (usage.available is false until
 * migration 20260924357000 is applied — the page then shows "unknown", never 0).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const picker = request.nextUrl.searchParams.get("picker") === "1";
  try {
    const carriers = await listPlatformCarriers({ activeOnly: picker });
    if (picker) return NextResponse.json({ carriers });
    // A failed usage read degrades to "unknown" rather than taking the list down with it.
    const usage = await readCarrierUsage().catch(() => ({ available: false as const }));
    return NextResponse.json({ carriers, usage });
  } catch {
    return NextResponse.json({ error: "Could not load carriers" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const parsed = createCarrierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid carrier" }, { status: 400 });
  // The live table is unique on (organization_id, code) only, and NULLs are distinct, so a platform
  // duplicate is checked here too; 20260924357000's partial index is the backstop.
  try {
    if (await platformCodeTaken(parsed.data.code)) return NextResponse.json({ error: DUPLICATE }, { status: 409 });
  } catch {
    return NextResponse.json({ error: "Could not create carrier" }, { status: 500 });
  }
  const { data, error } = await getSupabaseServiceClient().from("carriers").insert(parsed.data).select(CARRIER_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? DUPLICATE : "Could not create carrier" }, { status: error.code === "23505" ? 409 : 500 });
  await audit({ actorId: auth.session.sub, action: "carrier.created", targetType: "carrier", targetId: data.id, metadata: { code: data.code, name: data.name }, request });
  return NextResponse.json({ carrier: data }, { status: 201 });
}
