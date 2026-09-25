import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { SCORING_SIGNALS, saveScoringSettings, scoringOverview } from "@/lib/scoring/service";

/**
 * LA-2.13 · queue scoring — its settings, its weights, and the holdout comparison.
 *
 * Owner and producer. A setter must not reach it: the weights decide the order of their own queue,
 * and vendor contact rate is one of the signals.
 */
const SCORING_ROLES = ["owner", "producer"] as const;

const saveSchema = z.object({
  enabled: z.boolean(),
  // A holdout is a slice, not a coin flip. Capped at 50 because a control arm larger than the
  // treatment arm measures the naive order more precisely than the thing being tested.
  holdout_pct: z.number().int().min(0).max(50),
  weights: z.array(z.object({
    signal: z.enum(SCORING_SIGNALS.map((signal) => signal.signal) as [string, ...string[]]),
    // Bounded so one signal cannot swamp the rest by three orders of magnitude and turn the score
    // into a single-signal sort nobody can read.
    weight: z.number().min(0).max(100),
  })).max(SCORING_SIGNALS.length),
}).strict();

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", SCORING_ROLES);
  if (auth instanceof NextResponse) return auth;
  // The holdout comparison's window: the last 14 days by default (the board's reading), or all-time.
  const period = request.nextUrl.searchParams.get("period") === "all" ? "all" : "14d";
  try {
    return NextResponse.json(await scoringOverview(auth.context.tenantId, period), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load queue scoring" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", SCORING_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter valid scoring settings" },
      { status: 400 },
    );

  try {
    await saveScoringSettings({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      enabled: parsed.data.enabled,
      holdoutPct: parsed.data.holdout_pct,
      weights: parsed.data.weights,
    });
    // Audited because it changes what every agent is handed next, and a queue that reorders with no
    // record of who changed it is a support conversation nobody can win.
    await audit({
      actorType: "tenant", actorId: auth.context.userId, action: "tenant.queue_scoring_updated",
      targetType: "tenant", targetId: auth.context.tenantId,
      metadata: { enabled: parsed.data.enabled, holdoutPct: parsed.data.holdout_pct, weights: parsed.data.weights },
      request,
    });
    return NextResponse.json(await scoringOverview(auth.context.tenantId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save queue scoring" },
      { status: 500 },
    );
  }
}
