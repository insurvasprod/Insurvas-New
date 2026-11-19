import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { clearGoal, readGoal, writeGoal } from "@/lib/dashboard/goals";
import { GOAL_MONEY, GOAL_PERIOD, isGoalKind, maySetGoal, parseGoalTarget, type GoalFor, type GoalKind } from "@/lib/dashboard/goalRules";
import { requireTenant, type TenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * Goals and targets on the compact Home (roles r1, owner 2026-11-18): the "Set goal" / "Set target" sheet's writes.
 *
 *   GET    ?kind=premium&for=me|agency   the stored goal, or { state: "missing" } before the table exists
 *   POST   { kind, for, target }        sets it (premium in dollars, the rest a whole count)
 *   DELETE { kind, for }                clears it (the ring falls back to last month)
 *
 * Who may: the owner and admins any goal (their own or the agency's); a producer their own premium, a manager his
 * team's policies, a setter his weekly bookings, a retention rep her monthly saves (lib/dashboard/goalRules). The
 * role is the membership's, read from the session; the tenant is the session's, never the body's. Every change
 * writes one tenant audit row with the value before and after.
 */
const heldRole = (context: TenantContext) => context.memberRole ?? context.role;
const whoseOf = (value: unknown): GoalFor | null => (value === "me" || value === "agency" ? value : null);
const ownerOf = (context: TenantContext, whose: GoalFor) => (whose === "agency" ? null : context.userId);

export async function GET(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  const kind = request.nextUrl.searchParams.get("kind");
  const whose = whoseOf(request.nextUrl.searchParams.get("for") ?? "me");
  if (!isGoalKind(kind) || !whose) return NextResponse.json({ error: "Unknown goal" }, { status: 400 });
  // Reading the agency's goal is the agency's business: only who may set it.
  if (whose === "agency" && !maySetGoal(heldRole(context), kind, whose)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const goal = await readGoal(context.tenantId, ownerOf(context, whose), kind);
  return NextResponse.json({ goal, period: GOAL_PERIOD[kind], money: GOAL_MONEY[kind] });
}

async function readBody(request: NextRequest) {
  return (await request.json().catch(() => null)) as { kind?: unknown; for?: unknown; target?: unknown } | null;
}

function refused(context: TenantContext, kind: GoalKind, whose: GoalFor) {
  return maySetGoal(heldRole(context), kind, whose) ? null : NextResponse.json({ error: "You can't set this goal." }, { status: 403 });
}

const needsUpdate = () => NextResponse.json({ error: "Goals need a database update before they can be saved.", code: "needs_database_update" }, { status: 503 });

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  const body = await readBody(request);
  const whose = whoseOf(body?.for ?? "me");
  if (!isGoalKind(body?.kind) || !whose) return NextResponse.json({ error: "Unknown goal" }, { status: 400 });
  const kind = body.kind;
  const denied = refused(context, kind, whose);
  if (denied) return denied;
  const target = parseGoalTarget(kind, body?.target);
  if (target === null) return NextResponse.json({ error: GOAL_MONEY[kind] ? "Enter an amount above $0." : "Enter a whole number above 0." }, { status: 400 });

  const userId = ownerOf(context, whose);
  const saved = await writeGoal({ tenantId: context.tenantId, userId, kind, target, setBy: context.userId });
  if (!saved.ok) return saved.reason === "missing" ? needsUpdate() : NextResponse.json({ error: "The goal could not be saved." }, { status: 500 });
  await audit({
    actorType: "tenant",
    actorId: context.userId,
    action: "tenant.goal_set",
    targetType: "dashboard_goal",
    targetId: `${kind}:${userId ?? "agency"}`,
    metadata: { tenant_id: context.tenantId, kind, for: whose, period: GOAL_PERIOD[kind], before: saved.before, after: target },
    request,
  });
  return NextResponse.json({ ok: true, target });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  const body = await readBody(request);
  const whose = whoseOf(body?.for ?? "me");
  if (!isGoalKind(body?.kind) || !whose) return NextResponse.json({ error: "Unknown goal" }, { status: 400 });
  const kind = body.kind;
  const denied = refused(context, kind, whose);
  if (denied) return denied;

  const userId = ownerOf(context, whose);
  const cleared = await clearGoal({ tenantId: context.tenantId, userId, kind });
  if (!cleared.ok) return cleared.reason === "missing" ? needsUpdate() : NextResponse.json({ error: "The goal could not be cleared." }, { status: 500 });
  if (cleared.before !== null) {
    await audit({
      actorType: "tenant",
      actorId: context.userId,
      action: "tenant.goal_cleared",
      targetType: "dashboard_goal",
      targetId: `${kind}:${userId ?? "agency"}`,
      metadata: { tenant_id: context.tenantId, kind, for: whose, before: cleared.before, after: null },
      request,
    });
  }
  return NextResponse.json({ ok: true });
}
