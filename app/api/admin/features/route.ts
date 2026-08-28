import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_FEATURES } from "@/lib/features/permissions";
import { fetchFeatureCatalog } from "@/lib/features/queries";
import { createFeatureSchema } from "@/lib/features/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_FEATURES);
  if (auth instanceof NextResponse) return auth;

  // The plan picker (SA-2.2 onward) passes ?picker=1 to exclude archived features.
  const includeArchived = request.nextUrl.searchParams.get("picker") !== "1";

  try {
    const groups = await fetchFeatureCatalog({ includeArchived });
    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ error: "Could not load the feature catalog" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_FEATURES);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createFeatureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { feature_key, label, module, description } = parsed.data;
  const supabase = getSupabaseServiceClient();

  // Place it last within its module so existing ordering is untouched.
  const { data: last } = await supabase
    .from("features")
    .select("sort_order")
    .eq("module", module)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { data: created, error } = await supabase
    .from("features")
    .insert({
      feature_key,
      label,
      module,
      description: description || null,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select("id, feature_key, label, module, description, sort_order, is_archived")
    .single();

  if (error) {
    // 23505 = duplicate feature_key, 23503 = module doesn't exist.
    const message =
      error.code === "23505"
        ? "That feature key already exists"
        : error.code === "23503"
          ? "That module doesn't exist"
          : "Could not create the feature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "feature.created",
    targetType: "feature",
    targetId: created.id,
    metadata: { feature_key, label, module },
    request,
  });

  return NextResponse.json({ feature: created }, { status: 201 });
}
