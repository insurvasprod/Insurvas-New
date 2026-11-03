import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { FindingReviewError, reviewFinding, runPending } from "@/lib/ingestion/dailyRunStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.19 (Notion sprint) · the agency's runs and its agents' findings.
 *
 *   { action: "run_now" }                        one run now over this agency's waiting files.
 *   { action: "review", id, verdict }            a person's verdict on an open finding: right
 *                                                (approved) or wrong (rejected) — what each agent's
 *                                                accuracy is measured on. Approving executes nothing.
 *
 * Owner and bookkeeper, as Carrier files.
 */
const roles = ["owner", "bookkeeper"] as const;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run_now") }).strict(),
  z.object({ action: z.literal("review"), id: z.string().refine(isRecordUuid, "Choose the finding."), verdict: z.enum(["approved", "rejected"], { message: "Say whether the finding was right." }) }).strict(),
], { message: "Choose what to do." });

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    if (parsed.data.action === "run_now") {
      const outcome = await runPending("manual", { tenantId });
      if (!outcome.available) return NextResponse.json({ error: "Run history needs a database update (20261008280000)." }, { status: 503 });
      const run = outcome.runs.find((r) => r.tenantId === tenantId);
      await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_files_run", targetType: "pipeline_run", targetId: run?.runId ?? tenantId, metadata: { tenantId, status: run?.status, files: run?.total ?? 0 }, request });
      return NextResponse.json({ ok: true, run });
    }
    await reviewFinding({ tenantId, userId }, parsed.data.id, parsed.data.verdict);
    await audit({ actorType: "tenant", actorId: userId, action: "tenant.agent_finding_reviewed", targetType: "agent_finding", targetId: parsed.data.id, metadata: { tenantId, verdict: parsed.data.verdict }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FindingReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[carrier-files/runs]", error);
    return NextResponse.json({ error: "That could not be done" }, { status: 500 });
  }
}
