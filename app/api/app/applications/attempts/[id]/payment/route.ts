import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { syncHouseholdFromPrimary } from "@/lib/applications/household";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { demoteIfFailing, savePayment } from "@/lib/applications/mutations";
import { paymentSchema } from "@/lib/applications/schemas";

/**
 * LA-3.19 · how the client pays. The schema is strict, so a card security code is refused as an
 * unknown key — it is never stored, anywhere. A number left blank keeps the one already on file.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, paymentSchema);
  if (input instanceof NextResponse) return input;
  try {
    const saved = await savePayment(actor, id, {
      method: input.method, routing: input.routing ?? null, account: input.account ?? null, accountType: input.account_type ?? null, bankName: input.bank_name ?? null,
      nameOnAccount: input.name_on_account ?? null, card: input.card ?? null, cardExpMonth: input.card_exp_month ?? null, cardExpYear: input.card_exp_year ?? null,
      nameOnCard: input.name_on_card ?? null, billingFrequency: input.billing_frequency ?? null, billingAddressSameAsInsured: input.billing_address_same_as_insured ?? null,
    });
    await demoteIfFailing(actor, id);
    // LA-3.24 · a spouse application sharing this detail follows it. The save above already stands.
    await syncHouseholdFromPrimary(actor.tenantId, id, actor.userId).catch((error) => console.error("household sync failed", error));
    return NextResponse.json(saved);
  } catch (error) {
    return failure(error);
  }
}
