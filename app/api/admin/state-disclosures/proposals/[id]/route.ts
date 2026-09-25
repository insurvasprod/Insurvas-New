import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { REVIEW_SCHEMA_MISSING } from "@/lib/stateDisclosures/constants";
import { CAN_MANAGE_STATE_DISCLOSURES } from "@/lib/stateDisclosures/permissions";
import { reviewProposal, ReviewRefusedError, ReviewUnavailableError } from "@/lib/stateDisclosures/review";
import { reviewProposalSchema } from "@/lib/stateDisclosures/schemas";

const ACTION = {
  approve: "state_disclosure.proposal_approved",
  reject: "state_disclosure.proposal_rejected",
  cancel: "state_disclosure.proposal_cancelled",
} as const;

/**
 * Decides a pending proposal. `approve` publishes it into state_disclosures in the same transaction
 * (approve_state_disclosure_proposal), and refuses when the approver is the proposer — unless no
 * other active super_admin / platform_config admin exists, in which case a 10–500 character
 * `attestation` is required, stored on the proposal and audited with selfApproved=true. `reject` is
 * the reviewer's no; `cancel` is the proposer withdrawing their own.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "That proposal no longer exists." }, { status: 404 });
  const parsed = reviewProposalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid review" }, { status: 400 });
  if (parsed.data.action === "reject" && !parsed.data.note) {
    return NextResponse.json({ error: "Say why it is rejected, so the author knows what to change." }, { status: 400 });
  }
  try {
    const { proposal, selfApproved } = await reviewProposal(
      id,
      parsed.data.action,
      auth.session.sub,
      parsed.data.note,
      parsed.data.attestation,
    );
    await audit({
      actorId: auth.session.sub,
      action: ACTION[parsed.data.action],
      targetType: "state_disclosure_proposal",
      targetId: proposal.id,
      reason: parsed.data.note || undefined,
      metadata: {
        productCode: proposal.product_code,
        states: proposal.states,
        effectiveFrom: proposal.effective_from,
        proposedBy: proposal.proposed_by,
        publishedIds: proposal.published_ids,
        // The sole-eligible-admin exception: the author approved their own wording, on the record.
        ...(selfApproved ? { selfApproved: true, attestation: proposal.self_approval_attestation ?? parsed.data.attestation } : {}),
      },
      request,
    });
    return NextResponse.json({ proposal });
  } catch (error) {
    if (error instanceof ReviewUnavailableError) return NextResponse.json({ error: REVIEW_SCHEMA_MISSING }, { status: 503 });
    if (error instanceof ReviewRefusedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the proposal" }, { status: 500 });
  }
}
