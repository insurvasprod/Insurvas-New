import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-2.14. The outbound entry point into the verification flow that already exists.
 *
 * There is deliberately no verification logic in this file. `getVerificationPanel` and
 * `updateVerificationField` from `lib/verification/service.ts` are the implementation for both
 * entry points, and the route imports them directly rather than through a wrapper here — a wrapper
 * is where an outbound-specific fork starts, one harmless-looking parameter at a time.
 *
 * What this module owns is the single call that opens the door: create or resume the verification
 * session, open or reuse the application case, and make sure a deal-flow row exists. All three are
 * one RPC because they must succeed or fail together; an application case with no verification
 * session is a lead the agent cannot work and nobody can see is stuck.
 */
export type StartApplicationResult = {
  verificationSessionId: string;
  applicationCaseId: string;
  dealId: string;
  leadId: string;
  source: "inbound" | "outbound" | "manual";
  /** True when a session was already open — the call is a resume, not a start. */
  resumed: boolean;
};

export class OutboundApplicationError extends Error {
  constructor(public code: string, message = code) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  WORK_ITEM_NOT_FOUND: "That lead is no longer in your queue.",
  APPLICATION_OWNER_REQUIRED: "Claim this lead before starting an application.",
  APPLICATION_WORK_ITEM_NOT_CLAIMED: "Claim this lead before starting an application.",
  LEAD_NOT_FOUND: "The lead for this work item could not be found.",
  SETTER_MAY_NOT_TAKE_APPLICATIONS: "Setters book appointments; a licensed agent takes the application.",
};

type Row = {
  verification_session_id: string;
  application_case_id: string;
  deal_id: string;
  lead_id: string;
  source: "inbound" | "outbound" | "manual";
  resumed: boolean;
};

/**
 * "Interested — start application".
 *
 * Idempotent by construction: called again after a dropped call it returns the same verification
 * session, and the collected field values hang off that session id. Resuming is not a second code
 * path that has to be kept in step with starting — it is this call, returning what already exists.
 */
export async function startApplicationFromLead(params: {
  tenantId: string;
  workItemId: string;
  userId: string;
  productLine?: string | null;
}): Promise<StartApplicationResult> {
  const { data, error } = await getSupabaseServiceClient()
    .rpc("start_application_from_lead", {
      p_tenant_id: params.tenantId,
      p_work_item_id: params.workItemId,
      p_agent_user_id: params.userId,
      p_product_line: params.productLine ?? null,
    })
    .returns<Row[]>();

  if (error) {
    const code = Object.keys(MESSAGES).find((known) => error.message?.includes(known));
    if (code) throw new OutboundApplicationError(code, MESSAGES[code]);
    throw new OutboundApplicationError("application_unavailable", error.message ?? "Could not start the application");
  }

  const row = Array.isArray(data) ? data[0] : (data as Row | null);
  if (!row) throw new OutboundApplicationError("application_unavailable", "Could not start the application");

  return {
    verificationSessionId: row.verification_session_id,
    applicationCaseId: row.application_case_id,
    dealId: row.deal_id,
    leadId: row.lead_id,
    source: row.source,
    resumed: row.resumed,
  };
}
