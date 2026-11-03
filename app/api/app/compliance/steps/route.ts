import { NextResponse } from "next/server";

import { listComplaints } from "@/lib/compliance/complaintStore";
import { listDeletionRequests } from "@/lib/compliance/dataSubjectStore";
import { holdRemaining } from "@/lib/compliance/dataSubject";
import type { ComplianceStepCounts } from "@/lib/compliance/steps";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * The live counts on the one Compliance page's rail (2026-10-30): what waits on a person, per step. Both
 * read the lists their own steps show, under those steps' gate (tcpa_checker, owner and producer, never a
 * narrow agency session). Head counts only; a read that fails leaves its step out and the rail keeps its
 * plain line.
 *
 *   complaints  open complaints overdue, inside the red window, or a regulator's with no deadline set
 *   deletions   requests to verify, and holds that are over (ready to delete)
 */
const ROLES = ["owner", "producer"] as const;
const WAITING = new Set(["overdue", "red", "no_deadline"]);

export async function GET() {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Compliance");
  if (refused) return refused;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  const now = new Date();
  const [complaints, deletions] = await Promise.all([
    listComplaints(viewer).then((rows) => rows.filter((c) => c.status !== "resolved" && WAITING.has(c.countdown.tone)).length).catch(() => null),
    listDeletionRequests(viewer).then((rows) => rows.filter((r) => r.status === "received" || r.status === "verifying" || (r.status === "scheduled" && holdRemaining(r.scheduledPurgeAt, now).due)).length).catch(() => null),
  ]);
  const counts: ComplianceStepCounts = {};
  if (complaints !== null) counts.complaints = complaints;
  if (deletions !== null) counts.deletions = deletions;
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
