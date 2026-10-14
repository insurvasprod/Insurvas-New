import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CONTACT_OUTCOMES, PAYMENT_METHODS } from "@/lib/retention/constants";
import { CARRIER_METHODS, ORIGINS } from "@/lib/retention/servicing";
import { createRequest, loadPrefill, ServicingError, stepRequest } from "@/lib/retention/servicingStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.4 (Notion sprint) · servicing requests. GET: what a new request starts from (the draft day the
 * radar knows, LA-3.9's recommended day and its reason, the carrier's instructions). POST: open a
 * request — from the save queue it is logged as the card's worked call and linked — or take a step a
 * person can take. Verified and failed are the carrier file's alone; nothing here can set them.
 *
 * Gated on `payment_repair`; owner and producer (a producer reaches the policies credited to them).
 */
const ROLES = ["owner", "producer"] as const;
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
]);

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("payment_repair", ROLES);
  if (auth instanceof NextResponse) return auth;
  const carrierId = request.nextUrl.searchParams.get("carrier_id") ?? "";
  const policyNumber = request.nextUrl.searchParams.get("policy_number") ?? "";
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) return NextResponse.json({ error: "Choose the policy." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    return NextResponse.json(await loadPrefill({ tenantId, userId, role }, carrierId, policyNumber));
  } catch (error) {
    if (error instanceof ServicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[servicing] prefill:", error);
    return NextResponse.json({ error: "The policy could not be read" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("payment_repair", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
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
    await stepRequest(viewer, b.id, b.to, { send: sendDetails(b.send) ?? undefined, reference: b.reference, confirmedOn: b.confirmed_on, note: b.note });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.servicing_stepped", targetType: "servicing_request", targetId: b.id, metadata: { tenantId, to: b.to }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ServicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[servicing]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
