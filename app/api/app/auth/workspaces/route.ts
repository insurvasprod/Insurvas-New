import { NextResponse } from "next/server";

import { WORKSPACE_ALERT_WINDOW_MS } from "@/lib/agentAlerts/presentation";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { listUserWorkspaces } from "@/lib/tenantAuth/workspaceService";

/**
 * The workspaces the signed-in person belongs to, for the account menu's "Switch workspace" row.
 * Names and roles only — never another workspace's data. The user id is the verified session's.
 *
 * `alerts` (the phone's Switch workspace, board J5: "Owner · 2 alerts"): how many of this person's OWN
 * alerts wait unread in each other workspace, over the bell's own backstop window. Their own rows only,
 * counted, never read out; a count that cannot be read is simply left out.
 */
async function unreadByWorkspace(userId: string, tenantIds: string[]): Promise<Map<string, number> | null> {
  if (!tenantIds.length) return new Map();
  const since = new Date(Date.now() - WORKSPACE_ALERT_WINDOW_MS).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const { data, error } = await db.from("agent_notifications").select("tenant_id").eq("recipient_user_id", userId).in("tenant_id", tenantIds).is("read_at", null).gte("created_at", since).limit(1000);
  if (error) return null;
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { tenant_id: string }[]) counts.set(row.tenant_id, (counts.get(row.tenant_id) ?? 0) + 1);
  return counts;
}

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try {
    const workspaces = await listUserWorkspaces(auth.context.userId, auth.context.tenantId);
    const others = workspaces.filter((w) => !w.current).map((w) => w.tenantId);
    const alerts = await unreadByWorkspace(auth.context.userId, others).catch(() => null);
    return NextResponse.json(
      { workspaces: workspaces.map(({ tenantId, name, roleLabel, current }) => ({ tenantId, name, roleLabel, current, ...(alerts && !current ? { alerts: alerts.get(tenantId) ?? 0 } : {}) })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Your workspaces could not be listed right now." }, { status: 503 });
  }
}
