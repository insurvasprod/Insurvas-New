import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

/**
 * Publishes a new version of a plan by cloning the current one.
 *
 * Existing subscribers are untouched: their subscription points at the old row, which keeps its
 * own features and prices (SA-2.3/2.4 attach those per version). Moving them across is
 * deliberately a separate, explicit act — the plan migration tool, which SA-2.2 puts out of scope.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: newId, error } = await supabase.rpc("admin_create_plan_version", { p_plan_id: id });

  if (error) {
    if (error.message?.includes("plan_not_found")) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not create a new version" }, { status: 500 });
  }

  const { data: created } = await supabase
    .from("plans")
    .select("id, code, version, name")
    .eq("id", newId as unknown as string)
    .maybeSingle<{ id: string; code: string; version: number; name: string }>();

  await audit({
    actorId: auth.session.sub,
    action: "plan.version_created",
    targetType: "plan",
    targetId: (newId as unknown as string) ?? id,
    metadata: { code: created?.code, version: created?.version, clonedFrom: id },
    request,
  });

  return NextResponse.json({ plan: created }, { status: 201 });
}
