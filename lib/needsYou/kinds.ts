/**
 * Book of business › Needs you (owner 2026-11-02, round 2): every decision a person must make, as one list of
 * items with one shape, and one item page for every kind. This file is the vocabulary — the kinds, their words,
 * where each comes from, how the list is cut into views and chips, and how an item's address is written. The
 * reads are lib/needsYou/store.ts; each kind's decision goes to the resolution API its own screen already uses.
 *
 *   kind                  source                                              decided through
 *   pick-client           policy_match_review (open)                          POST /api/app/policy-matching   resolve
 *   no-sale               queue_item no_deal_flow                             POST /api/app/exceptions        resolve
 *   no-carrier            queue_item no_policy                                POST /api/app/exceptions        resolve
 *   same-person           queue_item multi_policy                             POST /api/app/exceptions        resolve
 *   existing-book         queue_item initial_import                           POST /api/app/exceptions        resolve
 *   commission-no-policy  queue_item orphan_commission                        POST /api/app/exceptions        resolve
 *   money                 commission_discrepancy (open, disputed)             POST /api/app/commission-discrepancies
 *   credit                agency_attribution_item (open)                      POST /api/app/agency/attribution
 *   agent                 policy_current rows whose agent code maps to nobody POST /api/app/policy-matching   map_agent
 *   status-word           unmapped_status_queue (not resolved)                nothing here: Insurvas maps the word
 *   rules                 pipeline_rule_hold (live, open): two rules disagree POST /api/app/pipeline-rules  resolve_hold
 *   file                  file_registry failed (not superseded): LA-4.9's    the file page: Read again, or upload a
 *                         file_failed queue, read straight from the file      corrected copy (it then supersedes)
 *
 * Pure; relative imports only (lib/needsYou/needsYou.test.mjs runs it under node).
 */

export const NEEDS_YOU_KINDS = ["pick-client", "no-sale", "no-carrier", "same-person", "existing-book", "commission-no-policy", "money", "credit", "agent", "status-word", "rules", "file"] as const;
export type NeedsYouKind = (typeof NEEDS_YOU_KINDS)[number];

/** The chip groups over the list, in the mockup's order. */
export const NEEDS_YOU_GROUPS = ["clients", "sales", "money", "credit", "rules", "files"] as const;
export type NeedsYouGroup = (typeof NEEDS_YOU_GROUPS)[number];
export const GROUP_LABELS: Record<NeedsYouGroup, string> = { clients: "Clients", sales: "Sales", money: "Money", credit: "Credit", rules: "Rules", files: "Files" };

export type NeedsYouTone = "neutral" | "warning" | "danger" | "info";

export type KindMeta = {
  /** The chip on the row and on the item page. */
  label: string;
  tone: NeedsYouTone;
  group: NeedsYouGroup;
  /** Only the owner and bookkeepers see it (the source's own screen is theirs). */
  keeperOnly: boolean;
  /** The primary button on the item page: "<verb> and open the next". */
  verb: string;
  /** Where the source lives, for the line under the title. */
  source: string;
};

export const KIND_META: Record<NeedsYouKind, KindMeta> = {
  "pick-client": { label: "Pick the client", tone: "warning", group: "clients", keeperOnly: true, verb: "Link", source: "Policy matching" },
  "no-sale": { label: "Policy with no sale", tone: "warning", group: "clients", keeperOnly: false, verb: "Save", source: "Exceptions" },
  "no-carrier": { label: "Sale no carrier has", tone: "danger", group: "sales", keeperOnly: false, verb: "Save", source: "Exceptions" },
  "same-person": { label: "Same person?", tone: "neutral", group: "clients", keeperOnly: false, verb: "Save", source: "Exceptions" },
  "existing-book": { label: "Existing book to look over", tone: "neutral", group: "files", keeperOnly: false, verb: "Mark looked over", source: "Exceptions" },
  "commission-no-policy": { label: "Commission, no policy", tone: "warning", group: "money", keeperOnly: false, verb: "Save", source: "Exceptions" },
  money: { label: "Money doesn’t match", tone: "danger", group: "money", keeperOnly: true, verb: "Save", source: "Discrepancies" },
  credit: { label: "Who gets the credit", tone: "neutral", group: "credit", keeperOnly: true, verb: "Give the credit", source: "Attribution" },
  agent: { label: "Who’s the agent", tone: "neutral", group: "credit", keeperOnly: true, verb: "Map the code", source: "Policy matching › Agent codes" },
  "status-word": { label: "Status word", tone: "neutral", group: "files", keeperOnly: true, verb: "Open the next", source: "Waiting on Insurvas" },
  rules: { label: "Two rules disagree", tone: "warning", group: "rules", keeperOnly: true, verb: "Move the card", source: "Pipeline rules" },
  // LA-4.9's file_failed queue (owner: operations, i.e. the owner and bookkeepers, who receive carrier files).
  file: { label: "File didn’t read", tone: "danger", group: "files", keeperOnly: true, verb: "Open the next", source: "Files" },
};

/** The exception queues' types, as Needs you kinds (lib/ingestion/exceptionQueues.ts QUEUE_TYPES). */
export const QUEUE_KIND = {
  no_deal_flow: "no-sale",
  no_policy: "no-carrier",
  multi_policy: "same-person",
  initial_import: "existing-book",
  orphan_commission: "commission-no-policy",
} as const satisfies Record<string, NeedsYouKind>;
export type QueueKind = (typeof QUEUE_KIND)[keyof typeof QUEUE_KIND];
export const isQueueKind = (kind: string): kind is QueueKind => (Object.values(QUEUE_KIND) as string[]).includes(kind);

export const isNeedsYouKind = (value: string): value is NeedsYouKind => (NEEDS_YOU_KINDS as readonly string[]).includes(value);

/** One open (or recently closed) decision, whatever its source. */
export type NeedsYouItem = {
  kind: NeedsYouKind;
  id: string;
  /** What it is about: a policy, a sale, a client, an amount. */
  about: string;
  /** Why it waits, in plain words. */
  why: string;
  /** Who owns it: a person's name, "Owner or bookkeeper", "Insurvas". */
  who: string;
  /** The person it is assigned to, when the source assigns to a person (queue items). */
  ownerUserId: string | null;
  /** The day its clock started (yyyy-mm-dd). */
  since: string;
  ageDays: number;
  href: string;
  tone: NeedsYouTone;
  /** Closed items: how it ended, and when. */
  closedAs?: string | null;
  closedAt?: string | null;
  /** A queue item a person escalated (queue_item.escalated_at): a chip beside its owner. */
  escalated?: boolean;
  /** What ties it to a carrier file (Files › "Open all in Needs you" filters by these). */
  ref?: { carrierId?: string | null; policyNumber?: string | null; fileId?: string | null; fileDate?: string | null; agentCode?: string | null; word?: string | null };
};

/**
 * What one carrier file touched, as its own page counts it (lib/ingestion/fileOutcomeStore.ts): its id (its
 * match reviews, its attribution items, its existing-book item), the file date its "policy with no sale" items
 * carry (null when this file isn't the one they are tied to: ROW_QUEUE_TYPE), the policies its snapshots list
 * (carrier|policy) and its commission lines list, the agent codes on them (carrier|code), and the status words
 * it was held on.
 */
export type FileFilter = {
  fileId: string;
  name: string;
  carrierId: string | null;
  rowItemsDate: string | null;
  policies: ReadonlySet<string>;
  commissionPolicies: ReadonlySet<string>;
  codes: ReadonlySet<string>;
  words: ReadonlySet<string>;
};

/**
 * Whether an item came from that file, by the file page's rule: a review of that file; a "policy with no sale"
 * item tied by carrier and file date (never by policy number alone, which would hand it to every daily file);
 * a status word it was held on; an agent code or commission line it carries. "Same person?" (a client) and
 * "Sale no carrier has" (a sale with no carrier policy at all) never belong to a file.
 */
export function fromFile(item: Pick<NeedsYouItem, "kind" | "ref">, file: FileFilter): boolean {
  const ref = item.ref;
  if (!ref) return false;
  const policy = ref.carrierId && ref.policyNumber ? `${ref.carrierId}|${ref.policyNumber}` : null;
  switch (item.kind) {
    case "same-person":
    case "no-carrier":
      return false;
    case "pick-client":
    case "existing-book":
    case "credit":
      return Boolean(ref.fileId && ref.fileId === file.fileId);
    case "no-sale":
      return Boolean(file.rowItemsDate && ref.carrierId && ref.carrierId === file.carrierId && ref.fileDate === file.rowItemsDate);
    case "status-word":
      return Boolean((ref.fileId && ref.fileId === file.fileId) || (ref.word && ref.carrierId && ref.carrierId === file.carrierId && file.words.has(ref.word)));
    case "agent":
      return Boolean(ref.carrierId && ref.agentCode && file.codes.has(`${ref.carrierId}|${ref.agentCode}`));
    case "money":
    case "commission-no-policy":
      return Boolean(policy && file.commissionPolicies.has(policy));
    case "rules":
      return Boolean(policy && file.policies.has(policy));
    case "file":
      return Boolean(ref.fileId && ref.fileId === file.fileId);
  }
}

export const NEEDS_YOU_VIEWS = ["mine", "agency", "insurvas", "closed"] as const;
export type NeedsYouView = (typeof NEEDS_YOU_VIEWS)[number];
export const VIEW_LABELS: Record<NeedsYouView, string> = { mine: "Mine", agency: "Agency", insurvas: "Waiting on Insurvas", closed: "Closed" };
export const isNeedsYouView = (value: string | undefined): value is NeedsYouView => (NEEDS_YOU_VIEWS as readonly string[]).includes(value ?? "");

/** Waiting on Insurvas: nothing the agency can decide; it shows apart, and never counts on the badge. */
export const waitsOnInsurvas = (item: Pick<NeedsYouItem, "kind">) => item.kind === "status-word";

/**
 * The items of one view. Mine: assigned to this person, or (for the owner and bookkeepers) a kind only they
 * decide. Agency: every open decision this person may see. Waiting on Insurvas: the status words. Closed is
 * its own list.
 */
export function viewItems(open: readonly NeedsYouItem[], view: Exclude<NeedsYouView, "closed">, me: { userId: string; keeper: boolean }): NeedsYouItem[] {
  if (view === "insurvas") return open.filter(waitsOnInsurvas);
  const decisions = open.filter((item) => !waitsOnInsurvas(item));
  if (view === "agency") return decisions;
  return decisions.filter((item) => (item.ownerUserId ? item.ownerUserId === me.userId : me.keeper && KIND_META[item.kind].keeperOnly));
}

/** Oldest first; then by kind in the list's order, then by id, so "the next" is always the same item. */
export function byOldest(a: NeedsYouItem, b: NeedsYouItem): number {
  return b.ageDays - a.ageDays || a.since.localeCompare(b.since) || NEEDS_YOU_KINDS.indexOf(a.kind) - NEEDS_YOU_KINDS.indexOf(b.kind) || a.id.localeCompare(b.id);
}

/** How many items each chip group holds. */
export function groupCounts(items: readonly NeedsYouItem[]): Record<NeedsYouGroup, number> {
  const out = Object.fromEntries(NEEDS_YOU_GROUPS.map((group) => [group, 0])) as Record<NeedsYouGroup, number>;
  for (const item of items) out[KIND_META[item.kind].group]++;
  return out;
}

/** Where an item sits in its list, and the one after it (wrapping to the first; none when it is alone). */
export function neighbours(items: readonly NeedsYouItem[], kind: NeedsYouKind, id: string): { index: number; total: number; next: NeedsYouItem | null } {
  const index = items.findIndex((item) => item.kind === kind && item.id === id);
  if (index < 0) return { index: -1, total: items.length, next: items[0] ?? null };
  const next = items.length > 1 ? items[(index + 1) % items.length] : null;
  return { index, total: items.length, next };
}

export const itemHref = (kind: NeedsYouKind, id: string) => `/app/needs-you/${kind}/${encodeURIComponent(id)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An unmapped agent code has no row of its own: its id is the carrier's and the code's, the code in hex so any
 * character the carrier writes survives the address.
 */
export function agentItemId(carrierId: string, code: string): string {
  const hex = Array.from(new TextEncoder().encode(code), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${carrierId}.${hex}`;
}

export function parseAgentItemId(id: string): { carrierId: string; code: string } | null {
  const [carrierId, hex, extra] = id.split(".");
  if (extra !== undefined || !carrierId || !UUID.test(carrierId) || !hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const code = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return code.trim() ? { carrierId, code } : null;
}

/** Every other kind's id is its source row's uuid. */
export const isItemId = (kind: NeedsYouKind, id: string) => (kind === "agent" ? parseAgentItemId(id) !== null : UUID.test(id));

const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

/** Whole days from a yyyy-mm-dd (or timestamp) to today, in the agency's day. */
export function daysSince(since: string, today: string): number {
  return Math.max(0, dayNumber(today) - dayNumber(since.slice(0, 10)));
}

/** "today", "1 d", "31 d" in the list; "today", "1 day", "31 days" on the item page. */
export const ageShort = (days: number) => (days === 0 ? "today" : `${days} d`);
export const ageLong = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`);

export const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "—" : `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
