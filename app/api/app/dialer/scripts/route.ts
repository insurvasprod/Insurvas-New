import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { saveScript } from "@/lib/dialerScripts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

// Publishing scripts is agency-wide: every agent reads the new version on their next lead. A setter
// works the queue and reads scripts; writing them for the whole agency is an owner's or producer's
// call (user decision 2026-09-24). The gate above stays DIALER_ROLES so the dialer's route guard
// test keeps one role list for the whole surface; this is the narrower check for the write.
const AUTHOR_ROLES: readonly string[] = ["owner", "producer"];

const schema = z.object({ campaign_id: z.string().uuid().nullable().optional(), product_code: z.string().min(1).max(80), sections: z.object({ opening: z.string(), qualifying_questions: z.string(), transition_to_quote: z.string(), close: z.string() }).strict() }).strict();

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  if (!AUTHOR_ROLES.includes(auth.context.role)) return NextResponse.json({ error: "Only owners and producers can publish scripts.", code: "role_not_allowed" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Opening, qualifying questions, transition to quote and close are required" }, { status: 400 });
  try { return NextResponse.json({ script: await saveScript({ tenantId: auth.context.tenantId, userId: auth.context.userId, campaignId: parsed.data.campaign_id, productCode: parsed.data.product_code, sections: parsed.data.sections }) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save script" }, { status: 400 }); }
}
