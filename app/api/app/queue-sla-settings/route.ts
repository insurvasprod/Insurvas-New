import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getQueueSlaSettings, updateQueueSlaSettings } from "@/lib/queueSla/service";
import { getOldestWaitingSeconds, getSlaLastSevenDays, nurtureOnExpiryReady } from "@/lib/queueSla/stats";

/** The database refuses anything past seven days (update_tenant_queue_sla_settings), so the route does too. */
const MAX_SECONDS = 604_800;
const rung = z.number().int();
const schema = z.object({ warn: rung, escalate: rung, partner: rung, expire: rung }).strict();

/** The one sentence that names what is actually wrong with a ladder, in the order a person fixes it. */
function ladderProblem(values: z.infer<typeof schema>): string | null {
  if (Object.values(values).some((value) => value < 1)) return "Every rung needs a time of at least one second.";
  if (Object.values(values).some((value) => value > MAX_SECONDS)) return "Each rung has to fire within 7 days. Expiry can be at most 7 days after a lead becomes claimable.";
  if (!(values.warn < values.escalate && values.escalate < values.partner && values.partner < values.expire))
    return "Use increasing times: warn, escalate, partner notice, then expiry.";
  return null;
}

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  let settings;
  try { settings = await getQueueSlaSettings(auth.context.tenantId); }
  catch (error) { console.error("Queue SLA settings load failed", error); return NextResponse.json({ error: "Queue SLA settings are temporarily unavailable." }, { status: 503 }); }
  // The seven-day figures, the live ladder position and the schema check are read beside the
  // settings, and a failure in any of them must not take the settings down with it: the thresholds
  // stay editable and the card says it could not count.
  const [lastSevenDays, oldestWaitingSeconds, nurtureReady] = await Promise.all([
    getSlaLastSevenDays(auth.context.tenantId, settings.warn_after_seconds).catch((error) => { console.error("Queue SLA seven-day figures failed", error); return null; }),
    getOldestWaitingSeconds(auth.context.tenantId).catch(() => null),
    nurtureOnExpiryReady().catch(() => false),
  ]);
  return NextResponse.json(
    { settings, lastSevenDays, oldestWaitingSeconds, schema: { nurtureOnExpiry: nurtureReady } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send the four rungs as whole seconds." }, { status: 400 });
  const problem = ladderProblem(parsed.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  try { return NextResponse.json({ settings: await updateQueueSlaSettings({ tenantId: auth.context.tenantId, actorId: auth.context.userId, ...parsed.data }) }); }
  catch (error) { const message = error instanceof Error ? error.message : "Could not save queue SLA settings."; return NextResponse.json({ error: message.includes("INVALID_SLA") ? "Use increasing times, each within 7 days: warn, escalate, partner notice, then expiry." : "Could not save queue SLA settings." }, { status: message.includes("ROLE_NOT_ALLOWED") ? 403 : 400 }); }
}
