import { NextResponse } from "next/server";
import { z } from "zod";

import { body, failure, isUuid } from "@/lib/applications/http";
import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { adminScopeFor } from "@/lib/extension/http";
import { rejectMap } from "@/lib/extension/maps";

const schema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict();

/**
 * Admin round 1 (catalog screen 12) · turn down a platform draft. It goes to `retired` with no approval, so it never
 * fills and stays on record as rejected; "Start version N + 1" can copy it later. Carrier-library access, audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That field map could not be found." }, { status: 404 });
  const input = await body(request, schema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ map: await rejectMap(scope, id, input.reason || null) });
  } catch (error) {
    return failure(error);
  }
}
