import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { CarrierContactError, getCarrierCommissionContact, saveCarrierCommissionContact } from "@/lib/discrepancies/carrierContacts";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.5 follow-up): where this agency's dispute letters to one carrier go.
 *
 * GET `?carrier=` reads the saved commissions address; reading, so a read-only account may.
 * PUT `{ carrier_id, address, email? }` saves it for everyone in the agency who prints letters; a
 * write, audited. Owner and bookkeeper, as the Discrepancies page and the letter.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles);
  if (auth instanceof NextResponse) return auth;
  const carrier = request.nextUrl.searchParams.get("carrier") ?? "";
  if (!isRecordId(carrier)) return NextResponse.json({ error: "Choose a carrier" }, { status: 400 });
  try {
    const result = await getCarrierCommissionContact(auth.context.tenantId, carrier);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[carrier-contact] read", error);
    return NextResponse.json({ error: "Could not load the carrier's commissions address" }, { status: 500 });
  }
}

const bodySchema = z.object({
  carrier_id: z.string().refine(isRecordId, "Choose a carrier"),
  address: z.string().trim().min(1, "Enter the commissions department's address").max(600, "Keep the address under 600 characters"),
  email: z.string().trim().max(254).email("Enter a valid email, or leave it empty").nullish().or(z.literal("")),
}).strict();

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the address and try again" }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    await saveCarrierCommissionContact(tenantId, userId, { carrierId: body.data.carrier_id, address: body.data.address, email: body.data.email || null });
    await audit({
      actorType: "tenant",
      actorId: userId,
      action: "tenant.carrier_commission_contact_saved",
      targetType: "carrier",
      targetId: body.data.carrier_id,
      metadata: { tenantId, hasEmail: Boolean(body.data.email) },
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CarrierContactError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[carrier-contact] save", error);
    return NextResponse.json({ error: "Could not save the carrier's commissions address" }, { status: 500 });
  }
}
