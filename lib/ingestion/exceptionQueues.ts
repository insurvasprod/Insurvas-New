/**
 * LA-4.9 (Notion sprint) · the three exception queues: what each is, who owns it by default, how old
 * an item is, and when "the same person" is certain enough to need nobody.
 *
 *   no_deal_flow  a carrier policy we hold no record of → a provisional client, to the writing agent;
 *   no_policy     a logged sale no carrier file has heard of → to the writing agent, the valuable one;
 *   multi_policy  "are these one person?" → operations, and only when not certain.
 *   initial_import  one summary per imported file (LA-4.10) → the owner; never 400 separate items.
 *
 * The SQL (20261008180000) holds the same defaults in queue_owner and sweep_exception_queues; this
 * file is what the screen and the store use, pinned to the SQL by exceptionQueues.test.mjs.
 *
 * Pure; relative imports only.
 */

export const QUEUE_TYPES = ["no_deal_flow", "no_policy", "multi_policy", "initial_import", "orphan_commission"] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];
export const OWNER_ROLES = ["writing_agent", "operations", "retention", "admin"] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

export const QUEUE_LABELS: Record<QueueType, { title: string; why: string }> = {
  no_deal_flow: { title: "Policies with no sale on record", why: "A carrier sent a policy we have no deal or application for. Usually it was sold and not logged." },
  no_policy: { title: "Sales no carrier has heard of", why: "A sale was logged and the carrier's newer files don't have it. It may never have been submitted." },
  multi_policy: { title: "Is this the same client?", why: "Two clients look alike. A client with several policies is good news; this only checks they are one person." },
  orphan_commission: { title: "Commission for a policy we can't find", why: "A carrier has paid on a policy number none of its policy files has shown, for longer than usual. Often it was written under another writing number; sometimes it's a carrier error." },
  initial_import: { title: "Imported books to look over", why: "New clients were created from an imported carrier file and marked provisional. Check them in Contacts when you have time, then mark this done." },
};

export const OWNER_ROLE_LABELS: Record<OwnerRole, string> = { writing_agent: "The writing agent", operations: "Operations (a bookkeeper)", retention: "Retention (a producer)", admin: "The owner" };

/** The tenant role each owner role draws from (writing_agent is the policy's or sale's own agent). */
export const ROLE_SOURCE: Record<Exclude<OwnerRole, "writing_agent">, string> = { operations: "bookkeeper", retention: "producer", admin: "owner" };

export type QueueRule = { queueType: QueueType; ownerRole: OwnerRole; openAfterDays: number | null; escalateAfterDays: number | null; escalateToRole: OwnerRole | null };

/** What an agency gets with no configuration — a solo agent never sees these. */
export const DEFAULT_RULES: Record<QueueType, QueueRule> = {
  no_deal_flow: { queueType: "no_deal_flow", ownerRole: "writing_agent", openAfterDays: null, escalateAfterDays: null, escalateToRole: null },
  no_policy: { queueType: "no_policy", ownerRole: "writing_agent", openAfterDays: 5, escalateAfterDays: 10, escalateToRole: null },
  multi_policy: { queueType: "multi_policy", ownerRole: "operations", openAfterDays: null, escalateAfterDays: null, escalateToRole: null },
  initial_import: { queueType: "initial_import", ownerRole: "admin", openAfterDays: null, escalateAfterDays: null, escalateToRole: null },
  // LA-4.14: only lines still unmatched after 60 days reach a person (sweep_orphan_commissions).
  orphan_commission: { queueType: "orphan_commission", ownerRole: "operations", openAfterDays: 60, escalateAfterDays: null, escalateToRole: null },
};

/** The agency's rule for each queue: its own row over the default, field by field. */
export function effectiveRules(rows: Array<Partial<QueueRule> & { queueType: QueueType }>): Record<QueueType, QueueRule> {
  const out = { ...DEFAULT_RULES };
  for (const row of rows) {
    const base = DEFAULT_RULES[row.queueType];
    if (!base) continue;
    out[row.queueType] = {
      queueType: row.queueType,
      ownerRole: row.ownerRole ?? base.ownerRole,
      openAfterDays: row.openAfterDays ?? base.openAfterDays,
      escalateAfterDays: row.escalateAfterDays ?? base.escalateAfterDays,
      escalateToRole: row.escalateToRole ?? base.escalateToRole,
    };
  }
  return out;
}

const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

/** Whole days since an item's clock started (the sale's date for queue 2, the item's day otherwise). */
export function ageDays(ageFrom: string, today: string): number {
  return Math.max(0, dayNumber(today) - dayNumber(ageFrom));
}

/** How the age reads: fresh, aging, or escalated past the second threshold. */
export function ageTone(age: number, rule: Pick<QueueRule, "escalateAfterDays">, escalated: boolean): "fresh" | "aging" | "escalated" {
  if (escalated || (rule.escalateAfterDays !== null && age >= rule.escalateAfterDays)) return "escalated";
  return age >= 3 ? "aging" : "fresh";
}

export const ageLabel = (age: number) => (age === 0 ? "today" : age === 1 ? "1 day" : `${age} days`);

const fold = (value: string | null | undefined) => (value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The exact identity two records must share for "the same person" to need nobody: first name,
 * last name and date of birth, all present and all equal (accents and case aside). Anything less
 * goes to a person. Null when any part is missing.
 */
export function identityKey(person: { firstName: string | null; lastName: string | null; dob: string | null }): string | null {
  const first = fold(person.firstName), last = fold(person.lastName);
  if (!first || !last || !person.dob || !/^\d{4}-\d\d-\d\d$/.test(person.dob)) return null;
  return `${first}|${last}|${person.dob}`;
}

/** The resolutions each queue offers, in the order the screen shows them. */
export const RESOLUTIONS = {
  no_deal_flow: ["confirm_client", "link_existing_client", "found_the_sale", "not_mine"],
  no_policy: ["found_the_policy", "never_submitted", "resubmitted_elsewhere", "not_mine"],
  multi_policy: ["same_person", "different_people"],
  initial_import: ["reviewed"],
  orphan_commission: ["another_writing_number", "raised_with_carrier", "not_mine"],
} as const;
export type Resolution = (typeof RESOLUTIONS)[QueueType][number];

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  confirm_client: "It's mine — the client is right",
  link_existing_client: "It's an existing client",
  found_the_sale: "Link it to the sale",
  not_mine: "Not mine",
  found_the_policy: "Found it — link the policy",
  never_submitted: "Never submitted",
  resubmitted_elsewhere: "Resubmitted elsewhere",
  same_person: "Same person",
  different_people: "Different people",
  reviewed: "Looked over",
  another_writing_number: "Written under another writing number",
  raised_with_carrier: "Raised with the carrier",
};
