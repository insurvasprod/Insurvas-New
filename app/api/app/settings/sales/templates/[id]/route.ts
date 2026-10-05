import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { saveSalesTemplateSchema } from "@/lib/salesSettings/templateSchemas";
import { saveSalesTemplate } from "@/lib/salesSettings/templates";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.1 / 3.4 / 3.7 · save an edit to the agency's template. A draft changes in place; a published
 * version stays as it was and the edit becomes version N + 1 (`created: true`). Owners only.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That template could not be found." }, { status: 404 });
  const input = await body(request, saveSalesTemplateSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await saveSalesTemplate(actorOf(auth, request), id, input));
  } catch (error) {
    return failure(error);
  }
}
