import "server-only";
import { NextResponse } from "next/server";

import { scopeFor } from "./visibility";

/**
 * AG-0.5 · the route-level half of the AG-0.4 helper.
 *
 * Some screens are the AGENCY's business, not a producer's work: vendor returns, true CPA, partner quality,
 * compliance cases, suppression, scoring rules, imports and merges. Inside an agency a session with a narrowed
 * scope (producer, manager, assistant, setter) is refused there outright — filtering an agency-wide figure down
 * to one producer would still be a different screen, and the spec counts any of B's rows, in a count or a total,
 * as a leak. Outside an agency (individual plan) and for the all-seeing roles the scope is null and nothing
 * changes: a solo agent's screens work exactly as before.
 *
 * Usage, right after the role gate:
 *   const refused = await refuseNarrowInAgency(auth.context, "Vendor returns");
 *   if (refused) return refused;
 */
export async function refuseNarrowInAgency(context: { tenantId: string; userId: string }, what: string): Promise<NextResponse | null> {
  const scope = await scopeFor(context);
  if (scope === null) return null;
  return NextResponse.json({ error: `${what} is handled by the agency's owner and admins.`, code: "agency_scope" }, { status: 403 });
}
