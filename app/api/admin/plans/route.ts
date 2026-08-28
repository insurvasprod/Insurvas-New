import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { fetchPlans } from "@/lib/plans/queries";
import { createPlanSchema } from "@/lib/plans/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;

  // ?picker=1 excludes archived plans — what SA-2.7's assign-plan flow will use.
  const includeArchived = request.nextUrl.searchParams.get("picker") !== "1";

  try {
    const plans = await fetchPlans({ includeArchived });
    return NextResponse.json({ plans });
  } catch {
    return NextResponse.json({ error: "Could not load plans" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { code, name, plan_type, description, is_public, sort_order } = parsed.data;
  const supabase = getSupabaseServiceClient();

  // A new plan always starts at version 1; later versions come from admin_create_plan_version.
  const { data: created, error } = await supabase
    .from("plans")
    .insert({ code, version: 1, name, plan_type, description: description || null, is_public, sort_order })
    .select("id, code, version, name, plan_type")
    .single();

  if (error) {
    const message = error.code === "23505" ? "A plan with that code already exists" : "Could not create the plan";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "plan.created",
    targetType: "plan",
    targetId: created.id,
    metadata: { code, name, plan_type },
    request,
  });

  return NextResponse.json({ plan: created }, { status: 201 });
}
