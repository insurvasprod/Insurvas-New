import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { saveAdvanceRule, saveCommissionSchedule, saveTenantCarrier } from "@/lib/carriers/service";
import { refreshDiscrepanciesQuietly } from "@/lib/discrepancies/service";
import { addBand, computeExpected, RateCardError, saveProductFamily } from "@/lib/ingestion/expectedCommissionStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { refreshPolicyCurrent } from "@/lib/ingestion/policyCurrentStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.13 (Notion sprint) · the rate card: the agency's contract level per carrier, its rates
 * (LA-0.4's commission_schedules, with age bands), and which product family each carrier product
 * code belongs to, and the advance rule per product family (moved here from Settings › Carrier
 * library, 2026-10-08, so it sits beside the rates it applies to). After every change the expected figures are computed again: policies without a
 * figure get one; a figure already recorded never changes (rates are forward-only).
 *
 * Owner and bookkeeper: rates and contract levels are the agency's income terms.
 */
const roles = ["owner", "bookkeeper"] as const;
const uuid = z.string().refine(isRecordUuid, "Choose from the list.");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
const bp = (max: number) => z.number().int("Rates are whole basis points.").min(0).max(max);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_level"), carrier_id: uuid, contract_level_bp: bp(100000), writing_number: z.string().trim().min(1, "Enter your writing number with this carrier.").max(120), effective_from: day }).strict(),
  z.object({ action: z.literal("save_rate"), carrier_id: uuid, product_code: z.string().min(1).max(80), contract_level_bp: bp(100000), policy_year: z.number().int().min(1).max(50), rate_bp: bp(1000000), effective_from: day, applies_onward: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("add_band"), carrier_id: uuid, schedule_id: uuid, age_min: z.number().int().min(0).max(120), age_max: z.number().int().min(0).max(120), rate_bp: bp(1000000) }).strict().refine((b) => b.age_min <= b.age_max, "The band's lower age must not be above its upper age."),
  z.object({ action: z.literal("map_product"), carrier_id: uuid, carrier_product_code: z.string().trim().min(1).max(120), product_code: z.string().min(1).max(80).nullable() }).strict(),
  z.object({ action: z.literal("save_advance_rule"), carrier_id: uuid, product_code: z.string().min(1).max(80), advance_months: z.number().int().min(0).max(120), advance_pct_bp: bp(100000), clawback_months: z.number().int().min(0).max(240), clawback_type: z.enum(["full", "prorated"]), effective_from: day }).strict(),
]);

function failure(error: unknown, fallback: string) {
  if (error instanceof RateCardError) return NextResponse.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "";
  if (/Save the carrier contract level/.test(message)) return NextResponse.json({ error: "Save your contract level with this carrier first." }, { status: 409 });
  console.error(`[rate-card] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.action === "save_level") {
      await saveTenantCarrier(tenantId, { carrier_id: input.carrier_id, contract_level_bp: input.contract_level_bp, writing_number: input.writing_number, effective_from: input.effective_from });
    } else if (input.action === "save_rate") {
      await saveCommissionSchedule(tenantId, { carrier_id: input.carrier_id, product_code: input.product_code, contract_level_bp: input.contract_level_bp, policy_year: input.policy_year, rate_bp: input.rate_bp, effective_from: input.effective_from, applies_onward: input.applies_onward === true });
    } else if (input.action === "add_band") {
      await addBand(tenantId, { scheduleId: input.schedule_id, ageMin: input.age_min, ageMax: input.age_max, rateBp: input.rate_bp });
    } else if (input.action === "map_product") {
      await saveProductFamily(tenantId, userId, { carrierId: input.carrier_id, carrierProductCode: input.carrier_product_code, productCode: input.product_code });
    } else {
      await saveAdvanceRule(tenantId, { carrier_id: input.carrier_id, product_code: input.product_code, advance_months: input.advance_months, advance_pct_bp: input.advance_pct_bp, clawback_months: input.clawback_months, clawback_type: input.clawback_type, effective_from: input.effective_from });
    }
    // The clawback window reads the advance rule through the product family, so either change moves
    // "inside the window" (and the risk band) now, not at the next daily refresh.
    if (input.action === "save_advance_rule" || input.action === "map_product") await refreshPolicyCurrent({ tenantId, carrierId: input.carrier_id });
    await audit({ actorType: "tenant", actorId: userId, action: "rate_card.saved", targetType: "carrier", targetId: input.carrier_id, metadata: { tenantId, change: input.action, ...input }, request });
    const outcome = await computeExpected(tenantId, input.carrier_id);
    // What the contract expects changed, so what the carrier owes may have too. After the response.
    after(() => refreshDiscrepanciesQuietly(tenantId));
    return NextResponse.json({ ok: true, expected: outcome });
  } catch (error) {
    return failure(error, "That could not be saved");
  }
}
