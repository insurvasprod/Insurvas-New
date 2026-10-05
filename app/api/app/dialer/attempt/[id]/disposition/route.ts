import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DialerWorkflowError, attemptWorkItemId, loadDialerVocabulary, recordDisposition, recordCallbackDisposition } from "@/lib/dialerScripts/service";
import { APPLICATION_OUTCOME, fallbackOutcomeKeys, INBOUND_RETURN_CALL } from "@/lib/dialerScripts/outcomes";
import { callModeWorkItem, getCallModeWizard, linkWalkToAttempt, loadDialOutcomeRow } from "@/lib/dialerScripts/callOutcome";
import { DIAL_OUTCOME_KEY_PATTERN, decideDialOutcomeKey, setterMayRecord, type DialOutcomeRow } from "@/lib/dialerScripts/dialOutcomeKey";
import { applicationOutcomeFor, assertApplicationOutcomeVerified } from "@/lib/dispositions/applicationGate";
import { answerDisposition, DispositionError } from "@/lib/dispositions/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

// The outcomes this route records are the tenant's own (M1 LA-1.12-4, one vocabulary): any ACTIVE
// row in its dispositions table (lib/dialerScripts/dialOutcomeKey.ts). Since 20260929200000 the
// dialer's outcomes are seeded there too — no answer, voicemail, busy, wrong number, disconnected and
// the inbound return call — with the effects they always had, so archiving or retiming one in
// Settings › Dispositions is what the dialer does. Until that migration is applied (no row carries a
// dialer position) the pre-migration keys in lib/dialerScripts/outcomes.ts are still accepted.
//   do_not_call: complete_existing_dial_disposition suppresses the number on the internal list.
//   inbound_return_call: recorded without spending a cadence attempt (decision 1).
//   wrong_number, disconnected: close the lead; one inside its vendor return window becomes claimable.

const recordSchema = z
  .object({
    disposition: z.string().regex(DIAL_OUTCOME_KEY_PATTERN, "Choose a valid disposition"),
    // Only meaningful for `callback_scheduled`, and required for it — see below. Local wall-clock
    // time in the CUSTOMER's timezone, not the agent's: "Tuesday at 2pm" means the customer's 2pm,
    // and converting it here rather than in the browser keeps one reading of that sentence.
    callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a date and time like 2026-09-24T14:00").optional(),
    customer_timezone: z.string().trim().min(1).max(64).optional(),
    callback_note: z.string().trim().max(1000).optional(),
    assigned_to: z.string().uuid().optional(),
    // Call mode of the outcome dialog: the walk whose answers are stored with this attempt.
    walk_id: z.string().uuid().optional(),
  })
  .strict();

// Call mode's answers to the walk's questions, on the dialer's own guard (outbound dialing, no
// inbound-transfers entitlement needed). Owners and producers: a setter keeps the flat buttons.
const answerSchema = z
  .object({
    action: z.literal("answer"),
    walk_id: z.string().uuid(),
    node_id: z.string().uuid(),
    sequence: z.number().int().min(0).max(100),
    answer: z.unknown().optional(),
    option_key: z.string().max(80).optional(),
  })
  .strict();

function dispositionStatus(error: DispositionError) {
  if (error.code === "owner_required") return 403;
  if (["work_item_not_found", "walk_not_found", "flow_not_found", "node_not_found", "option_not_found", "lead_not_found"].includes(error.code)) return 404;
  if (["walk_incomplete", "flow_changed"].includes(error.code)) return 409;
  if (["invalid_input", "option_required"].includes(error.code)) return 400;
  return 500;
}

function failure(error: unknown, fallback: string) {
  if (error instanceof DispositionError) return NextResponse.json({ error: error.message, code: error.code }, { status: dispositionStatus(error) });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: error instanceof DialerWorkflowError ? error.status : 500 });
}

/** Call mode: the walk definition, its answers so far, and the outcomes the DIALER can record. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const attemptId = (await params).id;
  if (!z.string().uuid().safeParse(attemptId).success) return NextResponse.json({ error: "Choose a valid call attempt" }, { status: 400 });
  try {
    return NextResponse.json(await getCallModeWizard({ tenantId: auth.context.tenantId, userId: auth.context.userId, attemptId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Could not load the call outcome.");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const attemptId = (await params).id;
  if (!z.string().uuid().safeParse(attemptId).success) return NextResponse.json({ error: "Choose a valid call attempt" }, { status: 400 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;

  if (body?.action === "answer") {
    if (auth.context.role === "setter") return NextResponse.json({ error: "Setters record the call's result with the outcome buttons.", code: "setter_uses_buttons" }, { status: 403 });
    const answer = answerSchema.safeParse(body);
    if (!answer.success) return NextResponse.json({ error: "Choose a valid answer." }, { status: 400 });
    try {
      const workItemId = await callModeWorkItem({ tenantId: auth.context.tenantId, userId: auth.context.userId, attemptId });
      const result = await answerDisposition(auth.context.tenantId, auth.context.userId, { work_item_id: workItemId, walk_id: answer.data.walk_id, node_id: answer.data.node_id, sequence: answer.data.sequence, answer: answer.data.answer, option_key: answer.data.option_key });
      return NextResponse.json({ result, wizard: await getCallModeWizard({ tenantId: auth.context.tenantId, userId: auth.context.userId, attemptId }) });
    } catch (error) {
      return failure(error, "Could not save this answer.");
    }
  }

  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid disposition" }, { status: 400 });
  const key = parsed.data.disposition;
  // Before 20260929200000 only: the pre-migration keys, accepted without a tenant row.
  const vocabulary = await loadDialerVocabulary(auth.context.tenantId);
  const fallbackKeys = fallbackOutcomeKeys(vocabulary);
  const builtIn = fallbackKeys.includes(key);

  // The built-in outcomes or an active tenant outcome; anything else is refused (400).
  let row: DialOutcomeRow = null;
  try {
    row = await loadDialOutcomeRow(auth.context.tenantId, key);
  } catch (error) {
    // A built-in outcome never needed the table, so a failed read does not stall the call loop.
    if (!builtIn) return failure(error, "Could not read this outcome.");
  }
  const decision = decideDialOutcomeKey({ key, builtIn: fallbackKeys, row });
  if (!decision.ok) return NextResponse.json({ error: decision.error, code: decision.code }, { status: decision.status });

  // LA-2.12: a setter books and never sells, so an application is not theirs to record — the
  // built-in one by name, and any outcome the tenant's configuration makes an application, by the
  // same test the verification gate below uses. The screen does not offer them; this is the refusal
  // for anything else that calls the API.
  if (auth.context.role === "setter") {
    const isApplication = key === INBOUND_RETURN_CALL ? false : await applicationOutcomeFor(auth.context.tenantId, key).then((outcome) => Boolean(outcome), () => null);
    if (!setterMayRecord({ role: auth.context.role, key, isApplication }))
      return NextResponse.json({ error: "Setters book appointments; an application is recorded by the licensed agent who takes it.", code: "setter_may_not_sell" }, { status: 403 });
  }

  // User decision (2026-09-24): an application outcome is refused until verification is 100%
  // complete — by the SAME check the inbound wizard's route runs (assertApplicationOutcomeVerified),
  // against the attempt's work item, whose verification session that check reads. Which outcomes
  // are applications is the tenant's configuration (mapped stage + flags), not this key, so every
  // outcome is asked; the inbound return call has no work item and nothing to verify.
  let workItemId: string | null = null;
  if (key !== INBOUND_RETURN_CALL) {
    try {
      workItemId = await attemptWorkItemId({ tenantId: auth.context.tenantId, agentId: auth.context.userId, attemptId });
      if (workItemId) await assertApplicationOutcomeVerified(auth.context.tenantId, workItemId, key);
    } catch (error) {
      if (error instanceof DispositionError && error.code === "verification_incomplete")
        return NextResponse.json({ error: error.message, code: "verification_incomplete" }, { status: 409 });
      // The gate could not be read. The application itself fails closed; every other outcome is
      // recorded as it was before the gate existed, so a failed read never stalls the call loop.
      if (key === APPLICATION_OUTCOME)
        return NextResponse.json({ error: "Verification could not be checked, so the application was not recorded. Try again in a moment.", code: "verification_unavailable" }, { status: 503 });
      console.error(`[dialer] application gate unavailable: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // Call mode: store the walked path with this attempt once the outcome is in.
  const link = async () => (parsed.data.walk_id && workItemId
    ? linkWalkToAttempt({ tenantId: auth.context.tenantId, userId: auth.context.userId, attemptId, workItemId, walkId: parsed.data.walk_id, disposition: key, request })
    : false);

  try {
    // `callback_scheduled` without a time used to be accepted, set the lead to `working`, complete
    // the work item — and create no callback at all. The lead then matched no serving tier and had
    // no row on the Callbacks screen, so it was on no queue, no board and no screen, while the call
    // history displayed "Callback scheduled". Refused now, because a promise to ring someone back
    // that nothing records is worse than a button that will not submit. It is the only key that
    // books a time (decideDialOutcomeKey refuses any other outcome configured as a callback).
    if (decision.path === "callback") {
      if (!parsed.data.callback_local || !parsed.data.customer_timezone)
        return NextResponse.json(
          { error: "Choose when to call back, in the customer's own timezone. A callback with no time is not scheduled anywhere.", code: "callback_time_required" },
          { status: 400 },
        );
      const attempt = await recordCallbackDisposition({
        tenantId: auth.context.tenantId,
        agentId: auth.context.userId,
        attemptId,
        callbackLocal: parsed.data.callback_local,
        customerTimezone: parsed.data.customer_timezone,
        callbackNote: parsed.data.callback_note ?? null,
        assignedTo: parsed.data.assigned_to ?? null,
        // Scoped to the attempt, so a retried submit returns the callback already booked instead
        // of spending a second attempt on the lead's cadence.
        idempotencyKey: `dial:${attemptId}:callback`,
      });
      return NextResponse.json({ attempt, walkLinked: await link() });
    }

    const attempt = await recordDisposition({ tenantId: auth.context.tenantId, agentId: auth.context.userId, attemptId, disposition: key });
    return NextResponse.json({ attempt, walkLinked: await link() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record disposition" }, { status: error instanceof DialerWorkflowError ? error.status : 400 });
  }
}
