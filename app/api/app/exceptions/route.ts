import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { loadQueues, QUEUES_PENDING_MESSAGE, QueueError, resolveItem, saveRule } from "@/lib/ingestion/exceptionQueuesStore";
import { exceptionsRequest } from "@/lib/ingestion/exceptionsRequest";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.9 (Notion sprint) · the exception queues (premiums inside: owner, producer, bookkeeper). The writing agents own
 * their items — and sees its own items; the owner and bookkeepers see all. POST resolves an item
 * (with who and what, audited) or, for the owner, sets who owns a queue.
 */
const roles = ["owner", "producer", "bookkeeper"] as const;
const SEES_ALL = new Set(["owner", "bookkeeper"]);
function failure(error: unknown) {
  if (error instanceof QueueError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[exceptions]", error);
  return NextResponse.json({ error: "That could not be saved. Try again." }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const view = await loadQueues({ tenantId: auth.context.tenantId, userId: auth.context.userId, seesAll: SEES_ALL.has(auth.context.role) });
    return NextResponse.json({ ok: true, ...view, message: view.available ? null : QUEUES_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = exceptionsRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const body = parsed.data;
  const scope = { tenantId: auth.context.tenantId, userId: auth.context.userId, seesAll: SEES_ALL.has(auth.context.role) };
  try {
    if (body.action === "save_rule") {
      if (auth.context.role !== "owner") return NextResponse.json({ error: "Only the account owner sets who owns each queue." }, { status: 403 });
      await saveRule(scope, { queueType: body.queue_type, ownerRole: body.owner_role, openAfterDays: body.open_after_days, escalateAfterDays: body.escalate_after_days, escalateToRole: body.escalate_to_role });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "queue_rule.saved", targetType: "queue_assignment_rule", targetId: auth.context.tenantId, metadata: { tenantId: scope.tenantId, queueType: body.queue_type, ownerRole: body.owner_role, openAfterDays: body.open_after_days, escalateAfterDays: body.escalate_after_days, escalateToRole: body.escalate_to_role }, request });
      return NextResponse.json({ ok: true });
    }
    const input = body.resolution === "link_existing_client" ? { resolution: body.resolution, contactId: body.contact_id }
      : body.resolution === "found_the_sale" ? { resolution: body.resolution, dealId: body.deal_id }
      : body.resolution === "found_the_policy" ? { resolution: body.resolution, carrierId: body.carrier_id, policyNumber: body.policy_number }
      : body.resolution === "never_submitted" ? { resolution: body.resolution, reason: body.reason }
      : body.resolution === "resubmitted_elsewhere" ? { resolution: body.resolution, applicationId: body.application_id }
      : { resolution: body.resolution };
    const done = await resolveItem(scope, body.item_id, input);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: done.resolution === "not_mine" ? "queue_item.handed_on" : "queue_item.resolved", targetType: "queue_item", targetId: body.item_id, metadata: { tenantId: scope.tenantId, queueType: done.queueType, resolution: done.resolution, ref: done.ref }, request });
    return NextResponse.json({ ok: true, id: body.item_id });
  } catch (error) {
    return failure(error);
  }
}
