/**
 * Book of business, round 2 (docs/la4/BUILD-ROUND2.md, Step 3 · Policies): the policy detail page and its
 * Change client page. Pure helpers only, so the server page, the client islands and the source-contract
 * test (policyPage.test.mjs) read one list of tabs, one set of words and one match count.
 *
 * The page is list → detail → tabs: no side panels. An edit happens on its own page (Change client) or on
 * the tab of the thing it changes; a pop-up only confirms (Unlink, Undo).
 */

import { csvCellMinimal } from "../csv/cell.ts";

/** The carrier policy's seven tabs, in the approved order (canvas boards BobPolicy, BobE1, BobE6, BobE6b). */
export const POLICY_TABS = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "History" },
  { key: "client", label: "Client" },
  { key: "pipeline", label: "Pipeline" },
  // Round 5 (board 7): the tab is "Money"; its key stays, so every ?tab=commissions link still lands.
  { key: "commissions", label: "Money" },
  { key: "files", label: "Files" },
  { key: "notes", label: "Notes" },
] as const;
export type PolicyTab = (typeof POLICY_TABS)[number]["key"];

/** A policy entered by hand (tenant_policies) has no carrier file, link or card: only the tabs it can fill. */
export const HAND_POLICY_TABS: readonly PolicyTab[] = ["overview", "commissions"];

/** `?tab=` read safely: anything unknown, or a tab this record doesn't have, is the Overview. */
export function policyTabOf(value: string | string[] | undefined | null, allowed: readonly PolicyTab[] = POLICY_TABS.map((tab) => tab.key)): PolicyTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return allowed.find((key) => key === raw) ?? "overview";
}

export const carrierPolicyHref = (carrierId: string, policyNumber: string, tab?: PolicyTab, extra?: Record<string, string>) => {
  const base = `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}`;
  const query = new URLSearchParams({ ...(tab && tab !== "overview" ? { tab } : {}), ...(extra ?? {}) }).toString();
  return query ? `${base}?${query}` : base;
};
export const changeClientHref = (carrierId: string, policyNumber: string) => `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}/client`;

/** How a link was made (policy_match.method), in the words the Client tab uses. */
export const LINK_METHOD_WORDS: Record<string, string> = {
  policy_number_exact: "By policy number, automatically",
  submission_record: "By the number on the submitted application, automatically",
  human: "By a person",
  ai_review: "Suggested by review, confirmed",
  import: "From your imported book",
  identity_exact: "By name and date of birth, automatically",
  no_match: "No sale found, so a client was made from the carrier's file",
};
export const linkMethodWord = (method: string | null | undefined) => (method ? LINK_METHOD_WORDS[method] ?? method.replaceAll("_", " ") : "Not linked");

/** Who a link points at (policy_match.matched_to_type). */
export const LINK_TARGET_WORDS: Record<string, string> = { application: "an application", deal_flow: "a Daily deal flow sale", contact: "a client", provisional: "a client made from the carrier's file" };

/**
 * Where a card move came from (tenant_lead_stage_events.source), in plain words. A source the pipeline
 * rules add later reads as itself until a word is added here.
 */
export const MOVE_SOURCE_WORDS: Record<string, string> = {
  application_sync: "The application changed",
  board: "Moved by hand on the board",
  table: "Moved by hand in the list",
  list: "Moved by hand in the list",
  lead_detail: "Moved by hand on the lead",
  owner_fix: "Corrected by the owner",
  dialer: "A call outcome",
  inbound: "An inbound call outcome",
  pipeline_rule: "A card-move rule (carrier file)",
};
export const moveSourceWord = (source: string | null | undefined) => (source ? MOVE_SOURCE_WORDS[source] ?? source.replaceAll("_", " ") : "Not recorded");
/** A move a person made: Undo never offers to reverse it (the person's move wins, as the stage sync). */
export const isPersonMove = (source: string | null | undefined) => source === "board" || source === "table" || source === "list" || source === "lead_detail" || source === "owner_fix";

/** One history row (a policy_change, or the first sighting), ready to show and to export. */
export type PolicyHistoryRow = {
  date: string;
  /** policy_change.field_name, or "first_seen" for the row that put the policy in the book. */
  field: string;
  fieldLabel: string;
  from: string | null;
  to: string;
  source: { fileId: string; fileName: string | null; rowNumber: number | null } | null;
  /** What made a change that has no file row: for a card move, who or what moved it ("Pipeline rule", "A person"). */
  note?: string | null;
};

/**
 * The lead's card moves as History rows (owner 2026-11-05, his manager's request: "from which stage it changed to
 * what stage"), beside the carrier's field changes. Field "Card stage"; "Because of" says what moved it and who.
 */
export function cardMoveHistoryRows(moves: ReadonlyArray<{ at: string; from: string | null; to: string; source: string; by: string | null }>): PolicyHistoryRow[] {
  return moves.map((move) => ({
    date: move.at,
    field: "card_stage",
    fieldLabel: "Card stage",
    from: move.from,
    to: move.to,
    source: null,
    note: [moveSourceWord(move.source), move.by].filter(Boolean).join(" · "),
  }));
}

/** History rows from every source, newest first (a stable order for rows of one day). */
export const mergeHistory = (...lists: ReadonlyArray<readonly PolicyHistoryRow[]>) => lists.flat().sort((a, b) => b.date.localeCompare(a.date));

/** The field filter's choices: every field that changed, most changes first, "Every field" first. */
export function historyFields(rows: readonly PolicyHistoryRow[]): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const entry = counts.get(row.field) ?? { label: row.fieldLabel, count: 0 };
    entry.count++;
    counts.set(row.field, entry);
  }
  return [{ key: "", label: "Every field", count: rows.length }, ...[...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label)).map(([key, value]) => ({ key, ...value }))];
}

export const filterHistory = (rows: readonly PolicyHistoryRow[], field: string | null | undefined) => (field ? rows.filter((row) => row.field === field) : [...rows]);

/** The History tab's Export: one CSV row per change, with the file and row that made it. */
export function historyCsv(rows: readonly PolicyHistoryRow[]): string {
  // The one escaper (lib/csv/cell.ts): quotes when needed, and defuses a cell that would run as a formula.
  const header = ["Date", "Field", "From", "To", "File", "Row"];
  return [header, ...rows.map((row) => [row.date, row.fieldLabel, row.from, row.to, row.source?.fileName ?? row.note ?? null, row.source?.rowNumber ?? null])].map((line) => line.map(csvCellMinimal).join(",")).join("\r\n");
}

/** The carrier's side of a person, from the policy's latest snapshot, for the Change client match count. */
export type CarrierPerson = { firstName: string | null; lastName: string | null; dob: string | null; phone: string | null };
/** A client found by the Change client search. */
export type ClientCandidate = { firstName: string | null; lastName: string | null; dob: string | null; phone: string | null; hasSaleWithCarrier: boolean };

const word = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "").slice(-10);

/**
 * "4 of 5": how many of the five facts a client shares with the carrier's row — first name, last name, date
 * of birth, phone, and a sale with this carrier. A fact the carrier didn't send can't match.
 */
export function matchCount(carrier: CarrierPerson, client: ClientCandidate): { matched: number; of: number; facts: string[] } {
  const facts: string[] = [];
  if (word(carrier.firstName) && word(carrier.firstName) === word(client.firstName)) facts.push("first name");
  if (word(carrier.lastName) && word(carrier.lastName) === word(client.lastName)) facts.push("last name");
  if (carrier.dob && client.dob && carrier.dob.slice(0, 10) === client.dob.slice(0, 10)) facts.push("date of birth");
  if (digits(carrier.phone).length === 10 && digits(carrier.phone) === digits(client.phone)) facts.push("phone");
  if (client.hasSaleWithCarrier) facts.push("a sale with this carrier");
  return { matched: facts.length, of: 5, facts };
}

const addDays = (day: string, days: number) => new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const IN_FORCE = new Set(["active", "at_risk", "approved_unpaid"]);

/**
 * The Overview's "next date that matters": while a payment is late, the day the carrier closes it (it can
 * still be saved, or reinstated, until then); while it is in force and paid, the paid-to date, when the next
 * draft is due. Nothing for a policy that is closed for good or not issued.
 */
export function nextDateThatMatters(policy: { status: string | null; paidTo: string | null; daysPastDue: number | null; daysLeft: number | null; asOf: string | null }): { label: string; date: string; detail: string } | null {
  if (policy.daysLeft !== null && policy.daysLeft > 0 && (policy.daysPastDue ?? 0) > 0 && policy.asOf) {
    const lapsed = policy.status === "lapsed";
    return { label: lapsed ? "Can be reinstated until" : "The carrier closes it on", date: addDays(policy.asOf, policy.daysLeft), detail: `${policy.daysLeft} more day${policy.daysLeft === 1 ? "" : "s"}, by the carrier's window in Carrier terms` };
  }
  if (policy.paidTo && IN_FORCE.has(policy.status ?? "") && !(policy.daysPastDue && policy.daysPastDue > 0)) {
    return { label: "Next payment due", date: policy.paidTo.slice(0, 10), detail: "the paid-to date in the carrier's latest file" };
  }
  return null;
}

/** The status chip's tone for a normalized carrier status. */
export function statusTone(status: string | null): "good" | "warning" | "danger" | "neutral" | "info" {
  if (status === "active") return "good";
  if (status === "at_risk" || status === "approved_unpaid") return "warning";
  if (status === "lapsed" || status === "not_taken" || status === "declined") return "danger";
  if (status === "submitted") return "info";
  return "neutral";
}

/** Methods that settle who the client is: a person (or a confirmed review) chose, or step 2 linked by number. */
const SETTLED_METHODS: ReadonlySet<string> = new Set(["human", "ai_review", "submission_record", "policy_number_exact"]);
const SETTLED_TARGETS: ReadonlySet<string> = new Set(["application", "deal_flow", "contact"]);

/**
 * QA 2026-11-03 (0119990010): "Provisional · Check the client" is for a client the carrier's row made that
 * nobody has settled. Once the current link is to a sale, an application or a client, chosen by a person or by
 * step 2, there is nothing to check — even while the stand-in client record still carries its flag.
 */
export function showsProvisional(contactProvisional: boolean | null | undefined, link: { type: string | null; method: string | null } | null | undefined): boolean {
  if (!contactProvisional) return false;
  return !(link?.type && link.method && SETTLED_TARGETS.has(link.type) && SETTLED_METHODS.has(link.method));
}

/** Where a sale came from (tenant_application_cases.source / deal_flow.source), in words. */
const SALE_SOURCE_WORDS: Record<string, string> = { outbound: "an outbound call", inbound: "an inbound call", partner: "a partner's lead", affiliate: "an affiliate's lead", manual: "a sale entered by hand", import: "an imported lead" };

/**
 * "Came from" for a policy linked to a sale with no lead source on record: the sale itself, so the page never
 * says "Lead source not known" for a policy a sale stands behind. Null when there is no sale.
 */
export function saleCameFrom(sale: { source: string | null; date: string | null; agentName: string | null } | null | undefined): string | null {
  if (!sale) return null;
  const source = sale.source ? SALE_SOURCE_WORDS[sale.source] ?? sale.source.replaceAll("_", " ") : null;
  // "Nov 3, 2026", as every other date on the policy page.
  const day = sale.date && /^\d{4}-\d\d-\d\d/.test(sale.date) ? new Date(`${sale.date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  return [`The sale${day ? ` of ${day}` : ""}`, source ? `from ${source}` : null, sale.agentName ? `sold by ${sale.agentName}` : null].filter(Boolean).join(" · ");
}

/**
 * QA 2026-11-03: one plain line when the carrier pays someone other than the person who sold it ("Carrier
 * pays Devin Okafor · sold by Demo Agent"). Compared by user, never by name; null when either is unknown or
 * they are the same person.
 */
export function agentMismatchLine(carrierAgent: { userId: string | null; name: string | null }, seller: { userId: string | null; name: string | null }): string | null {
  if (!carrierAgent.userId || !seller.userId || carrierAgent.userId === seller.userId) return null;
  return `Carrier pays ${carrierAgent.name ?? "another producer"} · sold by ${seller.name ?? "another producer"}`;
}

/** "Why" is kept with the link (policy_match.reasoning holds up to 4,000 characters). */
export const WHY_MAX = 1000;
