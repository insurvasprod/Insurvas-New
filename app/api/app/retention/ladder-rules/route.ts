import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { REASONS } from "@/lib/retention/cases/ladder";
import { LadderRulesError, saveLadderRules } from "@/lib/retention/cases/rulesStore";
import { syncRetentionCases } from "@/lib/retention/cases/sync";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Settings › Retention › Ladder rules (owner 2026-11-05): which file facts put a policy on the ladder, when a
 * deadline is urgent, after how many tries a client is unreachable. Owner only; the server checks every value.
 * A save re-runs the ladder at once, so the cases follow the rules.
 */
const body = z.object({
  disabled: z.array(z.enum(REASONS)).max(REASONS.length),
  urgent_days: z.number().int().min(0).max(60),
  unreachable_after: z.number().int().min(1).max(20),
}).strict();

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the values and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const saved = await saveLadderRules(tenantId, userId, { disabled: parsed.data.disabled, urgentDays: parsed.data.urgent_days, unreachableAfter: parsed.data.unreachable_after });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.settings_changed", targetType: "tenant", targetId: tenantId, metadata: { tenantId, section: "ladder_rules", before: saved.before, after: saved.after }, request });
    await syncRetentionCases(tenantId).catch((error) => console.error("[ladder rules] the cases could not follow at once", error));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LadderRulesError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[ladder rules]", error);
    return NextResponse.json({ error: "The rules could not be saved" }, { status: 500 });
  }
}
