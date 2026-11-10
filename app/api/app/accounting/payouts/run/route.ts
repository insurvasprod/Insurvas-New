import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { PayoutError, runInvoices } from "@/lib/accounting/payoutStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Partner payouts rework (owner, 2026-11-06) · Run payouts: every partner whose pay schedule has ended
 * gets a draft invoice holding all its unpaid ledger entries, locked to it so they are never paid twice.
 * `dry_run` previews who is due and what each invoice would hold. No money moves. Owner and bookkeeper.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const body = z.object({ dry_run: z.boolean(), partner_ids: z.array(z.string().uuid()).max(500).nullable().optional() }).strict();

export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say whether this is a preview." }, { status: 400 });
  const auth = await requireFeatureRole("payout_runs", ROLES, { write: !parsed.data.dry_run });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;
  try {
    const partners = await runInvoices(tenantId, userId, { dryRun: parsed.data.dry_run, partnerIds: parsed.data.partner_ids ?? null });
    if (!parsed.data.dry_run) {
      const built = partners.filter((p) => p.runId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_invoices_run", targetType: "tenant", targetId: tenantId, metadata: { tenantId, invoices: built.map((p) => p.runId), problems: partners.filter((p) => p.problem).length }, request });
    }
    return NextResponse.json({ partners }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[payouts-run]", error);
    return NextResponse.json({ error: "Payouts could not be run" }, { status: 500 });
  }
}
