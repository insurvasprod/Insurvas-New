import { STATUS_LABELS, holdRemaining, type DeletionStatus } from "./dataSubject";
import { DATA_SUBJECT_MAP, type SubjectAction } from "./dataSubjectMap";
import { formatPhone } from "./evidenceGaps";

/**
 * What the Deletions list and a request's page both draw (foundation pass 2026-11-03; round 7 2026-11-11,
 * mockups-r7/compliance.html 5·A and 5·1). A plain module, because a server page cannot call a "use client" export.
 */
type ChipTone = "warning" | "danger" | "good" | "neutral";

/** By status: waiting on someone is warning, deleted is good, anything else neutral (r7 chip tones). */
export const DELETION_TONE: Record<DeletionStatus, ChipTone> = { received: "warning", verifying: "warning", verified: "neutral", scheduled: "neutral", completed: "good", rejected: "neutral", cancelled: "neutral" };

/** Not yet deleted, rejected or cancelled: the Open tab. */
export const OPEN_DELETION = new Set(["received", "verifying", "verified", "scheduled"]);

/** Who is to be deleted, as the request names them: "Dana Ruiz · (555) 123-4567 · dana@…". */
export const deletionWho = (r: { requesterName: string | null; phoneDigits: string | null; email: string | null }) =>
  [r.requesterName, r.phoneDigits ? formatPhone(r.phoneDigits) : null, r.email].filter(Boolean).join(" · ") || "A client record";

/** The request's title and the list's first cell: the person's name alone, else the number, else the email. */
export const deletionName = (r: { requesterName: string | null; phoneDigits: string | null; email: string | null }) =>
  r.requesterName?.trim() || (r.phoneDigits ? formatPhone(r.phoneDigits) : null) || r.email || "A client record";

type Row = { status: string; scheduledPurgeAt: string | null };

/** The one chip a request carries: a hold that is over says so (warning, it waits on you); else its status. */
export function deletionChip(r: Row, now: Date): { tone: ChipTone; label: string } {
  if (r.status === "scheduled" && holdRemaining(r.scheduledPurgeAt, now).due) return { tone: "warning", label: "Hold over" };
  return { tone: DELETION_TONE[r.status as DeletionStatus] ?? "neutral", label: STATUS_LABELS[r.status as DeletionStatus] ?? r.status };
}

/** The next step as a short verb (Verify ›, Delete ›, Open ›) and the old sentence for its tooltip. */
export function deletionNext(r: Row, now: Date): { verb: string; sentence: string } {
  if (r.status === "received" || r.status === "verifying") return { verb: "Verify", sentence: "Verify who it is" };
  if (r.status === "scheduled") {
    const hold = holdRemaining(r.scheduledPurgeAt, now);
    return { verb: hold.due ? "Delete" : "Open", sentence: hold.label };
  }
  return { verb: "Open", sentence: r.status === "completed" ? "Certificate issued" : STATUS_LABELS[r.status as DeletionStatus] ?? r.status };
}

export type DeletionQueue = "open" | "ready" | "done" | "all";

/**
 * One tab's requests in the list's order: oldest first, because a request's clock started the day it arrived
 * (r7 5·A). The request page's ‹ › walk the same list.
 */
export function deletionQueue<T extends Row & { receivedAt: string }>(rows: readonly T[], queue: DeletionQueue, now: Date): T[] {
  const due = (r: T) => r.status === "scheduled" && holdRemaining(r.scheduledPurgeAt, now).due;
  return rows
    .filter((r) => queue === "all" || (queue === "open" && OPEN_DELETION.has(r.status)) || (queue === "ready" && due(r)) || (queue === "done" && !OPEN_DELETION.has(r.status)))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

/* ── What we hold: What · Found · What happens · Why (Module 6 §7) ───────── */

const HAPPENS: Record<SubjectAction, string> = { purge: "Deleted", cascade: "Deleted", anonymise: "Anonymised, kept", keep: "Kept" };

/**
 * The places a person's data lives, each read from the purge registry (lib/compliance/dataSubjectMap.ts) by the
 * table that stands for it, so what the page says is what the deletion does. `found` names the preview's count
 * (previewDeletion) where one exists; `why` is said here only when the registry gives no reason.
 */
const HOLD_ROWS: { what: string; table: string; found?: string; why?: string }[] = [
  { what: "Client records", table: "contacts", found: "clients" },
  { what: "Phone numbers and emails", table: "contact_phones", found: "contacts" },
  { what: "Leads", table: "agent_leads", found: "leads" },
  { what: "Call history and notes", table: "tenant_lead_activity", why: "Deleted: this is what they asked for." },
  { what: "Applications", table: "tenant_applications", found: "applications" },
  { what: "Policies and commissions", table: "policy_current", found: "policies" },
  { what: "Carrier statement rows", table: "raw_rows", found: "carrierRows" },
  { what: "Do-not-call entry", table: "tenant_do_not_call" },
  { what: "This deletion's audit trail", table: "deletion_request_event", found: "trail" },
];

export type HoldRow = { what: string; found: number | null; happens: string; why: string };

/**
 * The What we hold table. Before the deletion `preview` gives the counts (null when this person may not see
 * them); after it, `results` (what the deletion reported, per group and table) does.
 */
export function holdRows(input: {
  preview: Record<string, number> | null;
  results?: Record<string, Record<string, { purged?: number; anonymised?: number; kept?: number }>> | null;
  trail: number;
}): HoldRow[] {
  const reported = (table: string) => {
    let total: number | null = null;
    for (const tables of Object.values(input.results ?? {})) {
      const n = tables[table];
      if (n) total = (total ?? 0) + (n.purged ?? 0) + (n.anonymised ?? 0) + (n.kept ?? 0);
    }
    return total;
  };
  return HOLD_ROWS.map((row) => {
    const rule = DATA_SUBJECT_MAP[row.table];
    const found = row.found === "trail" ? input.trail
      : row.found === "contacts" ? (input.preview ? (input.preview.numbers ?? 0) + (input.preview.emails ?? 0) : reported(row.table))
      : row.found && input.preview ? input.preview[row.found] ?? 0
      : reported(row.table);
    const why = rule?.reason ?? row.why ?? (rule && (rule.action === "purge" || rule.action === "cascade") ? "Deleted: this is what they asked for." : "—");
    return { what: row.what, found, happens: rule ? HAPPENS[rule.action] : "—", why };
  });
}
