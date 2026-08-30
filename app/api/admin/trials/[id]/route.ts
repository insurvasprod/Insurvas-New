import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { TrialError, cancelTrial, convertTrialNow, extendTrial } from "@/lib/trials/actions";
import { audit } from "@/lib/audit/log";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extend"),
    days: z.number().int().min(1).max(90),
    // Mandatory: an extension is revenue given away, and "why" is the first thing anyone asks later.
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
  }),
  z.object({ action: z.literal("convert") }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
  }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const input = parsed.data;

    if (input.action === "extend") {
      const result = await extendTrial(id, input.days);
      await audit({
        actorId: auth.session.sub,
        action: "trial.extended",
        targetType: "subscription",
        targetId: id,
        reason: input.reason,
        metadata: { days: input.days, trialEndsAt: result.trialEndsAt },
        request,
      });
      return NextResponse.json({ ok: true, trialEndsAt: result.trialEndsAt });
    }

    if (input.action === "convert") {
      const result = await convertTrialNow(id);
      await audit({
        actorId: auth.session.sub,
        action: "trial.converted_early",
        targetType: "subscription",
        targetId: id,
        metadata: { chargedCents: result.chargedCents },
        request,
      });
      return NextResponse.json({ ok: true, chargedCents: result.chargedCents });
    }

    await cancelTrial(id, input.reason);
    await audit({
      actorId: auth.session.sub,
      action: "trial.cancelled",
      targetType: "subscription",
      targetId: id,
      reason: input.reason,
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TrialError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[trials] action failed:", error);
    return NextResponse.json({ error: "Could not complete that action" }, { status: 500 });
  }
}
