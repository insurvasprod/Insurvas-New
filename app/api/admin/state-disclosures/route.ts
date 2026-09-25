import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_STATE_DISCLOSURES } from "@/lib/stateDisclosures/permissions";
import { publishStateDisclosureSchema } from "@/lib/stateDisclosures/schemas";
import { coverage, listStateDisclosures, publishStateDisclosure } from "@/lib/stateDisclosures/service";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  try {
    const disclosures = await listStateDisclosures();
    return NextResponse.json({ disclosures, coverage: coverage(disclosures) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load disclosures" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  const parsed = publishStateDisclosureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid disclosure" }, { status: 400 });
  try {
    const published = await publishStateDisclosure(parsed.data);
    await audit({
      actorId: auth.session.sub,
      action: "state_disclosure.published",
      targetType: "state_disclosure",
      // One publish covers many states, so the audit target is the product line and the states are
      // the detail. Auditing only the first row would hide the other fifty.
      targetId: parsed.data.product_code,
      metadata: { productCode: parsed.data.product_code, states: parsed.data.states, effectiveFrom: parsed.data.effective_from, rows: published.length },
      request,
    });
    return NextResponse.json({ disclosures: published }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not publish the disclosure" }, { status: 400 });
  }
}
