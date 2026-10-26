import { NextResponse, type NextRequest } from "next/server";

import { resolveSignupContext } from "@/lib/signup/context";
import { checkPlanChoice } from "@/lib/signup/planChoice";
import { fetchPlanChoices, savePlanChoice } from "@/lib/signup/planChoiceQueries";
import { planChoiceSchema } from "@/lib/signup/schemas";

/** Step 4 of 5: saves the plan, billing cycle, seats and add-ons, then sends the owner to Payment. */
export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // After Your agency and before the plan starts; awaiting_payment too, so "Change plan" on Payment works.
  if (context.userStatus !== "active" || !["ready_for_checkout", "awaiting_payment"].includes(context.onboardingState)) {
    return NextResponse.json({ error: "Finish the earlier sign-up steps first" }, { status: 409 });
  }

  const parsed = planChoiceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a plan" }, { status: 400 });

  const { plans } = await fetchPlanChoices();
  const checked = checkPlanChoice(plans, parsed.data);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 409 });

  const saved = await savePlanChoice(context.tenantId, {
    planCode: checked.plan.code,
    billingCycle: checked.billingCycle,
    seats: checked.seats,
    addonCodes: checked.addons.map((addon) => addon.code),
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });

  return NextResponse.json({ ok: true, redirectTo: "/app/checkout" });
}
