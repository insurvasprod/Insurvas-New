import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DialerWorkflowError, attemptWorkItemId, recordDisposition, recordCallbackDisposition } from "@/lib/dialerScripts/service";
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

// The call outcomes this route has always recorded, whatever the tenant's own list holds.
//   do_not_call: complete_existing_dial_disposition already suppresses the number on the agency's
//   internal list and closes the lead (suppress_phone, list "internal"); the dialer never offered it.
//   inbound_return_call: the customer rang back and was found through search; recorded without
//   spending a cadence attempt or touching the queue (the SQL branch exists since 20260917145000).
// Beside these, any ACTIVE outcome in the tenant's dispositions table (user decision 2026-09-24,
// linking the call-outcome walk to the call); see lib/dialerScripts/dialOutcomeKey.ts.
//   wrong_number, disconnected (user decision 2026-09-25): close the lead; one bought from a vendor
//   campaign inside its return window becomes claimable (vendor_claimable_leads reads the attempt).
const BUILT_IN_OUTCOMES = ["no_answer", "voicemail", "busy", "call_dropped", "not_interested", "callback_scheduled", "application_submitted", "do_not_call", "wrong_number", "disconnected", "inbound_return_call"] as const;
const INBOUND_RETURN_CALL = "inbound_return_call";

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
  const builtIn = (BUILT_IN_OUTCOMES as readonly string[]).includes(key);

  // The built-in outcomes or an active tenant outcome; anything else is refused (400).
  let row: DialOutcomeRow = null;
  try {
    row = await loadDialOutcomeRow(auth.context.tenantId, key);
  } catch (error) {
    // A built-in outcome never needed the table, so a failed read does not stall the call loop.
    if (!builtIn) return failure(error, "Could not read this outcome.");
  }
  const decision = decideDialOutcomeKey({ key, builtIn: BUILT_IN_OUTCOMES, row });
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
      if (key === "application_submitted")
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
