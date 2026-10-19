import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SETTINGS } from "@/lib/settings/permissions";
import { workspacesDueForDeletion } from "@/lib/tenants/purge";

/** Cancelled agencies past their read-only window whose data has not been deleted. Read only. */
export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ due: await workspacesDueForDeletion() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the list" }, { status: 500 });
  }
}
