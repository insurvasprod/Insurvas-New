import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { hasFeature } from "@/lib/entitlements/types";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadReinstatement } from "@/lib/retention/reinstatementStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { CONTACT_OUTCOMES, PAYMENT_METHODS } from "@/lib/retention/constants";
import { CARRIER_METHODS, OPEN_STATUSES, ORIGINS } from "@/lib/retention/servicing";
import { addRequestNote, createRequest, loadPrefill, loadServicing, SERVICING_PENDING_MESSAGE, ServicingError, stepRequest } from "@/lib/retention/servicingStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * LA-5.4 (Notion sprint) · servicing requests. GET: what a new request starts from (the draft day the
 * radar knows, LA-3.9's recommended day and its reason, the carrier's instructions). POST: open a
 * request — from the save queue it is logged as the card's worked call and linked — or take a step a
 * person can take. Verified and failed are the carrier file's alone; nothing here can set them.
 *
 * Gated on `payment_repair`; owner and producer (a producer reaches the policies credited to them).
 */
// LA-5.8: a retention rep opens and tracks servicing requests.
const ROLES = ["owner", "producer", "retention"] as const;
const day = z.number().int().min(1, "Pick a draft day between the 1st and the 28th.").max(28, "Pick a draft day between the 1st and the 28th.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");
const send = z.object({
  method: z.enum(CARRIER_METHODS, { message: "Say how it was sent." }),
  form_ref: z.string().trim().max(200).nullable(),
  reference: z.string().trim().max(120).nullable(),
  expected_effective_date: isoDate.nullable(),
}).strict();
const policy = { carrier_id: z.string().refine(isRecordUuid, "Choose the policy."), policy_number: z.string().min(1).max(120) };
const change = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft_date_change"), target_draft_day: day }).strict(),
  z.object({ type: z.literal("payment_method_change"), to_method: z.enum(PAYMENT_METHODS).nullable(), account_last4: z.string().regex(/^\d{4}$/, "Only the last four digits.").nullable() }).strict(),
  z.object({ type: z.literal("bill_to_draft_conversion"), target_draft_day: day.nullable() }).strict(),
  z.object({ type: z.literal("address_change"), address: z.string().trim().max(300).nullable(), zip: z.string().trim().max(10).nullable(), state: z.string().trim().max(2).nullable() }).strict(),
]);
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    ...policy,
    origin: z.enum(ORIGINS),
    change,
    send: send.nullable(),
    note: z.string().trim().max(2000).nullable(),
    // From a save-queue card: the call is logged with this outcome and linked to the request.
    from_queue: z.object({ outcome: z.enum(CONTACT_OUTCOMES) }).strict().nullable(),
  }).strict(),
  z.object({
    action: z.literal("step"),
    id: z.string().refine(isRecordUuid, "Choose the request."),
    to: z.enum(["submitted", "awaiting_carrier", "confirmed_by_carrier", "cancelled"]),
    send: send.nullable(),
    reference: z.string().trim().max(120).nullable(),
    confirmed_on: isoDate.nullable(),
    note: z.string().trim().max(500).nullable(),
  }).strict(),
  z.object({ action: z.literal("note"), id: z.string().refine(isRecordUuid, "Choose the request."), note: z.string().trim().min(1, "Write the note first.").max(1000) }).strict(),
]);

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("payment_repair", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  if (request.nextUrl.searchParams.get("list") === "waiting") return waitingList(auth.context, hasFeature(auth.entitlement, "winback"));
  const carrierId = request.nextUrl.searchParams.get("carrier_id") ?? "";
  const policyNumber = request.nextUrl.searchParams.get("policy_number") ?? "";
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) return NextResponse.json({ error: "Choose the policy." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    // AG-0.5 · the policy must be credited to a visible producer (agent_user_id), else 404.
    return NextResponse.json(await loadPrefill({ tenantId, userId, role, scope: await scopeFor(auth.context) }, carrierId, policyNumber));
  } catch (error) {
    if (error instanceof ServicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[servicing] prefill:", error);
    return NextResponse.json({ error: "The policy could not be read" }, { status: 500 });
  }
}

/**
 * `?list=waiting` · the phone's Waiting on the carrier (mobile release 2, boards B7 and F3b): the requests still
 * open (not sent, sent, the carrier on it, the carrier says done) and those a carrier file proved in the last seven
 * days. Read through loadServicing, so who sees what is the page's rule, and, like the page, the open requests are
 * checked against the latest files first. No amounts: a request carries none.
 */
async function waitingList(context: { tenantId: string; userId: string; role: string }, winback: boolean) {
  const headers = { "Cache-Control": "no-store" };
  const { tenantId, userId, role } = context;
  try {
    const scope = await scopeFor(context);
    const reinstatementsRead = winback ? sentReinstatements({ tenantId, userId, role, scope }).catch(() => []) : Promise.resolve([]);
    const list = await loadServicing({ tenantId, userId, role, scope });
    if (!list.available) return NextResponse.json({ available: false, message: SERVICING_PENDING_MESSAGE }, { headers });
    const weekAgo = Date.now() - 7 * 86_400_000;
    const kept = list.rows.filter((r) => OPEN_STATUSES.includes(r.status) || (r.status === "verified_in_file" && r.verifiedAt !== null && Date.parse(r.verifiedAt) >= weekAgo));
    return NextResponse.json({
      available: true,
      requests: [
        ...kept.map((r) => ({
          id: r.id, caseId: r.caseId, clientName: r.clientName, carrierName: r.carrierName, policyNumber: r.policyNumber, type: r.type, status: r.status,
          createdAt: r.createdAt, submittedAt: r.submittedAt, expectedEffectiveDate: r.expectedEffectiveDate, verifiedAt: r.verifiedAt,
          verifiedSnapshotDate: r.verifiedSnapshotDate, checkedSnapshotDate: r.checkedSnapshotDate, unprovable: r.unprovable.length > 0,
        })),
        // Board F3b's "Reinstatement paid" (2026-11-27, additive): a reinstatement sent to the carrier waits here too,
        // until the files show the policy back in force, then shows a week as proved. `winback` plan only.
        ...(await reinstatementsRead).filter((r) => r.status === "submitted" || (r.status === "verified_in_file" && r.verifiedAt !== null && Date.parse(r.verifiedAt) >= weekAgo)),
      ],
    }, { headers });
  } catch (error) {
    console.error("[servicing] waiting list:", error);
    return NextResponse.json({ error: "The requests could not be read" }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/**
 * Reinstatements sent to a carrier, in the waiting list's shape: read through loadReinstatement, so who sees which is
 * the Win-back page's rule; the sent day and the ladder case it is worked on are looked up for those rows only
 * (service role, tenant filter on each read).
 */
async function sentReinstatements(viewer: { tenantId: string; userId: string; role: string; scope: Awaited<ReturnType<typeof scopeFor>> }) {
  const read = await loadReinstatement(viewer);
  if (!read.available) return [];
  const rows = [...read.open.filter((r) => r.status === "submitted"), ...read.closed.filter((r) => r.status === "reinstated")];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const db = getSupabaseServiceClient() as Loose;
  const [sent, cases] = await Promise.all([
    db.from("reinstatement_case").select("id, submitted_at, created_at").eq("tenant_id", viewer.tenantId).in("id", ids),
    db.from("retention_case").select("id, reinstatement_case_id").eq("tenant_id", viewer.tenantId).in("reinstatement_case_id", ids),
  ]);
  const sentOf = new Map<string, Loose>(((sent.error ? [] : sent.data) ?? []).map((r: Loose) => [r.id, r]));
  const caseOf = new Map<string, string>(((cases.error ? [] : cases.data) ?? []).map((r: Loose) => [r.reinstatement_case_id, r.id]));
  return rows.map((r) => ({
    id: r.id, caseId: caseOf.get(r.id) ?? null, clientName: r.clientName, carrierName: r.carrierName, policyNumber: r.policyNumber,
    type: "reinstatement" as const, status: r.status === "reinstated" ? ("verified_in_file" as const) : ("submitted" as const),
    createdAt: (sentOf.get(r.id)?.created_at as string | undefined) ?? r.lapsedOn, submittedAt: (sentOf.get(r.id)?.submitted_at as string | null | undefined) ?? null,
    expectedEffectiveDate: null, verifiedAt: r.status === "reinstated" ? r.resolvedAt : null, verifiedSnapshotDate: null, checkedSnapshotDate: null, unprovable: false,
  }));
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("payment_repair", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  // AG-0.5 · opening or stepping a request needs its policy credited to a visible producer; the retention
  // role's scope is null (it works the whole book).
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
  const sendDetails = (s: z.infer<typeof send> | null) => (s ? { method: s.method, formRef: s.form_ref, reference: s.reference, expectedEffectiveDate: s.expected_effective_date } : null);
  try {
    if (b.action === "create") {
      const c = b.change;
      const input =
        c.type === "draft_date_change" ? { type: c.type, currentDraftDay: null, targetDraftDay: c.target_draft_day }
        : c.type === "payment_method_change" ? { type: c.type, currentMethod: null, toMethod: c.to_method, accountLast4: c.account_last4 }
        : c.type === "bill_to_draft_conversion" ? { type: c.type, targetDraftDay: c.target_draft_day }
        : { type: c.type, address: c.address, zip: c.zip, state: c.state };
      const created = await createRequest(viewer, {
        carrierId: b.carrier_id, policyNumber: b.policy_number, origin: b.origin, change: input as never, send: sendDetails(b.send), note: b.note,
        fromQueue: b.from_queue ? { outcome: b.from_queue.outcome } : null,
      });
      await audit({ actorType: "tenant", actorId: userId, action: "retention.servicing_requested", targetType: "policy", targetId: `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId, requestId: created.id, type: c.type, origin: b.origin, sent: Boolean(b.send) }, request });
      return NextResponse.json({ ok: true, id: created.id });
    }
    if (b.action === "note") {
      await addRequestNote(viewer, b.id, b.note);
      await audit({ actorType: "tenant", actorId: userId, action: "retention.servicing_noted", targetType: "servicing_request", targetId: b.id, metadata: { tenantId }, request });
      return NextResponse.json({ ok: true });
    }
    await stepRequest(viewer, b.id, b.to, { send: sendDetails(b.send) ?? undefined, reference: b.reference, confirmedOn: b.confirmed_on, note: b.note });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.servicing_stepped", targetType: "servicing_request", targetId: b.id, metadata: { tenantId, to: b.to }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ServicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[servicing]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
