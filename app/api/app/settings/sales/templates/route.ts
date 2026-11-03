import { NextResponse } from "next/server";

import { actorOf, body, failure } from "@/lib/applications/http";
import { createSalesTemplateSchema, SALES_TEMPLATE_KINDS, type SalesTemplateKind } from "@/lib/salesSettings/templateSchemas";
import { createSalesTemplate, listSalesTemplates } from "@/lib/salesSettings/templates";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LA-3.1 / 3.4 / 3.7 · Settings › Sales templates of one kind (`?kind=underwriting`, `quotation` or
 * `application_field_set`): the agency's versions and the published platform defaults. GET: owners
 * and producers. POST: a new draft (owners).
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const kind = new URL(request.url).searchParams.get("kind") as SalesTemplateKind | null;
  if (!kind || !SALES_TEMPLATE_KINDS.includes(kind)) return NextResponse.json({ error: "Say which kind of template to list." }, { status: 400 });
  try {
    const payload = await listSalesTemplates(auth.context.tenantId, kind);
    return NextResponse.json({ ...payload, canEdit: auth.context.role === "owner" }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, createSalesTemplateSchema);
  if (input instanceof NextResponse) return input;
  try {
    const template = await createSalesTemplate(actorOf(auth, request), input);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
