import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { HANDOFF_TIMEOUT_RANGE, InboundSettingsError, readInboundSettings, updateInboundSettings } from "@/lib/inboundSettings/service";

/**
 * Settings › Inbound transfers: alerts, buffer handoff and who gets the next transfer (the waiting
 * time itself stays on /api/app/queue-sla-settings). The account owner only, on a plan with inbound
 * transfers; update_tenant_inbound_settings checks the owner again and writes the audit row.
 */
const schema = z.object({
  alertNewTransfer: z.boolean(),
  emailOwnersOnEscalation: z.boolean(),
  handoffTimeoutSeconds: z.number().int().min(HANDOFF_TIMEOUT_RANGE.min).max(HANDOFF_TIMEOUT_RANGE.max),
  licensedOnly: z.boolean(),
  skipOnBreak: z.boolean(),
}).strict();

export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await readInboundSettings(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Inbound settings load failed", error);
    return NextResponse.json({ error: "The inbound settings are temporarily unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Send every setting; the handoff wait is ${HANDOFF_TIMEOUT_RANGE.min}–${HANDOFF_TIMEOUT_RANGE.max} seconds.` }, { status: 400 });
  try {
    return NextResponse.json({ settings: await updateInboundSettings({ tenantId: auth.context.tenantId, actorId: auth.context.userId, settings: parsed.data }) });
  } catch (error) {
    if (error instanceof InboundSettingsError) {
      const status = error.code === "role_not_allowed" ? 403 : error.code === "schema_pending" ? 409 : error.code === "invalid" ? 400 : 500;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Inbound settings save failed", error);
    return NextResponse.json({ error: "Could not save the inbound settings." }, { status: 500 });
  }
}
