import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const action = params.get("action");
  const from = params.get("from");
  const to = params.get("to");
  const requestedActorId = params.get("actorId");
  const page = Math.max(1, Number(params.get("page")) || 1);

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("audit_log")
    .select("id, ts, actor_type, actor_id, action, target_type, target_id, reason, ip, user_agent, metadata", {
      count: "exact",
    })
    .order("ts", { ascending: false });

  // Doc §2.5: only super_admin sees every actor's actions. Anyone else is locked to their own,
  // no matter what actorId they pass — this is a server-side floor, not a UI default.
  if (auth.session.role === "super_admin") {
    if (requestedActorId) query = query.eq("actor_id", requestedActorId);
  } else {
    query = query.eq("actor_id", auth.session.sub);
  }

  if (action && (AUDIT_ACTIONS as readonly string[]).includes(action)) {
    query = query.eq("action", action);
  }
  if (from) query = query.gte("ts", from);
  if (to) query = query.lte("ts", to);

  const { data: rows, error, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) {
    return NextResponse.json({ error: "Could not load audit log" }, { status: 500 });
  }

  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actors } = actorIds.length
    ? await supabase.from("admin_users").select("id, name, email").in("id", actorIds)
    : { data: [] };
  const actorById = new Map((actors ?? []).map((a) => [a.id, a]));

  const entries = (rows ?? []).map((row) => ({
    ...row,
    actor: row.actor_id ? (actorById.get(row.actor_id) ?? null) : null,
  }));

  return NextResponse.json({ entries, total: count ?? 0, page, pageSize: PAGE_SIZE });
}
