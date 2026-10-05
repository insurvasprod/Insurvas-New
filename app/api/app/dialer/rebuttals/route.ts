import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { saveRebuttal } from "@/lib/dialerScripts/service";
import { REBUTTAL_OBJECTIONS } from "@/lib/dialerScripts/rebuttals";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

// Publishing rebuttals is agency-wide: every agent reads the new version on their next lead. A setter
// works the queue and reads rebuttals; writing them for the whole agency is an owner's or producer's
// call (user decision 2026-09-24). The gate above stays DIALER_ROLES so the dialer's route guard
// test keeps one role list for the whole surface; this is the narrower check for the write.
const AUTHOR_ROLES: readonly string[] = ["owner", "producer"];

const schema = z.object({ objection_key: z.enum(REBUTTAL_OBJECTIONS), label: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000), sort_order: z.number().int().min(0).max(1000).default(0) }).strict();

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  if (!AUTHOR_ROLES.includes(auth.context.role)) return NextResponse.json({ error: "Only owners and producers can publish rebuttals.", code: "role_not_allowed" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Objection, label and response are required" }, { status: 400 });
  try { return NextResponse.json({ rebuttal: await saveRebuttal({ tenantId: auth.context.tenantId, objectionKey: parsed.data.objection_key, label: parsed.data.label, body: parsed.data.body, sortOrder: parsed.data.sort_order }) }, { status: 201 }); }
  catch (error) {
    // need_to_think / talk_to_spouse arrive with 20260929200100; before it the old check refuses them.
    if (error instanceof Error && /tenant_rebuttals_objection_key_check/.test(error.message)) return NextResponse.json({ error: SCHEMA_PENDING_MESSAGE, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save rebuttal" }, { status: 400 });
  }
}
