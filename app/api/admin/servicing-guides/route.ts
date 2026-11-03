import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { layoutAdmin } from "@/lib/ingestion/layoutAdminHttp";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CARRIER_METHODS, REQUEST_TYPES } from "@/lib/retention/servicing";
import { saveGuide, ServicingError } from "@/lib/retention/servicingStore";

/**
 * LA-5.4 (Notion sprint) · how each carrier takes each kind of servicing change — portal, phone,
 * signed form or email; where; what they ask for; whether the client must authorise. Platform
 * content, edited here without a deploy (carrier-library access, as the portal guidance). Blank clears it.
 */
const text = (max: number) => z.string().max(max).nullable();
const body = z.object({
  carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
  request_type: z.enum(REQUEST_TYPES),
  method: z.enum(CARRIER_METHODS).nullable(),
  where_to_do_it: text(1000),
  what_they_need: text(1000),
  client_must_authorise: z.boolean().nullable(),
  form_ref: text(200),
  notes: text(2000),
}).strict();

export async function POST(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the instructions and try again." }, { status: 400 });
  const b = parsed.data;
  try {
    const done = await saveGuide(scope.adminId, b.carrier_id, b.request_type, { method: b.method, whereToDoIt: b.where_to_do_it, whatTheyNeed: b.what_they_need, clientMustAuthorise: b.client_must_authorise, formRef: b.form_ref, notes: b.notes });
    await audit({ actorType: "admin", actorId: scope.adminId, action: "carrier_servicing_guide.saved", targetType: "carrier", targetId: b.carrier_id, metadata: { requestType: b.request_type, result: done }, request });
    return NextResponse.json({ ok: true, result: done });
  } catch (error) {
    if (error instanceof ServicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[servicing-guides]", error);
    return NextResponse.json({ error: "The instructions could not be saved." }, { status: 500 });
  }
}
