import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { CreditNoteError, executeCreditNote } from "@/lib/credits/service";
import { audit } from "@/lib/audit/log";

/** Retry a provider-pending credit note with the original idempotency key. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const outcome = await executeCreditNote(id);

    await audit({
      actorId: auth.session.sub,
      action: "credit_note.reconciled",
      targetType: "credit_note",
      targetId: id,
      metadata: { status: outcome.status, message: outcome.message },
      request,
    });

    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof CreditNoteError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[credit-notes] reconciliation failed:", error);
    return NextResponse.json({ error: "Could not reconcile the credit note" }, { status: 500 });
  }
}
