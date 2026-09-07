import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { contactSchema } from "@/lib/contacts/schemas";
import { findDuplicates } from "@/lib/contacts/service";

/**
 * Authorization boundary for inbound transfer work. The transfer workflow itself is out of
 * scope for this shell ticket, but the endpoint must already fail closed for an unentitled or
 * suspended tenant before a future provider integration can do any work.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  if (body && typeof body === "object") {
    const candidate = contactSchema.safeParse(body);
    if (!candidate.success) return NextResponse.json({ error: candidate.error.issues[0]?.message ?? "Transfer contact details are invalid" }, { status: 400 });
    const duplicates = await findDuplicates(auth.context.tenantId, candidate.data);
    return NextResponse.json({ error: "Inbound transfer intake is not available in this application frame.", duplicates }, { status: 501 });
  }

  return NextResponse.json(
    { error: "Inbound transfer intake is not available in this application frame." },
    { status: 501 },
  );
}
