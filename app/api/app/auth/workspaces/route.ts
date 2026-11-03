import { NextResponse } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { listUserWorkspaces } from "@/lib/tenantAuth/workspaceService";

/**
 * The workspaces the signed-in person belongs to, for the account menu's "Switch workspace" row.
 * Names and roles only — never another workspace's data. The user id is the verified session's.
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try {
    const workspaces = await listUserWorkspaces(auth.context.userId, auth.context.tenantId);
    return NextResponse.json(
      { workspaces: workspaces.map(({ tenantId, name, roleLabel, current }) => ({ tenantId, name, roleLabel, current })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Your workspaces could not be listed right now." }, { status: 503 });
  }
}
