import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { isPlaceholderDisclosure, REVIEW_SCHEMA_MISSING } from "@/lib/stateDisclosures/constants";
import { CAN_MANAGE_STATE_DISCLOSURES } from "@/lib/stateDisclosures/permissions";
import { createProposals, ReviewUnavailableError } from "@/lib/stateDisclosures/review";
import { importPackSchema } from "@/lib/stateDisclosures/schemas";

/**
 * Imports a disclosure pack (a CSV the browser has already parsed and grouped) as proposals. Every
 * version in the pack waits for a second admin like any other proposal — a bulk import is exactly
 * the change that most needs review — and the whole pack lands in one insert or not at all.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  const parsed = importPackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid pack" }, { status: 400 });
  if (parsed.data.proposals.some((proposal) => isPlaceholderDisclosure(proposal.required_text))) {
    return NextResponse.json({ error: "The pack still carries placeholder wording." }, { status: 400 });
  }
  try {
    const proposals = await createProposals(parsed.data.proposals, auth.session.sub, "import");
    await audit({
      actorId: auth.session.sub,
      action: "state_disclosure.pack_imported",
      targetType: "state_disclosure_proposal",
      targetId: proposals[0]?.id,
      metadata: {
        fileName: parsed.data.file_name ?? null,
        proposals: proposals.map((proposal) => ({
          id: proposal.id,
          productCode: proposal.product_code,
          states: proposal.states,
          effectiveFrom: proposal.effective_from,
        })),
        pairs: proposals.reduce((sum, proposal) => sum + proposal.states.length, 0),
      },
      request,
    });
    return NextResponse.json({ proposals }, { status: 201 });
  } catch (error) {
    if (error instanceof ReviewUnavailableError) return NextResponse.json({ error: REVIEW_SCHEMA_MISSING }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import the pack" }, { status: 500 });
  }
}
