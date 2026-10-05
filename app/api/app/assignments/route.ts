import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assignLead, assignLeadList, getAssignmentPreview, getAssignmentWorkspace, ListChangedError, previewLeadListAssignment, publishAssignmentRules, returnLeadToPool, saveAgentCapacity, saveAssignmentRule, saveAssignmentSettings, SchemaPendingError } from "@/lib/assignment/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";

const allRoles = ["owner", "producer", "assistant", "setter"] as const;
const managers = ["owner", "producer"] as const;
const matchType = z.enum(["campaign", "state", "language", "product", "fallback", "realtime"]);
const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  priority: z.number().int().min(0).max(100000),
  matchType,
  matchValues: z.record(z.string(), z.unknown()).default({}),
  assigneeIds: z.array(z.string().uuid()).max(500).default([]),
  isActive: z.boolean().default(true),
}).strict();

const list = (max: number) => z.array(z.string().trim().min(1).max(80)).min(1).max(max);
// One published rule, with its values checked against its type: a rule the router cannot read
// would sit in the chain matching nothing.
const publishedRule = z.discriminatedUnion("matchType", [
  z.object({ matchType: z.literal("realtime"), matchValues: z.object({ seconds: z.number().int().min(1).max(86400) }).strict() }),
  z.object({ matchType: z.literal("language"), matchValues: z.object({ languages: list(20) }).strict() }),
  z.object({ matchType: z.literal("campaign"), matchValues: z.object({ campaign_ids: z.array(z.string().uuid()).min(1).max(100) }).strict() }),
  z.object({ matchType: z.literal("product"), matchValues: z.object({ products: list(40), licensed_only: z.boolean().optional() }).strict() }),
  z.object({ matchType: z.literal("state"), matchValues: z.object({ states: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/)).min(1).max(60) }).strict() }),
  z.object({ matchType: z.literal("fallback"), matchValues: z.object({}).strict() }),
]).and(z.object({
  id: z.string().uuid().optional(),
  assigneeIds: z.array(z.string().uuid()).max(500).default([]),
  isActive: z.boolean().default(true),
  // 20260925702100: how the rule picks, and up to two more conditions ANDed with its own.
  strategy: z.enum(["round_robin", "least_loaded"]).default("round_robin"),
  conditions: z.array(z.discriminatedUnion("match_type", [
    z.object({ match_type: z.literal("language"), match_values: z.object({ languages: list(20) }).strict() }),
    z.object({ match_type: z.literal("campaign"), match_values: z.object({ campaign_ids: z.array(z.string().uuid()).min(1).max(100) }).strict() }),
    z.object({ match_type: z.literal("product"), match_values: z.object({ products: list(40), licensed_only: z.boolean().optional() }).strict() }),
    z.object({ match_type: z.literal("state"), match_values: z.object({ states: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/)).min(1).max(60) }).strict() }),
  ])).max(2).default([]),
})).refine((rule) => rule.matchType !== "fallback" || rule.conditions.length === 0, "The fallback rule matches everything, so it takes no conditions.");
const publishSchema = z.object({ rules: z.array(publishedRule).max(100) }).strict();

function pending() {
  return NextResponse.json({ error: new SchemaPendingError().message, code: "schema_pending" }, { status: 503 });
}

// Bulk list assignment (20260924342000). The chain needs nobody named; the two overrides need the
// people and a reason, which the router records and reads as a manager's rest-day override.
const listMode = z.enum(["chain", "owner", "round_robin"]);
const listUsers = z.array(z.string().uuid()).max(50);
function checkListMembers(mode: z.infer<typeof listMode>, userIds: string[]) {
  if (mode === "owner" && userIds.length !== 1) return "Choose the one person who gets these leads.";
  if (mode === "round_robin" && userIds.length < 1) return "Choose at least one member to rotate between.";
  return null;
}
const listPreviewQuery = z.object({
  campaign_id: z.string().uuid(),
  mode: listMode,
  user_ids: z.string().max(2000).optional().transform((value) => (value ? value.split(",").map((id) => id.trim()).filter(Boolean) : [])).pipe(listUsers),
});
const assignListBody = z.object({
  action: z.literal("assign_list"),
  campaignId: z.string().uuid(),
  mode: listMode,
  userIds: listUsers.default([]),
  reason: z.string().trim().max(500).nullable().optional(),
  expected: z.number().int().min(0).max(100000),
}).strict();

async function assignList(body: unknown) {
  const auth = await requireFeatureRole("outbound_dialing", managers, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = assignListBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid list assignment" }, { status: 400 });
  const { campaignId, mode, expected } = parsed.data;
  const userIds = mode === "chain" ? [] : parsed.data.userIds;
  const reason = parsed.data.reason || null;
  const members = checkListMembers(mode, userIds);
  if (members) return NextResponse.json({ error: members }, { status: 400 });
  if (mode !== "chain" && !reason) return NextResponse.json({ error: "Give a reason for overriding the rule chain." }, { status: 400 });
  try {
    return NextResponse.json(await assignLeadList(auth.context.tenantId, auth.context.userId, { campaignId, mode, userIds, reason, expected }));
  } catch (error) {
    if (error instanceof SchemaPendingError) return pending();
    if (error instanceof ListChangedError) return NextResponse.json({ error: error.message, code: "list_changed" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not assign the list" }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get("view");
  if (view === "list_preview") {
    // The whole list through the real router, rolled back; managers only, like the commit.
    const auth = await requireFeatureRole("outbound_dialing", managers);
    if (auth instanceof NextResponse) return auth;
    const params = request.nextUrl.searchParams;
    const parsed = listPreviewQuery.safeParse({ campaign_id: params.get("campaign_id") ?? undefined, mode: params.get("mode") ?? undefined, user_ids: params.get("user_ids") ?? undefined });
    if (!parsed.success) return NextResponse.json({ error: "Choose a list and how to assign it" }, { status: 400 });
    const userIds = parsed.data.mode === "chain" ? [] : parsed.data.user_ids;
    const members = checkListMembers(parsed.data.mode, userIds);
    if (members) return NextResponse.json({ error: members }, { status: 400 });
    try {
      const preview = await previewLeadListAssignment(auth.context.tenantId, auth.context.userId, { campaignId: parsed.data.campaign_id, mode: parsed.data.mode, userIds });
      return NextResponse.json({ preview }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof SchemaPendingError) return pending();
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview the assignment" }, { status: 400 });
    }
  }
  if (view === "preview") {
    // Runs the real router over the next leads and rolls it all back; managers only, like reassigning.
    const auth = await requireFeatureRole("outbound_dialing", managers);
    if (auth instanceof NextResponse) return auth;
    try {
      const rows = await getAssignmentPreview(auth.context.tenantId, auth.context.userId, 5);
      return NextResponse.json({ rows, pending: rows === null }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview routing" }, { status: 500 });
    }
  }
  const auth = await requireFeatureRole("outbound_dialing", allRoles);
  if (auth instanceof NextResponse) return auth;
  try {
    const workspace = await getAssignmentWorkspace(auth.context.tenantId);
    // LA-2.12-2: a setter reads who can take work (the lead lists need it) but not the routing rules
    // or the per-member routing figures — that is configuration, and a setter "cannot see" it.
    const visible = auth.context.role === "setter" ? { ...workspace, rules: [], insights: null } : workspace;
    return NextResponse.json(visible, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return NextResponse.json({ error: "Could not load assignment workspace" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  // A whole list at once is a manager's act; the per-lead actions below keep their wider roles.
  if (body && typeof body === "object" && (body as { action?: unknown }).action === "assign_list") return assignList(body);
  const auth = await requireFeatureRole("outbound_dialing", allRoles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const action = z.object({ action: z.enum(["assign", "return_to_pool"]), workItemId: z.string().uuid().nullable().optional(), targetUserId: z.string().uuid().nullable().optional(), reason: z.string().trim().max(500).nullable().optional() }).strict().safeParse(body);
  if (!action.success) return NextResponse.json({ error: "Enter a valid assignment action" }, { status: 400 });
  try {
    if (action.data.action === "return_to_pool") {
      if (!action.data.workItemId || !action.data.reason) return NextResponse.json({ error: "A work item and return reason are required" }, { status: 400 });
      return NextResponse.json(await returnLeadToPool(auth.context.tenantId, auth.context.userId, action.data.workItemId, action.data.reason));
    }
    return NextResponse.json(await assignLead(auth.context.tenantId, auth.context.userId, { workItemId: action.data.workItemId, targetUserId: action.data.targetUserId, reason: action.data.reason }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not complete assignment" }, { status: 400 }); }
}

/**
 * Two shapes. `{ rules: [...] }` publishes the whole chain from the board's draft; the single-rule
 * shape is the original per-rule save, kept for any caller that still sends it.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", managers, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  if (body && typeof body === "object" && "rules" in body) {
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid assignment rules" }, { status: 400 });
    try {
      const rules = await publishAssignmentRules(auth.context.tenantId, auth.context.userId, parsed.data.rules.map((rule) => ({
        id: rule.id,
        matchType: rule.matchType,
        matchValues: rule.matchType === "state" ? { states: rule.matchValues.states.map((state) => state.toUpperCase()) } : rule.matchValues,
        assigneeIds: rule.assigneeIds,
        isActive: rule.isActive,
        strategy: rule.strategy,
        conditions: rule.conditions.map((condition) => condition.match_type === "state"
          ? { match_type: "state" as const, match_values: { states: condition.match_values.states.map((state) => state.toUpperCase()) } }
          : condition),
      })));
      return NextResponse.json({ rules });
    } catch (error) {
      if (error instanceof SchemaPendingError) return pending();
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not publish rules" }, { status: 400 });
    }
  }
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid assignment rule" }, { status: 400 });
  try { return NextResponse.json(await saveAssignmentRule(auth.context.tenantId, auth.context.userId, parsed.data), { status: parsed.data.id ? 200 : 201 }); }
  catch (error) {
    if (error instanceof SchemaPendingError) return pending();
    return NextResponse.json({ error: "Could not save assignment rule" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", managers, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = z.object({
    restDays: z.number().int().min(0).max(3650).optional(),
    attemptsBeforeRotate: z.number().int().min(0).max(50).nullable().optional(),
    userId: z.string().uuid().optional(),
    maxOpenLeads: z.number().int().min(0).max(100000).optional(),
    languages: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    weekdayOff: z.number().int().min(0).max(6).nullable().optional(),
    autoRoutePosted: z.boolean().optional(),
  }).strict().safeParse(await request.json().catch(() => null));
  const data = parsed.success ? parsed.data : null;
  const settingsChange = data && (data.restDays !== undefined || data.attemptsBeforeRotate !== undefined || data.autoRoutePosted !== undefined);
  const memberChange = data && data.userId && (data.maxOpenLeads !== undefined || data.languages !== undefined || data.weekdayOff !== undefined);
  if (!data || (!settingsChange && !memberChange)) return NextResponse.json({ error: "Enter valid capacity or rest-day settings" }, { status: 400 });
  try {
    const result = settingsChange
      ? await saveAssignmentSettings(auth.context.tenantId, auth.context.userId, { restDays: data.restDays, attemptsBeforeRotate: data.attemptsBeforeRotate, autoRoutePosted: data.autoRoutePosted })
      : await saveAgentCapacity(auth.context.tenantId, data.userId!, { maxOpenLeads: data.maxOpenLeads, languages: data.languages, weekdayOff: data.weekdayOff });
    // Routing posted leads on arrival changes who gets a customer without anyone pressing a button:
    // who turned it on or off is recorded.
    if (data.autoRoutePosted !== undefined) {
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.assignment_auto_route_changed",
        targetType: "tenant",
        targetId: auth.context.tenantId,
        metadata: { tenantId: auth.context.tenantId, autoRoutePosted: data.autoRoutePosted },
        request,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SchemaPendingError) return pending();
    return NextResponse.json({ error: "Could not save assignment settings" }, { status: 400 });
  }
}
