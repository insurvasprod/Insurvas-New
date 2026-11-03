import { leadIdFromAlertLink } from "./presentation.ts";

/**
 * The alert centre: every workspace alert of the last week, open ones first, and what resolved the
 * rest.
 *
 * The bar's alerts panel shows only what is live, which is right for a glance and wrong for "what
 * happened to the escalation I saw this morning". This answers that from the same two sources the
 * feed resolves against — the alert rows in `agent_notifications`, and the lead's latest row in
 * `lead_queue` — so the centre and the badge can never disagree about what is open.
 *
 * Pure, so the rules are tested; `service.ts` reads the rows.
 */

/** The notification kinds that are about the workspace (see WORKSPACE_ALERT_EVENTS). */
export const WORKSPACE_ALERT_KINDS = ["unclaimed_sla_escalation", "new_unclaimed_lead"] as const;
export const ALERT_CENTRE_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type CentreNotificationRow = { id: string; kind: string; title: string; body: string; link: string; created_at: string };
export type CentreQueueRow = { id: string; lead_id: string; status: string; claimed_by: string | null; claimed_at: string | null; queued_at: string };

export type CentreEntry = {
  leadId: string;
  /** The queue item a claim acts on, when the lead is still in the queue. */
  workItemId: string | null;
  title: string;
  body: string;
  link: string;
  severity: "critical" | "warning";
  raisedAt: string;
  state: "open" | "resolved";
  /** What resolved it, in words, for resolved entries. */
  resolution: string | null;
  resolvedAt: string | null;
};

const SEVERITY_RANK: Record<string, number> = { unclaimed_sla_escalation: 0, new_unclaimed_lead: 1 };

function resolutionFor(queue: CentreQueueRow | undefined, names: ReadonlyMap<string, string>): string {
  if (!queue) return "No longer in the queue";
  const who = queue.claimed_by ? names.get(queue.claimed_by) ?? "a teammate" : null;
  switch (queue.status) {
    case "claimed":
    case "buffer_active":
    case "handed_pending":
    case "la_active":
      return who ? `Claimed by ${who}` : "Claimed";
    case "completed":
      return who ? `Worked and completed by ${who}` : "Worked and completed";
    case "expired":
      return "Expired before anybody claimed it";
    case "closed":
    case "dropped":
      return "Closed without a claim";
    default:
      return "No longer waiting for a claim";
  }
}

/**
 * One entry per lead: a lead escalated after it was first announced is one problem, not two, and
 * it takes the more severe of its rows. Rows whose link names no lead are left out — the centre
 * cannot say whether they are resolved, and guessing is what it exists to avoid.
 */
export function buildAlertCentre(
  rows: CentreNotificationRow[],
  queueRows: CentreQueueRow[],
  names: ReadonlyMap<string, string>,
): { open: CentreEntry[]; resolved: CentreEntry[] } {
  const latestQueue = new Map<string, CentreQueueRow>();
  for (const row of [...queueRows].sort((a, b) => b.queued_at.localeCompare(a.queued_at))) {
    if (!latestQueue.has(row.lead_id)) latestQueue.set(row.lead_id, row);
  }

  const byLead = new Map<string, { head: CentreNotificationRow; raisedAt: string }>();
  for (const row of rows) {
    if (!(row.kind in SEVERITY_RANK)) continue;
    const leadId = leadIdFromAlertLink(row.link);
    if (!leadId) continue;
    const current = byLead.get(leadId);
    if (!current) { byLead.set(leadId, { head: row, raisedAt: row.created_at }); continue; }
    const moreSevere = SEVERITY_RANK[row.kind] < SEVERITY_RANK[current.head.kind];
    const sameAndNewer = SEVERITY_RANK[row.kind] === SEVERITY_RANK[current.head.kind] && row.created_at > current.head.created_at;
    byLead.set(leadId, {
      head: moreSevere || sameAndNewer ? row : current.head,
      raisedAt: row.created_at < current.raisedAt ? row.created_at : current.raisedAt,
    });
  }

  const open: CentreEntry[] = [];
  const resolved: CentreEntry[] = [];
  for (const [leadId, { head, raisedAt }] of byLead) {
    const queue = latestQueue.get(leadId);
    const isOpen = queue?.status === "unclaimed";
    const entry: CentreEntry = {
      leadId,
      workItemId: queue?.id ?? null,
      title: head.title,
      body: head.body,
      link: head.link,
      severity: head.kind === "unclaimed_sla_escalation" ? "critical" : "warning",
      raisedAt,
      state: isOpen ? "open" : "resolved",
      resolution: isOpen ? null : resolutionFor(queue, names),
      resolvedAt: isOpen ? null : queue?.claimed_at ?? null,
    };
    (isOpen ? open : resolved).push(entry);
  }

  // Open: most severe first, then whatever has waited longest. Resolved: most recently settled.
  open.sort((a, b) => (a.severity === b.severity ? a.raisedAt.localeCompare(b.raisedAt) : a.severity === "critical" ? -1 : 1));
  resolved.sort((a, b) => (b.resolvedAt ?? b.raisedAt).localeCompare(a.resolvedAt ?? a.raisedAt));
  return { open, resolved };
}
