import { NextResponse } from "next/server";
import { z } from "zod";

import { body, failure, isUuid } from "@/lib/applications/http";
import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { adminScopeFor } from "@/lib/extension/http";
import { retireMap } from "@/lib/extension/maps";

const schema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict();

/**
 * Admin round 1 (catalog screen 12) · take a published platform map out of use. It goes to `retired`: fills stop using it (a carrier-wide
 * map, if any, takes over). "Start version N + 1" can copy it later. Carrier-library access, audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That field map could not be found." }, { status: 404 });
  const input = await body(request, schema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ map: await retireMap(scope, id, input.reason || null) });
  } catch (error) {
    return failure(error);
  }
}
