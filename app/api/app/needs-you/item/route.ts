import { NextResponse, type NextRequest } from "next/server";

import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { getEntitlement } from "@/lib/entitlements/get";
import { hasFeature } from "@/lib/entitlements/types";
import { isItemId, isNeedsYouKind } from "@/lib/needsYou/kinds";
import { loadItemPage } from "@/lib/needsYou/store";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Book of business, round 4 (owner 2026-11-02: "fix it right away in that page"): one Needs you item's Decide
 * part — the evidence and the choices its own API accepts — read for a row that opens under itself on a file's
 * page or the Needs you list. The same read and the same people as the item page (/app/needs-you/[kind]/[id]):
 * producers, bookkeepers and the owner; a narrow agency session is refused (AG-0.5). Money and credit items
 * need their own features, as on the list. Deciding still goes to each kind's own API. Reads only.
 */
const ROLES = ["owner", "bookkeeper", "producer"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Needs you");
  if (refused) return refused;

  const kind = request.nextUrl.searchParams.get("kind") ?? "";
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!isNeedsYouKind(kind) || !isItemId(kind, id)) return NextResponse.json({ error: "Choose an item." }, { status: 400 });

  const { tenantId, userId, role } = auth.context;
  const keeper = role === "owner" || role === "bookkeeper";
  const entitlement = await getEntitlement(tenantId).catch(() => null);
  const scope = { tenantId, userId, keeper, money: Boolean(keeper && entitlement && hasFeature(entitlement, "discrepancy_report")), credit: Boolean(keeper && entitlement && hasFeature(entitlement, "producer_payouts")) };
  if ((kind === "money" && !scope.money) || (kind === "credit" && !scope.credit)) return NextResponse.json({ error: "This kind of item isn't on your plan." }, { status: 403 });

  const page = await loadItemPage(scope, kind, id);
  if (!page) return NextResponse.json({ error: "Someone decided it, a newer file answered it, or it isn't yours to see.", closed: true }, { status: 404 });
  return NextResponse.json({ ok: true, detail: page.detail, row: page.row, readOnly: entitlement?.access === "read_only" }, { headers: { "Cache-Control": "no-store" } });
}
