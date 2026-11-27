import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { teamMember } from "@/lib/agency/payPlanStore";

import { DEFAULT_SORT, EMPTY_FILTERS, filterRows, rowStatusLabel, sortRows, type BookRow } from "./policyBook";
import { loadBook, loadHandPolicies, loadIssuedAwaiting, type Viewer } from "./policyBookStore";
import { isInForce, type Tone } from "./policyMoney";
import { loadBookMoney } from "./policyMoneyStore";
import { statusTone } from "./policyPage";
import type { PhoneBookRow } from "./policyPhone";

/**
 * Mobile board F1, F2 and F2b, the parts the first phone build left out (docs/qa/MOBILE-BOARD-GAPS.md, F):
 *
 *   · F1's fourth chip, "Charged back": a policy whose commission ledger nets a chargeback (commission_entry lines of
 *     type chargeback, and reversals of them). The list itself is the web's list, read as policyPhone.ts reads it.
 *   · F2's Beneficiary (the primary beneficiaries on the application the policy came from) and "Last N drafts
 *     cleared" (only when the policy is drafted from a bank and nothing is behind: every paid month cleared).
 *   · F2b's expected lines (the rest of the first year, then renewals, from expected_commission) and the Split
 *     (the writing agent's pay plan share of the advance; the agency keeps the rest). A producer sees their own
 *     share; the agency's is "not shown" to them, as on My pay (board G1).
 *
 * Read only. Every read carries the tenant filter (service role).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const MORE_CHIPS = ["inforce", "pending", "lapsed", "chargedback", "behind"] as const;
export type MoreChip = (typeof MORE_CHIPS)[number];
export const isMoreChip = (value: string | null): value is MoreChip => (MORE_CHIPS as readonly string[]).includes(value ?? "");

const PAGE = 60;
const TONE_OF: Record<string, Tone> = { good: "good", warning: "warning", danger: "danger", neutral: "neutral", info: "info" };
const keyOf = (carrierId: string, policyNumber: string) => `${carrierId}|${policyNumber}`;

/** The policies whose ledger nets money taken back (a chargeback not reversed). Empty on any failure. */
export async function chargedBackKeys(tenantId: string): Promise<Set<string>> {
  const sums = new Map<string, number>();
  try {
    for (let from = 0; from < 100_000; from += 1000) {
      const { data, error } = await db().from("commission_entry").select("carrier_id, policy_number, amount_cents")
        .eq("tenant_id", tenantId).or("entry_type.eq.chargeback,corrects_type.eq.chargeback").order("id").range(from, from + 999);
      if (error) return new Set();
      for (const line of (data ?? []) as Loose[]) {
        const k = keyOf(line.carrier_id, line.policy_number);
        sums.set(k, (sums.get(k) ?? 0) + Number(line.amount_cents ?? 0));
      }
      if (!data || data.length < 1000) break;
    }
  } catch {
    return new Set();
  }
  return new Set([...sums].filter(([, cents]) => cents < 0).map(([k]) => k));
}

/** `%a%b%c%`: a phone's digits match however the number was written (as policyPhone.ts). */
const digitsPattern = (digits: string) => `%${digits.split("").join("%")}%`;

async function phoneHits(tenantId: string, q: string): Promise<Set<string> | null> {
  const digits = q.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^[\d\s()+.-]+$/.test(q) || digits.length < 4) return null;
  const { data, error } = await db().from("contacts").select("id").eq("tenant_id", tenantId).ilike("primary_phone", digitsPattern(digits)).limit(200);
  if (error) return new Set();
  return new Set(((data ?? []) as Loose[]).map((c) => c.id as string));
}

/**
 * One page of the book, as policyPhone.ts `phoneBookPage` cuts it, with the board's four chips (In force, Pending,
 * Lapsed, Charged back) and the earlier Behind kept for an older app. Counts follow the search.
 */
export async function phoneBookPageMore(viewer: Viewer, input: { q: string; chip: MoreChip | null; offset: number }) {
  const lists = Promise.all([loadBook(viewer), loadHandPolicies(viewer), loadIssuedAwaiting(viewer).catch(() => [] as BookRow[])]);
  const moneyRead = loadBookMoney(viewer.tenantId, lists.then(([book, hand, issued]) => [...(book.available ? book.rows : []), ...hand, ...issued])).catch(() => null);
  const q = input.q.trim().slice(0, 100);
  const [[book, hand, issued], money, phones, backKeys] = await Promise.all([lists, moneyRead, q ? phoneHits(viewer.tenantId, q) : Promise.resolve(null), chargedBackKeys(viewer.tenantId)]);
  const all = [...(book.available ? book.rows : []), ...hand, ...issued];
  const byText = new Set(filterRows(all, { ...EMPTY_FILTERS, q }));
  const searched = q ? all.filter((row) => byText.has(row) || Boolean(phones && row.contactId && phones.has(row.contactId))) : all;
  const counts: Record<MoreChip, number> & { all: number } = { all: searched.length, inforce: 0, pending: 0, lapsed: 0, chargedback: 0, behind: 0 };
  const kept: BookRow[] = [];
  for (const row of searched) {
    const flags = money?.byKey.get(keyOf(row.carrierId, row.policyNumber))?.flags ?? null;
    const chips: Record<MoreChip, boolean> = {
      inforce: flags ? flags.inforce : !row.source && isInForce(row.status),
      pending: row.source === "issued" || row.status === "submitted" || row.status === "approved_unpaid",
      lapsed: row.status === "lapsed",
      chargedback: backKeys.has(keyOf(row.carrierId, row.policyNumber)),
      behind: Boolean(flags?.behind),
    };
    for (const chip of MORE_CHIPS) if (chips[chip]) counts[chip]++;
    if (!input.chip || chips[input.chip]) kept.push(row);
  }
  const sorted = sortRows(kept, DEFAULT_SORT);
  const offset = Math.max(0, Math.min(input.offset, sorted.length));
  const rows: PhoneBookRow[] = sorted.slice(offset, offset + PAGE).map((row) => {
    const m = money?.byKey.get(keyOf(row.carrierId, row.policyNumber));
    const known = !row.source || (row.source === "issued" && !row.carrierId.startsWith("issued:"));
    return {
      carrierId: row.carrierId, carrierName: row.carrierName, policyNumber: row.policyNumber, clientName: row.clientName,
      premiumCents: row.premiumCents, premiumMode: row.premiumMode,
      health: m ? { label: m.health.label, tone: TONE_OF[m.health.tone] ?? "neutral" } : { label: rowStatusLabel(row), tone: row.source === "issued" ? "info" : (statusTone(row.status) as Tone) },
      opens: known ? "policy" : "computer",
      webPath: known ? null : row.href ?? null,
    };
  });
  return { rows, counts, total: kept.length, offset, next: offset + PAGE < kept.length ? offset + PAGE : null, available: book.available, moneyOk: Boolean(money) };
}

const RELATION: Record<string, string> = {
  spouse: "spouse", child: "child", parent: "parent", sibling: "sibling", grandchild: "grandchild", estate: "estate", trust: "trust", funeral_home: "funeral home",
};

export type PolicyMore = {
  /** "Luis Alvarez · child"; several primaries joined; null when the application named none or isn't linked. */
  beneficiary: string | null;
  /** "Last 3 drafts cleared": drafted from a bank, nothing behind, N months paid (at most 3 said). Null otherwise. */
  draftsCleared: number | null;
  /** Lines not posted yet: the rest of the first year, then each renewal year the rate card expects. */
  expected: Array<{ key: string; label: string; startsOn: string | null; amountCents: number | null; kind: "as_earned" | "renewal" }>;
  /** The writing agent's pay-plan share of the advance, and the agency's. Null without a split pay plan. */
  split: { agentName: string; agentPctBp: number; agentCents: number; agencyPctBp: number; agencyCents: number | null } | null;
};

const addYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4, 10)}`;

/**
 * The extra facts for one policy the phone shows (see the file note). `money` is what phonePolicy answered, so the
 * advance and the months advanced are the ledger's own; `behind` is phonePolicy's.
 */
export async function policyMore(
  viewer: Viewer,
  carrierId: string,
  policyNumber: string,
  facts: { behind: string | null; monthsPaid: number | null; lines: Array<{ type: string; amountCents: number; monthsAdvanced: number | null; upline: boolean }>; agentName: string | null },
): Promise<PolicyMore> {
  const none: PolicyMore = { beneficiary: null, draftsCleared: null, expected: [], split: null };
  const { data: current, error } = await db().from("policy_current").select("application_id, agent_user_id, payment_method, effective_date, issue_date")
    .eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).maybeSingle();
  if (error || !current) return none;
  if (viewer.role === "producer" && current.agent_user_id !== viewer.userId) return none;

  const [beneficiaries, expected, plan] = await Promise.all([
    current.application_id
      ? db().from("tenant_application_beneficiaries").select("first_name, last_name, relationship, relationship_other, tier, sort_order").eq("tenant_id", viewer.tenantId).eq("application_id", current.application_id).eq("tier", "primary").order("sort_order").then((r: Loose) => (r.error ? [] : r.data ?? []), () => [])
      : Promise.resolve([]),
    db().from("expected_commission").select("policy_year, confidence, expected_amount_cents, trigger_occurred_on").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("policy_year")
      .then((r: Loose) => (r.error ? [] : r.data ?? []), () => []),
    current.agent_user_id ? teamMember(viewer.tenantId, current.agent_user_id).catch(() => null) : Promise.resolve(null),
  ]);

  const beneficiary = (beneficiaries as Loose[]).map((b) => {
    const name = [b.first_name, b.last_name].filter(Boolean).join(" ").trim();
    const relation = b.relationship === "other" ? b.relationship_other : RELATION[b.relationship] ?? null;
    return [name, relation].filter(Boolean).join(" · ");
  }).filter(Boolean).join(", ") || null;

  const drafted = typeof current.payment_method === "string" && /draft|eft|ach|bank/i.test(current.payment_method);
  const draftsCleared = drafted && !facts.behind && facts.monthsPaid && facts.monthsPaid > 0 ? Math.min(3, facts.monthsPaid) : null;

  // The advance as the statements posted it (the agency's own lines, not the upline's).
  const advances = facts.lines.filter((l) => l.type === "advance" && !l.upline);
  const advanceCents = advances.reduce((sum, l) => sum + l.amountCents, 0);
  const monthsAdvanced = advances.reduce((max, l) => Math.max(max, l.monthsAdvanced ?? 0), 0) || null;
  const earnedCents = facts.lines.filter((l) => l.type === "earned" && !l.upline).reduce((sum, l) => sum + l.amountCents, 0);
  const start = (current.effective_date ?? current.issue_date ?? null) as string | null;
  const lines: PolicyMore["expected"] = [];
  for (const row of expected as Loose[]) {
    const year = Number(row.policy_year);
    const priced = row.confidence !== "no_rate_card" && row.expected_amount_cents != null;
    if (year === 1) {
      // What the first year still owes after the advance and the as-earned lines already posted.
      if (!priced || !monthsAdvanced || monthsAdvanced >= 12) continue;
      const rest = Number(row.expected_amount_cents) - advanceCents - earnedCents;
      if (rest <= 0) continue;
      const from = monthsAdvanced + 1;
      lines.push({ key: "y1", label: from === 12 ? "As earned · month 12" : `As earned · months ${from}–12`, startsOn: null, amountCents: rest, kind: "as_earned" });
      continue;
    }
    const starts = (row.trigger_occurred_on as string | null) ?? (start ? addYears(start, year - 1) : null);
    lines.push({ key: `y${year}`, label: `Renewal · year ${year}`, startsOn: starts, amountCents: priced ? Number(row.expected_amount_cents) : null, kind: "renewal" });
  }

  const p = plan?.plan ?? null;
  let split: PolicyMore["split"] = null;
  if (p && p.model === "big_split" && p.salesPctBp !== null && advanceCents > 0) {
    const agentCents = Math.round((advanceCents * p.salesPctBp) / 10_000);
    split = {
      agentName: plan?.name ?? facts.agentName ?? "The writing agent",
      agentPctBp: p.salesPctBp, agentCents,
      agencyPctBp: 10_000 - p.salesPctBp,
      // The agency's own share is the owner's and the bookkeeper's to see, not a producer's (board G1).
      agencyCents: viewer.role === "producer" ? null : advanceCents - agentCents,
    };
  }
  return { beneficiary, draftsCleared, expected: lines, split };
}
