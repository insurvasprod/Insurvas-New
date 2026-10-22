import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_CHANGE_MAINTENANCE } from "@/lib/system/adminFormat";
import { PurgeError, purgeWorkspace } from "@/lib/tenants/purge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({
  reason: z.string().trim().min(10, "Say why (10 characters or more)").max(1000),
  confirmName: z.string().min(1, "Type the agency's name to confirm").max(200),
}).strict();

/**
 * Deletes a cancelled agency's workspace, on its request (tos-v2 §9). Irreversible, so super admin
 * only, with the agency's exact name typed and a reason. The database refuses while any subscription
 * is not cancelled or a legal hold is active, and deletes all or nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_CHANGE_MAINTENANCE);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const result = await purgeWorkspace({ tenantId: id, actorId: auth.session.sub, reason: parsed.data.reason, confirmName: parsed.data.confirmName });
    const rows = Object.values(result.deleted ?? {}).reduce((n, x) => n + Number(x), 0);
    await audit({ actorId: auth.session.sub, action: "tenant.workspace_purged", targetType: "tenant", targetId: id, reason: parsed.data.reason,
      metadata: { purgeId: result.purgeId, rowsDeleted: rows, tables: Object.keys(result.deleted ?? {}).length, accountsAnonymised: result.accountsAnonymised, filesRemoved: result.filesRemoved, fileProblems: result.fileProblems }, request });
    return NextResponse.json({ ok: true, purgeId: result.purgeId, rowsDeleted: rows, deleted: result.deleted, accountsAnonymised: result.accountsAnonymised, filesRemoved: result.filesRemoved, fileProblems: result.fileProblems, kept: result.kept });
  } catch (error) {
    if (error instanceof PurgeError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The deletion failed" }, { status: 500 });
  }
}
