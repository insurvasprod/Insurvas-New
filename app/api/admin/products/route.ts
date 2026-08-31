import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_PRODUCTS } from "@/lib/products/permissions";
import { fetchProducts } from "@/lib/products/queries";
import { createProductSchema } from "@/lib/products/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_PRODUCTS);
  if (auth instanceof NextResponse) return auth;

  const includeArchived = request.nextUrl.searchParams.get("picker") !== "1";
  try {
    const products = await fetchProducts({ includeArchived });
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json({ error: "Could not load products" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_PRODUCTS);
  if (auth instanceof NextResponse) return auth;

  const parsed = createProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { code, name, category, description, sort_order } = parsed.data;
  const { data: created, error } = await getSupabaseServiceClient()
    .from("products")
    .insert({ code, name, category, description: description || null, sort_order })
    .select("id, code, name, category, description, is_active, sort_order, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A product with that code already exists" : "Could not create the product" },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  await audit({
    actorId: auth.session.sub,
    action: "product.created",
    targetType: "product",
    targetId: created.id,
    metadata: { code, name, category },
    request,
  });

  return NextResponse.json({ product: created }, { status: 201 });
}
