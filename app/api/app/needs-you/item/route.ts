import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { audit } from "@/lib/audit/log";
import { hasFeature } from "@/lib/entitlements/types";
import { QueueError } from "@/lib/ingestion/exceptionQueuesStore";
import { isItemId, isNeedsYouKind, KIND_META, viewItems } from "@/lib/needsYou/kinds";
import { answerUnknownPolicy, UNKNOWN_POLICY_ANSWERS } from "@/lib/needsYou/raise";
import { loadItemPage, loadNeedsYou } from "@/lib/needsYou/store";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
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

  const { tenantId, userId, role } = auth.context;
  const keeper = role === "owner" || role === "bookkeeper";
  // The feature check already read the plan: no second trip for it.
  const entitlement = auth.entitlement;
  const scope = { tenantId, userId, keeper, money: Boolean(keeper && entitlement && hasFeature(entitlement, "discrepancy_report")), credit: Boolean(keeper && entitlement && hasFeature(entitlement, "producer_payouts")) };

  // The phone's Needs you (mobile board F6): no item asked for = the list, as the web's default view (Agency for the
  // owner and bookkeepers, Mine for a producer), cut in two — the decisions a phone settles in one tap (Pick the
  // client) and the rest, which open on the computer. The same read as the web page; each item still decides
  // through its own kind's API.
  if (!kind && !id) {
    const list = await loadNeedsYou(scope);
    const items = viewItems(list.open, keeper ? "agency" : "mine", { userId, keeper });
    const phone = items.filter((item) => item.kind === "pick-client");
    const computer = items.filter((item) => item.kind !== "pick-client");
    const shape = (item: (typeof items)[number]) => ({ kind: item.kind, id: item.id, label: KIND_META[item.kind].label, todo: KIND_META[item.kind].todo, about: item.about, why: item.why, since: item.since, ageDays: item.ageDays, tone: item.tone, webPath: item.href });
    return NextResponse.json(
      { ok: true, total: items.length, phone: { total: phone.length, items: phone.slice(0, 50).map(shape) }, computer: { total: computer.length, items: computer.slice(0, 30).map(shape) }, notes: list.notes, readOnly: entitlement?.access === "read_only" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isNeedsYouKind(kind) || !isItemId(kind, id)) return NextResponse.json({ error: "Choose an item." }, { status: 400 });
  if ((kind === "money" && !scope.money) || (kind === "credit" && !scope.credit)) return NextResponse.json({ error: "This kind of item isn't on your plan." }, { status: 403 });

  const page = await loadItemPage(scope, kind, id);
  if (!page) return NextResponse.json({ error: "Someone decided it, a newer file answered it, or it isn't yours to see.", closed: true }, { status: 404 });
  // Mobile board F6 (2026-11-27, additive): who each "Which client is this?" candidate is in the agency — the lead's
  // stage and its agent, or the policy the person already holds. Read only after loadItemPage found the item for
  // this person (a keeper), so it widens nothing.
  const candidateFacts = page.detail.kind === "pick-client" ? await pickClientFacts(tenantId, page.detail.reviewId).catch(() => []) : undefined;
  return NextResponse.json({ ok: true, detail: page.detail, row: page.row, readOnly: entitlement?.access === "read_only", ...(candidateFacts ? { candidateFacts } : {}) }, { headers: { "Cache-Control": "no-store" } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const serviceDb = (): Loose => getSupabaseServiceClient();
const rowsOf = (answer: Loose): Loose[] => (answer?.error ? [] : answer?.data ?? []);

/**
 * Per shortlisted candidate (in shortlist order, `index` as the item's candidates): the stage of the lead behind the
 * sale or application, the agent who worked it, and a policy the person already holds (with its agent). Every read
 * carries the tenant filter (service role); nothing about contact detail.
 */
async function pickClientFacts(tenantId: string, reviewId: string): Promise<Array<{ index: number; stage: string | null; agentName: string | null; policyNumber: string | null; policyAgentName: string | null }>> {
  const review = await serviceDb().from("policy_match_review").select("shortlist").eq("tenant_id", tenantId).eq("id", reviewId).maybeSingle();
  const list = (Array.isArray(review.data?.shortlist) ? review.data.shortlist : []) as Loose[];
  if (!list.length) return [];
  const ids = (type: string) => list.filter((c) => c?.type === type && typeof c.id === "string").map((c) => c.id as string);
  const contactIds = [...new Set(list.map((c) => c?.contactId).filter((v): v is string => typeof v === "string"))];
  const [deals, apps, policies] = await Promise.all([
    ids("deal_flow").length ? serviceDb().from("deal_flow").select("id, lead_id, worked_by").eq("tenant_id", tenantId).in("id", ids("deal_flow")).then(rowsOf) : [],
    ids("application").length ? serviceDb().from("tenant_applications").select("id, lead_id, case_id").eq("tenant_id", tenantId).in("id", ids("application")).then(rowsOf) : [],
    contactIds.length ? serviceDb().from("policy_current").select("contact_id, policy_number, agent_user_id").eq("tenant_id", tenantId).in("contact_id", contactIds).then(rowsOf) : [],
  ]);
  const caseIds = (apps as Loose[]).map((a) => a.case_id).filter(Boolean);
  const cases = caseIds.length ? rowsOf(await serviceDb().from("tenant_application_cases").select("id, opened_by").eq("tenant_id", tenantId).in("id", caseIds)) : [];
  const openedBy = new Map<string, string>(cases.map((c: Loose) => [c.id, c.opened_by]));
  const leadIds = [...new Set([...(deals as Loose[]), ...(apps as Loose[])].map((r) => r.lead_id).filter(Boolean))] as string[];
  const leads = leadIds.length ? rowsOf(await serviceDb().from("agent_leads").select("id, stage_id").eq("tenant_id", tenantId).in("id", leadIds)) : [];
  const stageIds = [...new Set(leads.map((l: Loose) => l.stage_id).filter(Boolean))] as string[];
  const stages = stageIds.length ? rowsOf(await serviceDb().from("tenant_pipeline_stages").select("id, name, tenant_pipelines!inner(tenant_id)").in("id", stageIds).eq("tenant_pipelines.tenant_id", tenantId)) : [];
  const userIds = [...new Set([...(deals as Loose[]).map((d) => d.worked_by), ...cases.map((c: Loose) => c.opened_by), ...(policies as Loose[]).map((p) => p.agent_user_id)].filter(Boolean))] as string[];
  const users = userIds.length ? rowsOf(await serviceDb().from("tenant_users").select("user_id, users!inner(name, email)").eq("tenant_id", tenantId).in("user_id", userIds)) : [];
  const nameOf = new Map<string, string>(users.map((u: Loose) => [u.user_id, u.users?.name || u.users?.email]));
  const stageOfLead = new Map<string, string>(leads.map((l: Loose) => [l.id, stages.find((s: Loose) => s.id === l.stage_id)?.name ?? null]).filter((e: Loose[]) => e[1]) as Array<[string, string]>);
  const dealOf = new Map<string, Loose>((deals as Loose[]).map((d) => [d.id, d]));
  const appOf = new Map<string, Loose>((apps as Loose[]).map((a) => [a.id, a]));
  return list.map((c, index) => {
    const sale = c?.type === "deal_flow" ? dealOf.get(c.id) : appOf.get(c?.id);
    const agent = c?.type === "deal_flow" ? sale?.worked_by : sale?.case_id ? openedBy.get(sale.case_id) : null;
    const held = typeof c?.contactId === "string" ? (policies as Loose[]).find((p) => p.contact_id === c.contactId) : undefined;
    return {
      index,
      stage: sale?.lead_id ? stageOfLead.get(sale.lead_id) ?? null : null,
      agentName: agent ? nameOf.get(agent) ?? null : null,
      policyNumber: held?.policy_number ?? null,
      policyAgentName: held?.agent_user_id ? nameOf.get(held.agent_user_id) ?? null : null,
    };
  });
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
