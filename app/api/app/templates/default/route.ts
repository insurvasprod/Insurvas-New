import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { insurvasFormFor } from "@/lib/agentTemplates/service";

const PRODUCT_CODE = /^[a-z][a-z0-9_]{0,79}$/;

/**
 * Reset to default (docs/settings/DEFAULTS.md): the Insurvas form for `?product=`, which the form
 * templates screen loads into its draft. Read only; the owner publishes it like any other edit.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const product = request.nextUrl.searchParams.get("product");
  if (!product || !PRODUCT_CODE.test(product)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  try {
    const source = await insurvasFormFor(auth.context.tenantId, product);
    if (!source) return NextResponse.json({ error: "Insurvas has no form for that product" }, { status: 404 });
    return NextResponse.json(
      { name: source.name, version: source.version, fields: source.fields, form_definition: source.form_definition },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the Insurvas form";
    return NextResponse.json({ error: message }, { status: message.includes("does not include") ? 403 : 500 });
  }
}
