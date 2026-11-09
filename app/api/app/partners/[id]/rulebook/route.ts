import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getRulebook, PayoutError, saveRulebook } from "@/lib/accounting/payoutStore";
import { CHARGEBACK_POLICIES, PARTNER_PAYMENT_METHODS, PAYOUT_CADENCES, RULEBOOK_MODELS } from "@/lib/accounting/partnerPayoutCore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Partner payouts rework (owner, 2026-11-06) · a partner's payout rulebook: how they win (Model A or B),
 * how much, when they are paid, who carries chargebacks, and who gets the money. The price is saved as a
 * new effective-dated term (LA-1.1, insert-only); the rest on the partner's payout profile. Owner and
 * bookkeeper, under Partner payouts.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optional = (max: number) => z.string().trim().max(max).nullable().transform((v) => (v ? v : null));
const body = z.object({
  model: z.enum(RULEBOOK_MODELS),
  rate_cents: z.number().int().min(0).max(100_000_000).nullable(),
  rate_pct_bp: z.number().int().min(1).max(10_000).nullable(),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cadence: z.enum(PAYOUT_CADENCES),
  chargeback_policy: z.enum(CHARGEBACK_POLICIES),
  payee_name: optional(200),
  payee_email: z.string().trim().max(320).nullable().transform((v) => (v ? v : null)).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email for the payee."),
  payment_method: z.enum(PARTNER_PAYMENT_METHODS).nullable(),
  payment_note: optional(500),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[partner-rulebook]", error);
  return NextResponse.json({ error: "The rulebook could not be saved" }, { status: 500 });
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("payout_runs", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ rulebook: await getRulebook(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("payout_runs", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the rulebook." }, { status: 400 });
  const b = parsed.data;
  if (b.model === "revenue_share" ? b.rate_pct_bp == null : b.rate_cents == null) {
    return NextResponse.json({ error: b.model === "revenue_share" ? "Enter their share of the commission." : "Enter the flat rate per submitted application." }, { status: 400 });
  }
  const { tenantId, userId } = auth.context;
  try {
    const result = await saveRulebook(tenantId, userId, id, {
      model: b.model, rateCents: b.model === "revenue_share" ? null : b.rate_cents, ratePctBp: b.model === "revenue_share" ? b.rate_pct_bp : null, startsOn: b.starts_on,
      cadence: b.cadence, chargebackPolicy: b.chargeback_policy, payeeName: b.payee_name, payeeEmail: b.payee_email, paymentMethod: b.payment_method, paymentNote: b.payment_note,
    });
    await audit({
      actorType: "tenant", actorId: userId, action: "accounting.partner_rulebook_saved", targetType: "partner", targetId: id,
      metadata: { tenantId, model: b.model, rateCents: b.rate_cents, ratePctBp: b.rate_pct_bp, startsOn: b.starts_on, cadence: b.cadence, chargebackPolicy: b.chargeback_policy, paymentMethod: b.payment_method, termAdded: result.termAdded },
      request,
    });
    return NextResponse.json({ rulebook: await getRulebook(tenantId, id), termAdded: result.termAdded });
  } catch (error) {
    return fail(error);
  }
}
