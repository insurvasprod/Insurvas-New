import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { audit } from "@/lib/audit/log";
import { getEntitlement } from "@/lib/entitlements/get";
import { hasFeature } from "@/lib/entitlements/types";
import { QueueError } from "@/lib/ingestion/exceptionQueuesStore";
import { isItemId, isNeedsYouKind } from "@/lib/needsYou/kinds";
import { answerUnknownPolicy, UNKNOWN_POLICY_ANSWERS } from "@/lib/needsYou/raise";
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

const answerRequest = z.object({
  action: z.literal("answer_unknown_policy"),
  id: z.string().min(1).max(600),
  answer: z.enum(UNKNOWN_POLICY_ANSWERS),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict();

/**
 * QA 2026-11-03 · "Paid on a policy we don't have" has no row of its own: an answer raises its orphan_commission
 * queue item and resolves it with the queue's own answer (lib/needsYou/raise.ts). The owner and bookkeepers only,
 * as the item is theirs; audited as the Exceptions route audits a resolution.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", ["owner", "bookkeeper"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Needs you");
  if (refused) return refused;
  const parsed = answerRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const body = parsed.data;
  if (!isItemId("unknown-policy", body.id)) return NextResponse.json({ error: "Choose an item." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const done = await answerUnknownPolicy({ tenantId, userId }, body.id, body.answer, body.note ?? null);
    await audit({ actorType: "tenant", actorId: userId, action: done.resolution === "not_mine" ? "queue_item.handed_on" : "queue_item.resolved", targetType: "queue_item", targetId: done.itemId, metadata: { tenantId, queueType: done.queueType, resolution: done.resolution, ref: done.ref, raisedFrom: "needs_you.unknown_policy" }, request });
    return NextResponse.json({ ok: true, id: done.itemId });
  } catch (error) {
    if (error instanceof QueueError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[needs-you] answer_unknown_policy", error);
    return NextResponse.json({ error: "That could not be saved. Try again." }, { status: 500 });
  }
}
