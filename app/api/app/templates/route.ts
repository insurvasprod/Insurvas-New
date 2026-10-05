import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { applyTemplate, listAvailableTemplates, previewTemplateApplication, TemplateProductError } from "@/lib/agentTemplates/service";

const PRODUCT_CODE = /^[a-z][a-z0-9_]{0,79}$/;

/** `?product=<code>` picks which product's form is `current`; without it, the term-life form as before. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const product = request.nextUrl.searchParams.get("product");
  if (product !== null && !PRODUCT_CODE.test(product)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  try {
    // agencyName: the partner form names the agency (the submit page reads tenants.name); the
    // settings preview shows the same name so it matches the partner view (LA-1.4-5).
    const [templates, tenant] = await Promise.all([
      listAvailableTemplates(auth.context.tenantId, auth.context.userId, product),
      getSupabaseServiceClient().from("tenants").select("name").eq("id", auth.context.tenantId).maybeSingle<{ name: string }>(),
    ]);
    return NextResponse.json({ ...templates, agencyName: tenant.data?.name ?? null }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) {
    if (error instanceof TemplateProductError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { template_id?: string; template_version?: number; preview?: boolean } | null;
  const version = typeof body?.template_version === "number" ? body.template_version : 0;
  if (!body?.template_id || !Number.isInteger(version) || version < 1) return NextResponse.json({ error: "Choose a valid template" }, { status: 400 });
  try {
    if (body.preview) return NextResponse.json({ preview: await previewTemplateApplication(auth.context.tenantId, body.template_id, version) });
    return NextResponse.json({ applied: await applyTemplate(auth.context.tenantId, auth.context.userId, body.template_id, version) });
  } catch (error) { const message = error instanceof Error ? error.message : "Could not apply template"; return NextResponse.json({ error: message }, { status: message.includes("does not include") ? 403 : 400 }); }
}
