import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { publishSalesTemplateSchema } from "@/lib/salesSettings/templateSchemas";
import { publishSalesTemplate } from "@/lib/salesSettings/templates";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.1 / 3.4 / 3.7 · publish a draft version. Older versions are retired only when asked. Owners only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That template could not be found." }, { status: 404 });
  const input = await body(request, publishSalesTemplateSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ template: await publishSalesTemplate(actorOf(auth, request), id) });
  } catch (error) {
    return failure(error);
  }
}
