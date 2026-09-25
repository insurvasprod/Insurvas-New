/**
 * Issued policies recorded on a deal ("Mark issued" / "Mark lapsed"). Plain module: the deal panel
 * (client) and the route (server) both import it, so it must never import anything server-only.
 *
 * The row is tenant_issued_policies — the table the vendor scorecard counts. Nothing wrote it
 * before these actions (20260922190000 measured 0 rows), which is why True CPA was always "—".
 */

export type IssuedPolicyStatus = "issued" | "lapsed" | "cancelled";

export type IssuedPolicy = {
  id: string;
  deal_id: string | null;
  lead_id: string;
  campaign_id: string | null;
  vendor_id: string | null;
  carrier: string;
  policy_number: string | null;
  status: IssuedPolicyStatus;
  issued_at: string;
  /** Null before 20260925708000, and while the policy is in force. */
  lapsed_at: string | null;
  created_at: string;
};

export type IssuedPoliciesResponse = {
  policies: IssuedPolicy[];
  /** False until 20260925708300 is applied: the list reads, but Mark issued / Mark lapsed cannot write. */
  writable: boolean;
  readOnly: boolean;
};

export const ISSUED_POLICY_SCHEMA_PENDING = "This setting needs a database update that has not been applied yet.";

/** What each refusal raised by mark_deal_policy_issued / mark_issued_policy_lapsed means, in words. */
export const ISSUED_POLICY_ERRORS: Record<string, string> = {
  ISSUED_POLICY_CARRIER_REQUIRED: "Enter the carrier that issued the policy.",
  ISSUED_POLICY_NUMBER_REQUIRED: "Enter the policy number.",
  ISSUED_POLICY_DATE_INVALID: "The date cannot be in the future.",
  ISSUED_POLICY_DEAL_NOT_FOUND: "This deal is not in your workspace any more.",
  ISSUED_POLICY_ALREADY_ISSUED: "This deal already has a policy in force. Mark that one lapsed before recording another.",
  ISSUED_POLICY_NOT_FOUND: "That policy is not in your workspace.",
  ISSUED_POLICY_NOT_IN_FORCE: "Only a policy that is in force can be marked lapsed.",
  ISSUED_POLICY_LAPSE_BEFORE_ISSUE: "A policy cannot lapse before the day it was issued.",
  ISSUED_POLICY_ATTRIBUTION_MISMATCH: "This deal's campaign disagrees with the campaign on its application. Fix the lead's attribution before recording the policy.",
};

export function issuedPolicyErrorText(message: string): string | null {
  for (const [code, text] of Object.entries(ISSUED_POLICY_ERRORS)) if (message.includes(code)) return text;
  if (/tenant_issued_policies_tenant_id_carrier_policy_number_key|duplicate key/i.test(message)) return "That carrier already has a policy with this number in your workspace.";
  return null;
}
