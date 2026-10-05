import { NextResponse } from "next/server";

import { db, isMissingSchema } from "@/lib/applications/db";
import { actorOf, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3 · the lead page's "Open application": this lead's open case, or its most recent one. */
export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { leadId } = await params;
  if (!isUuid(leadId)) return NextResponse.json({ caseId: null });
  const q = await db().from("tenant_application_cases").select("id, status, opened_at").eq("tenant_id", actor.tenantId).eq("lead_id", leadId).order("opened_at", { ascending: false }).limit(5);
  if (q.error) return NextResponse.json({ caseId: null, schemaPending: isMissingSchema(q.error) });
  const list = (q.data ?? []) as { id: string; status: string }[];
  const open = list.find((c) => c.status === "open") ?? list[0] ?? null;
  // Only a case that has an attempt opens the workspace; a bare LA-2.14 case goes through start.
  let hasAttempt = false;
  if (open) {
    const a = await db().from("tenant_applications").select("id").eq("tenant_id", actor.tenantId).eq("case_id", open.id).limit(1);
    hasAttempt = !a.error && (a.data ?? []).length > 0;
  }
  return NextResponse.json({ caseId: open && hasAttempt ? open.id : null, status: open?.status ?? null });
}
