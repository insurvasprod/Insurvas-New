import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";
import { listAvailableTemplates, NoSoldProductError } from "@/lib/agentTemplates/service";
import { createVariant, formCapabilities, FormSchemaPendingError, listForms } from "@/lib/templates/formsServer";
import type { TemplateFormDefinition } from "@/lib/templates/constants";

/**
 * Settings › Application forms, the Forms tab (board A1): every form the agency has, one per product
 * today and several once 20261112200000 is applied, with what each has done in the last 30 days, and
 * which parts of the builder can save (`capabilities`).
 */
export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const caps = await formCapabilities();
    // The product list also makes sure each sold product has its copy (LA-1.4), as the builder does.
    const available = await listAvailableTemplates(auth.context.tenantId, auth.context.userId, null).catch((error) => {
      if (error instanceof NoSoldProductError) return null;
      throw error;
    });
    const forms = await listForms(auth.context.tenantId, caps);
    const products = available?.products ?? [];
    const names = new Map(products.map((product) => [product.code, product.name]));
    return NextResponse.json(
      { forms: forms.map((form) => ({ ...form, product_name: names.get(form.product_code) ?? form.product_code })), products, capabilities: caps, noProducts: !available },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read your forms" }, { status: 500 });
  }
}

/** New form (board A1 sheet): another form for a product, from the Insurvas form, a copy, or blank. */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { tenant_template_id?: string; name?: string; audience?: string[]; form_definition?: TemplateFormDefinition } | null;
  if (!body?.tenant_template_id || !body.form_definition) return NextResponse.json({ error: "Choose a product and where to start from" }, { status: 400 });
  try {
    const variant = await createVariant(auth.context.tenantId, auth.context.userId, { tenant_template_id: body.tenant_template_id, name: body.name ?? "", audience: body.audience ?? [], form_definition: body.form_definition });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_definition_saved", targetType: "tenant_form_variant", targetId: variant.id, metadata: { change: "form_created", tenant_template_id: body.tenant_template_id }, request });
    return NextResponse.json({ variant });
  } catch (error) {
    const pending = error instanceof FormSchemaPendingError;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not make the form", code: pending ? "schema_pending" : undefined }, { status: pending ? 503 : 400 });
  }
}
