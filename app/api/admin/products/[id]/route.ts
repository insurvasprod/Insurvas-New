import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_PRODUCTS } from "@/lib/products/permissions";
import { updateProductSchema } from "@/lib/products/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const COLUMNS = "id, code, name, category, description, is_active, sort_order, created_at, updated_at";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PRODUCTS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = updateProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: before } = await supabase.from("products").select(COLUMNS).eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const patch = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
    ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active } : {}),
    ...(parsed.data.sort_order !== undefined ? { sort_order: parsed.data.sort_order } : {}),
  };
  const { data: updated, error } = await supabase.from("products").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) return NextResponse.json({ error: "Could not update the product" }, { status: 500 });

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    if (patch[key] !== before[key]) changes[key] = { from: before[key], to: patch[key] };
  }
  if (Object.keys(changes).length > 0) {
    await audit({
      actorId: auth.session.sub,
      action: "product.updated",
      targetType: "product",
      targetId: id,
      metadata: { code: before.code, changes },
      request,
    });
  }
  return NextResponse.json({ product: updated });
}

/** DELETE intentionally means archive. Product references must continue to resolve. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PRODUCTS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const supabase = getSupabaseServiceClient();
  const { data: before } = await supabase.from("products").select(COLUMNS).eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!before.is_active) return NextResponse.json({ product: before, archived: true });

  const { data: updated, error } = await supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: "Could not archive the product" }, { status: 500 });

  await audit({
    actorId: auth.session.sub,
    action: "product.archived",
    targetType: "product",
    targetId: id,
    metadata: { code: before.code, name: before.name },
    request,
  });
  return NextResponse.json({ product: updated, archived: true });
}
