import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { LA5_OWNER_ROLES } from "@/lib/retention/assignment";
import { ASSIGNMENT_STRATEGIES, QUEUE_DEFAULT_SORTS, SIGNALS, WINBACK_REASONS, type RetentionSettings, type Weights } from "@/lib/retention/constants";
import { HUB_SECTIONS } from "@/lib/retention/settingsHub";
import { HubError, previewWeights, resetHubSection, saveQueueRules, saveSettings, saveWeights } from "@/lib/retention/settingsHubStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.11 (Notion sprint) · the retention settings hub. Owner only: weights, thresholds and cooling-off
 * periods are not a retention rep's to change (LA-5.8). Every value is re-validated on the server
 * against the database's own limits; every change is audited.
 */
const int = z.number().int();
const settings = z.object({
  mediumFrom: int, highFrom: int, criticalFrom: int, queueMinBand: z.enum(["medium", "high", "critical"]),
  includeMediumWhenEmpty: z.boolean(), workedCooldownDays: int, maxCards: int, sampleFloor: int, carrierSampleFloor: int,
  dangerMonthFrom: int, dangerMonthTo: int, affordabilityLowBp: int, affordabilityHighBp: int,
  billDeclineCooloffDays: int, billTalkTrack: z.string().max(4000).nullable(),
  reinstatementAmberDays: int, reinstatementRedDays: int, reinstatementPinDays: int, reinstatementEscalateDays: int,
  queueDefaultSort: z.enum(QUEUE_DEFAULT_SORTS), servicingGraceDays: int,
  winbackDays: z.object(Object.fromEntries(WINBACK_REASONS.map((r) => [r, int])) as Record<(typeof WINBACK_REASONS)[number], typeof int>).strict(),
  assignmentStrategy: z.enum(ASSIGNMENT_STRATEGIES), assignmentCarrierReps: z.record(z.string(), z.string()), assignmentRepOrder: z.array(z.string()).max(200),
  holdoutEnabled: z.boolean(), holdoutShareBp: int, holdoutMaxExposureCents: int, predictionHorizonDays: int,
}).strict();
const weights = z.object(Object.fromEntries(SIGNALS.map((s) => [s, int])) as Record<(typeof SIGNALS)[number], typeof int>).strict();
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_settings"), settings, confirmation: z.string().max(40).nullable().optional(), holdout_acknowledged: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("preview_weights"), weights }).strict(),
  z.object({ action: z.literal("save_weights"), weights, note: z.string().max(500).nullable().optional() }).strict(),
  z.object({ action: z.literal("reset"), section: z.enum(HUB_SECTIONS), confirmation: z.string().max(40).nullable().optional() }).strict(),
  z.object({ action: z.literal("save_rules"), rules: z.object({ save_queue: z.enum(LA5_OWNER_ROLES), paper_bill: z.enum(LA5_OWNER_ROLES), reinstatement: z.enum(LA5_OWNER_ROLES) }).strict() }).strict(),
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the values and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId } = auth.context;
  try {
    if (b.action === "preview_weights") return NextResponse.json({ ok: true, preview: await previewWeights(tenantId, b.weights as Weights) });
    const changes =
      b.action === "save_settings" ? await saveSettings(tenantId, userId, b.settings as RetentionSettings, { confirmation: b.confirmation ?? null, holdoutAcknowledged: b.holdout_acknowledged ?? false })
      : b.action === "save_weights" ? await saveWeights(tenantId, userId, b.weights as Weights, b.note ?? null)
      : b.action === "save_rules" ? await saveQueueRules(tenantId, userId, b.rules)
      : await resetHubSection(tenantId, userId, b.section, { confirmation: b.confirmation ?? null });
    if (changes.length) {
      await audit({ actorType: "tenant", actorId: userId, action: "retention.settings_changed", targetType: "retention_settings", targetId: tenantId, metadata: { tenantId, changes: changes.map((c) => c.setting) }, request });
    }
    return NextResponse.json({ ok: true, changes });
  } catch (error) {
    if (error instanceof HubError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention-settings]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
