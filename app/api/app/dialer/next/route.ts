import { NextResponse } from "next/server";

import { DialerWorkflowError, emptyQueueReason, serveNextLead } from "@/lib/dialerScripts/service";
import { capacityEmptyReason } from "@/lib/dialerScripts/display";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

/**
 * LA-2.8 · POST /api/app/dialer/next — "Ray presses next and gets exactly one lead."
 *
 * POST rather than GET, because this mutates: `serve_next_lead` claims the work item and locks it
 * for fifteen minutes. A GET that took a lead out of circulation would be prefetchable and
 * retryable by any well-behaved client, and two agents would end up holding the same lead by
 * accident.
 *
 * An empty queue answers 200 with `served: null`. LA-2.8 is explicit that this is a normal state —
 * "This is normal early and late in the day" — and a 404 would make the screen treat a working
 * system as broken.
 */
export async function POST() {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  try {
    const { served, refused, atCapacity } = await serveNextLead({
      tenantId: auth.context.tenantId,
      agentId: auth.context.userId,
    });
    // Leads the queue offered in states this agent may not sell in. They went straight back to the
    // queue for someone who is licensed there, and the screen says why, instead of looking empty.
    const refusedStates = [...new Set(refused.map((item) => item.state).filter((state): state is string => Boolean(state)))];
    const refusal = refused.length
      ? refusedStates.length
        ? `The dialer passed over ${refused.length === 1 ? "a lead" : `${refused.length} leads`} in ${refusedStates.join(", ")}, where you are not licensed; ${refused.length === 1 ? "it is" : "they are"} back in the queue for a licensed agent. ${refused[0].message}`
        : `The dialer passed over ${refused.length === 1 ? "a lead" : `${refused.length} leads`} it could not match to your licences. ${refused[0].message}`
      : null;
    // The copy lives here, not in the component, so every caller of this endpoint explains an empty
    // queue the same way. LA-2.8 asks for the reason rather than a blank panel; LA-2.3 asks the
    // dialer to say when a campaign is held back by its scrub, so the fallback names those
    // campaigns (emptyQueueReason) and is read only when nothing was served.
    const emptyReason = served
      ? null
      : refusal
        // 20260925700000: at the open-lead ceiling the pool is closed to this agent; say so,
        // rather than blaming windows and timers for an empty screen they did not cause.
        ?? (atCapacity ? capacityEmptyReason(atCapacity.open, atCapacity.max) : null)
        ?? (await emptyQueueReason(auth.context.tenantId));
    return NextResponse.json(
      {
        served,
        refused: refused.length,
        emptyReason,
        atCapacity: atCapacity ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof DialerWorkflowError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not serve the next lead" },
      { status },
    );
  }
}
