import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { fetchAddons } from "@/lib/addons/queries";
import { createAddonSchema } from "@/lib/addons/schemas";
import { addonMutationError, upsertAddon } from "@/lib/addons/admin";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ addons: await fetchAddons() });
  } catch {
    return NextResponse.json({ error: "Could not load add-ons" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;
  const parsed = createAddonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  try {
    const id = await upsertAddon(parsed.data);
    await audit({ actorId: auth.session.sub, action: "addon.created", targetType: "addon", targetId: id, metadata: { code: parsed.data.code }, request });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    const mapped = addonMutationError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
