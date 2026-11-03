import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { portalAccountSchema } from "@/lib/salesSettings/portalSchemas";
import { removePortalAccount, savePortalAccount } from "@/lib/salesSettings/portals";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.22 · save the agency's portal account for one carrier (one per carrier). The schema is strict
 * and has no password key, so a body carrying one is refused. The accounts are listed by GET
 * /api/app/settings/sales/carriers. Owners only.
 */
export async function PUT(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, portalAccountSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ portal: await savePortalAccount(actorOf(auth, request), input) });
  } catch (error) {
    return failure(error);
  }
}

/** `DELETE ?id=<account id>` — remove the agency's portal account for a carrier. Owners only; audited. */
export async function DELETE(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUuid(id)) return NextResponse.json({ error: "That portal account could not be found." }, { status: 404 });
  try {
    return NextResponse.json(await removePortalAccount(actorOf(auth, request), id));
  } catch (error) {
    return failure(error);
  }
}
