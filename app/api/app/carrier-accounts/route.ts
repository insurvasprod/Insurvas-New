import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { AccountError, saveStatement } from "@/lib/ingestion/carrierAccountsStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.14 (Notion sprint) · a carrier statement's header, typed in from the statement: opening and
 * closing balance, the activity it states, what was sent and what was held. The checks (arithmetic,
 * the lines against the activity, continuity with the previous statement) are the database's.
 *
 * Owner and bookkeeper, as carrier files.
 */
const roles = ["owner", "bookkeeper"] as const;
const cents = z.number().int("Amounts are whole cents.").min(-100_000_000_00).max(100_000_000_00);
const notNegative = cents.min(0, "Paid, held and the minimum payout can't be negative.");
const body = z.object({
  action: z.literal("save_statement"),
  carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
  statement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the statement date."),
  file_id: z.string().refine(isRecordUuid, "Choose the commission file.").nullable(),
  opening_cents: cents,
  activity_cents: cents,
  closing_cents: cents,
  amount_paid_cents: notNegative.nullable(),
  held_cents: notNegative.nullable(),
  minimum_payout_cents: notNegative.nullable(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the statement and try again." }, { status: 400 });
  const b = parsed.data;
  try {
    await saveStatement(auth.context.tenantId, auth.context.userId, {
      carrierId: b.carrier_id, statementDate: b.statement_date, fileId: b.file_id, openingCents: b.opening_cents, activityCents: b.activity_cents, closingCents: b.closing_cents,
      amountPaidCents: b.amount_paid_cents, heldCents: b.held_cents, minimumPayoutCents: b.minimum_payout_cents,
    });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "carrier_account.statement_saved", targetType: "carrier", targetId: b.carrier_id, metadata: { tenantId: auth.context.tenantId, statementDate: b.statement_date, fileId: b.file_id, openingCents: b.opening_cents, activityCents: b.activity_cents, closingCents: b.closing_cents }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccountError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[carrier-accounts] save:", error);
    return NextResponse.json({ error: "The statement could not be saved" }, { status: 500 });
  }
}
