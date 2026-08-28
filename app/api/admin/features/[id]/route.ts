import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_FEATURES } from "@/lib/features/permissions";
import { updateFeatureSchema } from "@/lib/features/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_FEATURES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateFeatureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: before } = await supabase
    .from("features")
    .select("id, feature_key, label, description, is_archived")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      feature_key: string;
      label: string;
      description: string | null;
      is_archived: boolean;
    }>();

  if (!before) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  const patch = {
    ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
    ...(parsed.data.is_archived !== undefined ? { is_archived: parsed.data.is_archived } : {}),
  };

  const { data: updated, error } = await supabase
    .from("features")
    .update(patch)
    .eq("id", id)
    .select("id, feature_key, label, module, description, sort_order, is_archived")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not update the feature" }, { status: 500 });
  }

  // Record a diff of what actually moved, not the whole row.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (patch.label !== undefined && patch.label !== before.label) {
    changes.label = { from: before.label, to: patch.label };
  }
  if (patch.description !== undefined && patch.description !== before.description) {
    changes.description = { from: before.description, to: patch.description };
  }
  if (patch.is_archived !== undefined && patch.is_archived !== before.is_archived) {
    changes.is_archived = { from: before.is_archived, to: patch.is_archived };
  }

  if (Object.keys(changes).length > 0) {
    await audit({
      actorId: auth.session.sub,
      action: "feature.updated",
      targetType: "feature",
      targetId: id,
      metadata: { feature_key: before.feature_key, changes },
      request,
    });
  }

  return NextResponse.json({ feature: updated });
}
