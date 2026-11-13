import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getAgentTemplateForProduct } from "@/lib/agentTemplates/service";
import { formCapabilities, formResults } from "@/lib/templates/formsServer";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const WINDOWS = new Set([7, 30, 90]);

/** The Results tab (board A10): starts, sends, where people stop, by source; for the live version. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const days = Number(request.nextUrl.searchParams.get("days") ?? 30);
  if (!WINDOWS.has(days)) return NextResponse.json({ error: "Choose 7, 30 or 90 days" }, { status: 400 });
  try {
    const { id } = await params;
    const { data: copy } = await getSupabaseServiceClient().from("tenant_templates").select("product_code").eq("tenant_id", auth.context.tenantId).eq("id", id).maybeSingle<{ product_code: string }>();
    if (!copy) return NextResponse.json({ error: "That form is not yours, or no longer exists." }, { status: 404 });
    const template = await getAgentTemplateForProduct(auth.context.tenantId, auth.context.userId, copy.product_code);
    const results = await formResults(auth.context.tenantId, id, days, template.template.fields, template.template.form_definition, await formCapabilities());
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the results" }, { status: 400 });
  }
}
