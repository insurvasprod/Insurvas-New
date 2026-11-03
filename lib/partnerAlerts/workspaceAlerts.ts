/**
 * What is wrong with a partner's workspace — the partner bar's Alerts, as p-par-overview draws
 * them. Not messages: each is a state, read fresh, that clears when the state changes, and each
 * carries the one action that addresses it.
 *
 * Two sources, both real:
 *
 *   · the organisation's own status. A paused, offboarded or not-yet-active partner cannot submit,
 *     which the context strip already says in a chip; the alert says what to do about it.
 *   · the duplicate rate, for partner admins (the only role that can open Team review). "Rising"
 *     means this week's share of duplicate submissions is above last week's — see the constants.
 *
 * Pure, so the rules are tested; `service.ts` reads the counts.
 */

export type PartnerWorkspaceAlert = {
  id: string;
  title: string;
  body: string;
  link: string;
  actionLabel: string;
  severity: "critical" | "warning";
};

export type PartnerStatus = "draft" | "active" | "paused" | "offboarded";
export type SubmissionCounts = { sent: number; duplicates: number };

/**
 * The thresholds for "duplicate rate rising". Product choices, named so they can be tuned: fewer
 * than ten submissions in a week is too small a sample for a percentage to mean anything, and a
 * rate under 5% is noise however it moved.
 */
export const DUPLICATE_ALERT_MIN_SENT = 10;
export const DUPLICATE_ALERT_MIN_RATE = 5;
export const DUPLICATE_WINDOW_DAYS = 7;

function rate({ sent, duplicates }: SubmissionCounts) {
  return sent > 0 ? (duplicates * 100) / sent : 0;
}

export function duplicateRateAlert(current: SubmissionCounts, previous: SubmissionCounts): PartnerWorkspaceAlert | null {
  if (current.sent < DUPLICATE_ALERT_MIN_SENT) return null;
  const now = rate(current);
  const before = rate(previous);
  if (now < DUPLICATE_ALERT_MIN_RATE || now <= before) return null;
  const nowLabel = Math.round(now);
  const beforeLabel = previous.sent > 0 ? `${Math.round(before)}%` : "none";
  return {
    id: "duplicate-rate",
    title: "Duplicate rate rising",
    body: `${nowLabel}% of what your team sent in the last ${DUPLICATE_WINDOW_DAYS} days was already in the agency’s book, up from ${beforeLabel} the week before.`,
    link: "/partner/team-review",
    actionLabel: "Open team review",
    severity: "warning",
  };
}

export function partnerStatusAlert(status: PartnerStatus): PartnerWorkspaceAlert | null {
  if (status === "active") return null;
  const copy = {
    draft: { title: "Not active yet", body: "Your agency has not activated your organisation, so leads cannot be submitted yet. Ask your agent to finish setting you up." },
    paused: { title: "Submissions paused", body: "Your agency has paused your organisation. New leads are refused until they reactivate it." },
    offboarded: { title: "Submissions closed", body: "Your agency has offboarded your organisation. Leads you already sent stay visible; new ones cannot be sent." },
  }[status];
  return {
    id: `partner-status-${status}`,
    ...copy,
    link: "/partner/messages",
    actionLabel: "Message your agent",
    severity: status === "draft" ? "warning" : "critical",
  };
}

/** Status first — it blocks everything — then the rate. */
export function partnerWorkspaceAlerts(input: {
  status: PartnerStatus;
  isAdmin: boolean;
  current: SubmissionCounts | null;
  previous: SubmissionCounts | null;
}): PartnerWorkspaceAlert[] {
  const alerts: PartnerWorkspaceAlert[] = [];
  const status = partnerStatusAlert(input.status);
  if (status) alerts.push(status);
  if (input.isAdmin && input.current && input.previous) {
    const duplicates = duplicateRateAlert(input.current, input.previous);
    if (duplicates) alerts.push(duplicates);
  }
  return alerts;
}
