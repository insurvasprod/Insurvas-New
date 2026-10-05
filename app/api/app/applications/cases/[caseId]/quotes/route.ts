import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { saveQuote } from "@/lib/applications/mutations";
import { quoteSchema } from "@/lib/applications/schemas";

/**
 * LA-3.5 · save a quote typed from the carrier's own tool. Cents in, cents stored. Premium ≥ face is
 * refused; anything merely unusual comes back as warnings and is saved anyway — if our band disagrees
 * with the carrier's screen, the carrier is right.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const input = await body(request, quoteSchema);
  if (input instanceof NextResponse) return input;
  try {
    const saved = await saveQuote(actor, caseId, {
      insuredRole: input.insured_role, carrierId: input.carrier_id, carrierProductId: input.carrier_product_id ?? null, productCode: input.product_code, tier: input.tier,
      faceAmountCents: input.face_amount_cents, monthlyPremiumCents: input.monthly_premium_cents, annualPremiumCents: input.annual_premium_cents ?? null,
      termLength: input.term_length ?? null, assumedHealthClass: input.assumed_health_class ?? null, riders: input.riders, ratingInputs: input.rating_inputs,
      quotationTemplateId: input.quotation_template_id ?? null, templateVersion: input.template_version ?? null, dob: input.dob ?? null, ageBasis: input.age_basis,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
