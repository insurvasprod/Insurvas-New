import { NextResponse, type NextRequest } from "next/server";
import { after as afterResponse } from "next/server";

import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { currentSetupStepKey, guideHref, isManualStep, isSetupStepKey, nextSetupStep } from "@/lib/dashboard/checklist";
import { loadSetupGuideState, saveSetupGuideState } from "@/lib/dashboard/setupProgress";
import { loadViewerSetup } from "@/lib/dashboard/setupViewer";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * The caller's own setup walkthrough (2026-10-21). No feature gate: the steps are already filtered
 * by the plan, the role and hidden pages, and each step's screen enforces its own gate. The guide bar
 * polls this after a save on the step's screen to learn the step is done.
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  const [entitlement, switches] = await Promise.all([getEntitlement(context.tenantId), loadFeatureSwitches()]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const viewer = await loadViewerSetup(context, available, entitlement.limits.max_seats);
  if (viewer.needsStamp) afterResponse(viewer.stamp);
  const next = nextSetupStep(viewer.checklist);
  return NextResponse.json({
    audience: viewer.audience,
    closed: viewer.closed,
    hidden: viewer.guide.hiddenAt !== null,
    checklist: viewer.checklist,
    next: next ? { key: next.key, label: next.label, href: guideHref(next) } : null,
  });
}

type SetupAction = "skip" | "unskip" | "done" | "undone" | "hide" | "show";
const ACTIONS: readonly SetupAction[] = ["skip", "unskip", "done", "undone", "hide", "show"];

/** Marks a step skipped or done (manual steps only), or hides the dashboard card. Only the caller's own row. */
export async function PATCH(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  const body = (await request.json().catch(() => null)) as { action?: unknown; step?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS.includes(action as SetupAction)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  // An old link may still carry a merged step key; the mark lands on the step that replaced it.
  const step = typeof body?.step === "string" ? (isSetupStepKey(body.step) ? currentSetupStepKey(body.step) : body.step) : null;
  const needsStep = action !== "hide" && action !== "show";
  if (needsStep && (!step || !isSetupStepKey(step))) return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  if ((action === "done" || action === "undone") && step && !isManualStep(step)) {
    return NextResponse.json({ error: "This step is ticked by doing it" }, { status: 400 });
  }

  const state = await loadSetupGuideState(context.tenantId, context.userId);
  const without = (list: string[]) => list.filter((key) => key !== step);
  const next = { ...state };
  if (action === "skip" && step) next.skipped = [...without(state.skipped), step];
  if (action === "unskip") next.skipped = without(state.skipped);
  if (action === "done" && step) { next.done = [...without(state.done), step]; next.skipped = without(state.skipped); }
  if (action === "undone") next.done = without(state.done);
  if (action === "hide") next.hiddenAt = new Date().toISOString();
  if (action === "show") next.hiddenAt = null;

  try {
    await saveSetupGuideState(context.tenantId, context.userId, next);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
