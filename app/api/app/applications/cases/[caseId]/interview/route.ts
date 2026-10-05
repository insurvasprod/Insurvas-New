import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { completeInterview, ensureInterview, saveAnswers } from "@/lib/applications/mutations";
import { interviewAnswersSchema } from "@/lib/applications/schemas";

/**
 * LA-3.2 · the underwriting interview for one insured on a case. PUT saves answers as they are given
 * (a dropped call loses nothing) and deletes the answers of follow-ups that are hidden again; after
 * the interview is complete every change is recorded against the value it replaced.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const input = await body(request, interviewAnswersSchema);
  if (input instanceof NextResponse) return input;
  try {
    const interviewId = await ensureInterview(actor, caseId, input.insured_role);
    const saved = await saveAnswers(actor, interviewId, input.answers.map((a) => ({ key: a.key, value: a.value, notes: a.notes ?? null })), input.hidden);
    return NextResponse.json({ interviewId, ...saved });
  } catch (error) {
    return failure(error);
  }
}

/** Mark the interview complete; later edits are amendments with an audit trail. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const role = new URL(request.url).searchParams.get("insured") === "spouse" ? "spouse" : "primary";
  try {
    const interviewId = await ensureInterview(actor, caseId, role);
    return NextResponse.json({ interviewId, ...(await completeInterview(actor, interviewId)) });
  } catch (error) {
    return failure(error);
  }
}
