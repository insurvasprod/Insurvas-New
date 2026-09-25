import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { isPlaceholderDisclosure, REVIEW_SCHEMA_MISSING } from "@/lib/stateDisclosures/constants";
import { CAN_MANAGE_STATE_DISCLOSURES } from "@/lib/stateDisclosures/permissions";
import { createProposals, listProposalsFor, ReviewUnavailableError } from "@/lib/stateDisclosures/review";
import { proposeStateDisclosureSchema } from "@/lib/stateDisclosures/schemas";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  try {
    // `selfApprovalAllowed` is the server's answer for this admin; the review screen shows the
    // attestation field only when it is true, and never works it out for itself.
    return NextResponse.json(await listProposalsFor(auth.session.sub));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load proposals" }, { status: 500 });
  }
}

/**
 * Proposes a new version of disclosure wording. Nothing reaches the dialer until a different admin
 * approves it (PATCH /proposals/[id]); the wording itself always comes from the admin, never from
 * the product.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  const parsed = proposeStateDisclosureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid proposal" }, { status: 400 });
  if (isPlaceholderDisclosure(parsed.data.required_text)) {
    return NextResponse.json({ error: "Remove the placeholder marker; proposed wording must be the real text." }, { status: 400 });
  }
  try {
    const [proposal] = await createProposals([parsed.data], auth.session.sub, "editor");
    await audit({
      actorId: auth.session.sub,
      action: "state_disclosure.proposed",
      targetType: "state_disclosure_proposal",
      targetId: proposal.id,
      metadata: {
        productCode: proposal.product_code,
        states: proposal.states,
        effectiveFrom: proposal.effective_from,
        characters: proposal.required_text.length,
      },
      request,
    });
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    if (error instanceof ReviewUnavailableError) return NextResponse.json({ error: REVIEW_SCHEMA_MISSING }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not submit the proposal" }, { status: 500 });
  }
}
