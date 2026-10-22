import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { CADENCES, COMMISSION_TRIGGERS, RULE_SOURCES, RULE_TYPES, STATEMENT_FORMATS } from "./carrierRules";
import { addRule, CarrierRulesError, clearOverride, saveCarrierSettings, verifyRule, type RulesScope } from "./carrierRulesStore";
import { isoDate, isRecordUuid } from "./path";

/** LA-4.17 · the one request shape both planes accept: add a rule, clear an override, verify, save settings. */
const days = z.number().int().min(0).max(730).nullable();
export const carrierRulesAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_rule"),
    carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
    rule_type: z.enum(RULE_TYPES),
    window_days: days,
    grace_days: days,
    redraft_attempts: z.number().int().min(0).max(12).nullable(),
    redraft_interval_days: z.number().int().min(0).max(90).nullable(),
    source: z.enum(RULE_SOURCES, { message: "Say where the rule comes from." }),
    notes: z.string().trim().max(1000).nullable(),
    effective_from: z.string().refine((value) => isoDate(value) !== null, "Enter the date it applies from.").nullable(),
  }).strict(),
  z.object({ action: z.literal("clear_override"), carrier_id: z.string().refine(isRecordUuid), rule_type: z.enum(RULE_TYPES) }).strict(),
  z.object({ action: z.literal("verify"), rule_id: z.string().refine(isRecordUuid) }).strict(),
  z.object({
    action: z.literal("save_settings"),
    carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
    commission_trigger: z.enum(COMMISSION_TRIGGERS).nullable(),
    expected_lag_days: z.number().int().min(0).max(365).nullable(),
    minimum_payout_cents: z.number().int().min(0).nullable(),
    tolerance_cents: z.number().int().min(0).max(100000).nullable(),
    expected_cadence: z.enum(CADENCES).nullable(),
    statement_format: z.enum(STATEMENT_FORMATS).nullable(),
  }).strict(),
]);

export type CarrierRulesAction = z.infer<typeof carrierRulesAction>;

/** Runs one action for a scope; returns the audit action and target to record. */
type RulesAuditAction = "carrier_rule.added" | "carrier_rule.override_cleared" | "carrier_rule.verified" | "carrier_settings.saved";

export async function runCarrierRulesAction(scope: RulesScope, body: CarrierRulesAction): Promise<{ action: RulesAuditAction; targetType: string; targetId: string; metadata: Record<string, unknown> }> {
  if (body.action === "add_rule") {
    const id = await addRule(scope, { carrierId: body.carrier_id, ruleType: body.rule_type, windowDays: body.window_days, graceDays: body.grace_days, redraftAttempts: body.redraft_attempts, redraftIntervalDays: body.redraft_interval_days, source: body.source, notes: body.notes, effectiveFrom: body.effective_from });
    return { action: "carrier_rule.added", targetType: "carrier_retention_rule", targetId: id, metadata: { carrierId: body.carrier_id, ruleType: body.rule_type, windowDays: body.window_days, graceDays: body.grace_days, source: body.source, effectiveFrom: body.effective_from } };
  }
  if (body.action === "clear_override") {
    if (scope.plane !== "agency") throw new CarrierRulesError("Only an agency's own override can be cleared.", 400);
    const id = await clearOverride(scope, body.carrier_id, body.rule_type);
    return { action: "carrier_rule.override_cleared", targetType: "carrier_retention_rule", targetId: id, metadata: { carrierId: body.carrier_id, ruleType: body.rule_type } };
  }
  if (body.action === "verify") {
    await verifyRule(scope, body.rule_id);
    return { action: "carrier_rule.verified", targetType: "carrier_retention_rule", targetId: body.rule_id, metadata: {} };
  }
  await saveCarrierSettings(scope, body.carrier_id, { commissionTrigger: body.commission_trigger, expectedLagDays: body.expected_lag_days, minimumPayoutCents: body.minimum_payout_cents, toleranceCents: body.tolerance_cents, expectedCadence: body.expected_cadence, statementFormat: body.statement_format });
  return { action: "carrier_settings.saved", targetType: "carrier", targetId: body.carrier_id, metadata: { trigger: body.commission_trigger, lagDays: body.expected_lag_days, cadence: body.expected_cadence } };
}

export function carrierRulesFailure(error: unknown) {
  if (error instanceof CarrierRulesError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[carrier-rules]", error);
  return NextResponse.json({ error: "The carrier rules could not be saved. Try again." }, { status: 500 });
}
