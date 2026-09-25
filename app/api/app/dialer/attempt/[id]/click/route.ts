import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DialGateError, markDialClicked } from "@/lib/dialerScripts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const attemptId = (await params).id;
  if (!z.string().uuid().safeParse(attemptId).success) return NextResponse.json({ error: "Choose a valid call attempt" }, { status: 400 });
  try { return NextResponse.json({ attempt: await markDialClicked({ tenantId: auth.context.tenantId, agentId: auth.context.userId, attemptId }) }); }
  catch (error) {
    const status = error instanceof DialGateError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record dial" }, { status });
  }
}
