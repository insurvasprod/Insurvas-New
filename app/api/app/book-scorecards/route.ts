import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { saveMinSample, ScorecardsError } from "@/lib/ingestion/scorecardsStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.18 (Notion sprint) · the scorecards' one setting: the sample size below which a share is shown
 * as a count. The figures themselves are computed live by the page; nothing else is written. Owner only.
 */
const body = z.object({
  action: z.literal("save_settings"),
  min_sample: z.number({ message: "Enter the sample size." }).int("The sample size is a whole number from 2 to 100.").min(2, "The sample size is a whole number from 2 to 100.").max(100, "The sample size is a whole number from 2 to 100."),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("cohort_persistency", ["owner"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    await saveMinSample({ tenantId, userId, role }, parsed.data.min_sample);
    await audit({ actorType: "tenant", actorId: userId, action: "scorecards.settings_saved", targetType: "tenant", targetId: tenantId, metadata: { tenantId, min_sample: parsed.data.min_sample }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ScorecardsError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[book-scorecards] settings:", error);
    return NextResponse.json({ error: "The setting could not be saved" }, { status: 500 });
  }
}
