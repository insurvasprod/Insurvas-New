import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { copySalesTemplateSchema } from "@/lib/salesSettings/templateSchemas";
import { copySalesTemplate } from "@/lib/salesSettings/templates";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.17 · "Copy to my tenant" (a platform default → a tenant draft) and "Duplicate" (the agency's
 * template → a draft for another product line or carrier). The source is never changed. Owners only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That template could not be found." }, { status: 404 });
  const input = await body(request, copySalesTemplateSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ template: await copySalesTemplate(actorOf(auth, request), id, input) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
