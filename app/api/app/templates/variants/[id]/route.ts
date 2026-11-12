import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";
import type { TemplateFormDefinition } from "@/lib/templates/constants";
import { formForSave, formLogicProblem } from "@/lib/templates/logic";
import { FormSchemaPendingError, publishVariant, readVariant, setVariantStatus } from "@/lib/templates/formsServer";

/**
 * One of a product's extra forms (needs 20261112200000): another arrangement of the product's own
 * questions. Publishing stores its next version; the partner portal serves only the product's main
 * form until intake learns to pick a form (see lib/templates/formsServer.ts).
 */
const fail = (error: unknown, fallback: string) => {
  if (error instanceof FormSchemaPendingError) return NextResponse.json({ code: "schema_pending", error: error.message }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try { const { id } = await params; return NextResponse.json({ variant: await readVariant(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error, "Could not read the form"); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: string; form_definition?: TemplateFormDefinition; note?: string } | null;
  if (!body?.form_definition || !Array.isArray(body.form_definition.sections)) return NextResponse.json({ error: "The form has no pages" }, { status: 400 });
  const form = formForSave(body.form_definition);
  const problem = formLogicProblem(form);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  try {
    const { id } = await params;
    const result = await publishVariant(auth.context.tenantId, auth.context.userId, id, { name: body.name ?? "", form_definition: form, note: body.note });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_definition_saved", targetType: "tenant_form_variant", targetId: id, metadata: { change: "form_published", version: result.version }, request });
    return NextResponse.json(result);
  } catch (error) { return fail(error, "Could not publish the form"); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { status?: string } | null;
  if (body?.status !== "live" && body?.status !== "off") return NextResponse.json({ error: "Choose live or off" }, { status: 400 });
  try { const { id } = await params; await setVariantStatus(auth.context.tenantId, id, body.status); return NextResponse.json({ ok: true }); }
  catch (error) { return fail(error, "Could not change the form"); }
}
