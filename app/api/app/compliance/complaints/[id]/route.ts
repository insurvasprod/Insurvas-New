import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { COMPLAINT_OUTCOMES, COMPLAINT_STATUSES } from "@/lib/compliance/complaints";
import { checklistFor, ComplaintError, getComplaint, respondentFor, updateComplaint } from "@/lib/compliance/complaintStore";
import { complaintPeople } from "@/lib/compliance/complaintPeople";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-6.4 (Notion sprint) · one complaint: read it (with the response checklist) and move its
 * workflow. The response text is the agent's own: nothing here writes or suggests it.
 */
const ROLES = ["owner", "producer"] as const;
const patch = z.object({
  status: z.enum(COMPLAINT_STATUSES).optional(),
  outcome: z.enum(COMPLAINT_OUTCOMES).nullable().optional(),
  owner_user_id: z.string().uuid().optional(),
  response_text: z.string().max(20000).nullable().optional(),
  responded_at: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  checklist: z.record(z.string(), z.boolean()).optional(),
  regulator_state: z.string().regex(/^[A-Z]{2}$/).optional(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof ComplaintError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[complaint]", error);
  return NextResponse.json({ error: "The complaint could not be saved" }, { status: 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That complaint isn't here." }, { status: 404 });
  const { tenantId, userId, role } = auth.context;
  try {
    const complaint = await getComplaint({ tenantId, userId, role }, id);
    // A regulator complaint is answered under the business's legal name and NPN (LA-8.3).
    // `team`: who it can be given to, the record page's own owner picker (complaintPeople), so the phone's Reassign
    // (mobile board I6b) offers the same people the web does.
    // `carrierName` and `history` (mobile board I6b): the carrier of the policy it names, and who did what on it.
    const [checklist, respondent, people, carrierName, history] = await Promise.all([checklistFor(complaint.category), complaint.channel === "doi" ? respondentFor(tenantId, complaint.regulatorState) : null, complaintPeople(tenantId), policyCarrier(tenantId, complaint.policyNumber), complaintHistory(id)]);
    return NextResponse.json({ complaint, checklist, respondent, team: people.team, carrierName, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Complaints");
  if (refused) return refused;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That complaint isn't here." }, { status: 404 });
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the change and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  try {
    const complaint = await updateComplaint({ tenantId, userId, role }, id, {
      status: b.status, outcome: b.outcome, ownerUserId: b.owner_user_id, responseText: b.response_text, respondedAt: b.responded_at, notes: b.notes, checklist: b.checklist, regulatorState: b.regulator_state,
    });
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.complaint_updated", targetType: "complaint", targetId: id, metadata: { tenantId, fields: Object.keys(b) }, request });
    return NextResponse.json({ complaint });
  } catch (error) {
    return fail(error);
  }
}

/** The carrier of the agency's policy with this number (the book's current row), or null when none or unread. */
async function policyCarrier(tenantId: string, policyNumber: string | null): Promise<string | null> {
  if (!policyNumber?.trim()) return null;
  try {
    const db = getSupabaseServiceClient();
    // policy_current is not in the generated types, so the read is typed by hand.
    const { data } = await (db as unknown as { from(t: string): { select(c: string): { eq(c: string, v: string): { eq(c: string, v: string): { limit(n: number): PromiseLike<{ data: unknown }> } } } } }).from("policy_current").select("carrier_id").eq("tenant_id", tenantId).eq("policy_number", policyNumber.trim()).limit(2);
    const ids = [...new Set(((data ?? []) as Array<{ carrier_id: string | null }>).map((r) => r.carrier_id).filter((x): x is string => Boolean(x)))];
    if (ids.length !== 1) return null; // none, or the same number at two carriers: not one carrier to name
    const { data: carrier } = await db.from("carriers").select("name").eq("id", ids[0]).maybeSingle<{ name: string }>();
    return carrier?.name ?? null;
  } catch {
    return null;
  }
}

const HISTORY_ACTIONS = ["compliance.complaint_opened", "compliance.complaint_updated", "compliance.complaint_deadline_set"];

/**
 * The complaint's audit trail, oldest first: when it was recorded, each change and which fields it touched, the
 * regulator deadline, and who did each. The trail keeps field names, not their values, so a reassignment says it
 * was reassigned and by whom, not to whom. The complaint id was checked against the tenant before this runs.
 */
async function complaintHistory(id: string): Promise<{ at: string; by: string | null; action: string; fields: string[] }[]> {
  try {
    const db = getSupabaseServiceClient();
    const { data } = await db.from("audit_log").select("ts, actor_id, action, metadata").eq("target_type", "complaint").eq("target_id", id).in("action", HISTORY_ACTIONS).order("ts", { ascending: true }).limit(100);
    const rows = (data ?? []) as Array<{ ts: string; actor_id: string | null; action: string; metadata: Record<string, unknown> | null }>;
    const actors = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))];
    const names = new Map<string, string>();
    if (actors.length) {
      const { data: users } = await db.from("users").select("id, name").in("id", actors);
      for (const u of (users ?? []) as Array<{ id: string; name: string | null }>) if (u.name) names.set(u.id, u.name);
    }
    return rows.map((r) => ({
      at: r.ts,
      by: r.actor_id ? names.get(r.actor_id) ?? null : null,
      action: r.action.replace("compliance.complaint_", ""),
      fields: Array.isArray(r.metadata?.fields) ? (r.metadata!.fields as unknown[]).filter((f): f is string => typeof f === "string") : [],
    }));
  } catch {
    return [];
  }
}
