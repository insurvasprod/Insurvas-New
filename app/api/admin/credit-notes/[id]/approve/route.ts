import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { CreditNoteError, approveCreditNote } from "@/lib/credits/service";
import { audit } from "@/lib/audit/log";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const outcome = await approveCreditNote(id, auth.session.sub, auth.session.role);

    await audit({
      actorId: auth.session.sub,
      action: "credit_note.approved",
      targetType: "credit_note",
      targetId: id,
      metadata: { number: outcome.number, status: outcome.status },
      request,
    });

    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof CreditNoteError) {
      // 409: the request was well formed, the rules refused it — most often because the approver
      // is the person who raised it.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[credit-notes] approval failed:", error);
    return NextResponse.json({ error: "Could not approve the credit note" }, { status: 500 });
  }
}
