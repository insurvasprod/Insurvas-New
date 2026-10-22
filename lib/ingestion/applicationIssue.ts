// Carrier data → the LA-3 application (pure; client-safe).
//
// LA-3.18 (Notion): "Issue is recorded by the agent from the carrier's own notice (and later, by
// Module 4 from carrier data). We never infer an issue." This is the "later": a carrier file that
// lists the policy, linked to its application (LA-4.8), in a status that only an issued policy can
// have, is the carrier's own record that it issued. Nothing is inferred from anything we hold.
//
// Only the issue is recorded this way. A decline, a withdrawal or a not-taken stays the agent's to
// record: it needs a reason (LA-3.7), and the case may go on to another carrier (LA-3.16).

/** LA-4.5 statuses that exist only once the carrier has issued the policy. */
export const ISSUED_BY_CARRIER: ReadonlySet<string> = new Set(["approved_unpaid", "active", "at_risk", "paid_up", "lapsed"]);

/** Application statuses the carrier's issue may close (application_transition: closed/issued). */
export const AWAITING_CARRIER: ReadonlySet<string> = new Set(["submitted", "pending_carrier"]);

export type IssueCandidate = {
  applicationId: string;
  applicationStatus: string;
  statusNormalized: string | null;
  policyNumber: string;
  issueDate: string | null;
  issuedOn: string | null;
  lastSnapshotDate: string;
};

/** Whether this policy's carrier record closes its application as issued, and on what day. */
export function carrierIssue(candidate: IssueCandidate): { issue: boolean; issuedOn: string | null } {
  if (!candidate.statusNormalized || !ISSUED_BY_CARRIER.has(candidate.statusNormalized)) return { issue: false, issuedOn: null };
  if (!AWAITING_CARRIER.has(candidate.applicationStatus)) return { issue: false, issuedOn: null };
  // The carrier's own issue date first, then the day our history saw it issue, then the file's date.
  return { issue: true, issuedOn: candidate.issueDate ?? candidate.issuedOn ?? candidate.lastSnapshotDate };
}
