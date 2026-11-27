import { money } from "@/components/book/format";
import type { Tone } from "@/theme/tokens";

import type { InvoiceStatus, MyPay, PayEntry, PayFacts, PayRun, PnlLine, PreviewPerson, StatementLine, TeamFact, TodoItem } from "./types";

/**
 * The Money screens' rules, pure so the tests read the same rules the screens use. Figures follow the web's own
 * formatter (lib/money.ts formatCentsAsCurrency, cents always, through book/format's `money` with a true minus) and
 * the web's own reading of each answer: My pay as Commissions › My pay reads its ledger (money-core.ts), team pay as
 * Team payouts drafts it (payPlanCore.ts), the To do list as Accounting › To do.
 */

export { money };

/** "$18,240" for a whole figure, "$18,240.50" otherwise: the board's summary rows. */
export function shortMoney(cents: number): string {
  return money(cents).replace(/\.00$/, "");
}

/** "$18,240": whole dollars, rounded to the nearest dollar — the boards' summary figures (G3, G3b, G3e, G4 totals). */
export function wholeMoney(cents: number): string {
  return money(roundCents(cents)).replace(/\.00$/, "");
}
/** Cents rounded to whole dollars, for a figure drawn without cents (MoneyFigure with dropZero). */
export function roundCents(cents: number): number {
  return Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" → "November". */
export function monthName(ym: string): string {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
}
/** "2026-11" → "Nov". */
export function monthShort(ym: string): string {
  return SHORT[Number(ym.slice(5, 7)) - 1] ?? ym;
}
/** "2026-10" → "October 2026". */
export function monthYear(ym: string): string {
  return `${monthName(ym)} ${ym.slice(0, 4)}`;
}
/** "2026-11-05" → "5 Nov". */
export function dayShort(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;
}
/** "2026-11-27" → "Fri 27 Nov": a due date as the board writes it (G3c). */
export function dayWeek(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${dayShort(iso)}`;
}
/** 5 → "5th", 1 → "1st", 22 → "22nd", 12 → "12th". */
export function ordinal(n: number): string {
  const t = n % 100;
  const end = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${end}`;
}
/**
 * The day of the month the agency pays on, read from its own statements: the last two (or three) paid statements
 * were all paid on the same day. Null when there are fewer than two or they disagree — the screen then says "early".
 */
export function payDay(runs: readonly Pick<PayRun, "status" | "paidOn" | "periodStart">[]): number | null {
  const days = [...runs].filter((r) => r.status === "paid" && r.paidOn && /^\d{4}-\d{2}-\d{2}/.test(r.paidOn))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart)).slice(0, 3).map((r) => Number((r.paidOn as string).slice(8, 10)));
  return days.length >= 2 && days.every((d) => d === days[0]) ? days[0] : null;
}

/** Months before or after "2026-11". */
export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
/** The first and last day of a month: the period the web's payout routes take. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
}

// ─── My pay (G1) and My balance (G7): Commissions › My pay's reading of the ledger ────────────
export type PayKind = "advance" | "earned" | "plan" | "chargeback" | "paid" | "agencyAdvance" | "other";
/**
 * `advance_paid` is money the agency paid the producer outside a statement: an advance FROM THE AGENCY (board G7 "Advance
 * from the agency"), a payout like statementCore's `isPayout` and the ledger's paid_cents count it — never a commission
 * advance (G1 "Advances · 11 policies issued" is the producer's share of carrier advances, `split_advance`). One rule for
 * G1 and G7.
 */
export const isAgencyAdvance = (type: string) => type === "advance_paid";
/** Which line of "This month" an entry adds to (statementCore's ENTRY_LABELS, grouped as the board groups them). */
export function payKind(type: string): PayKind {
  if (isAgencyAdvance(type)) return "agencyAdvance";
  if (type === "split_advance") return "advance";
  if (type === "earned" || type === "split_earned") return "earned";
  if (type === "salary" || type === "app_bonus" || type === "save_fee") return "plan";
  if (type === "chargeback" || type === "split_chargeback") return "chargeback";
  if (type === "payout" || type === "split_paid") return "paid";
  return "other";
}

/** Earned less what came back in a month (money-core's month figures), on the payout basis (reported), as statements are. */
function monthNet(entries: PayEntry[], ym: string): number {
  return entries.filter((e) => e.occurredOn.startsWith(ym) && e.basis === "reported" && ["advance", "earned", "plan", "chargeback"].includes(payKind(e.entryType)))
    .reduce((sum, e) => sum + e.amountCents, 0);
}

export type MyPaySummary = {
  month: string;
  expectedCents: number;
  /** Against last month; null when last month had nothing. */
  deltaCents: number | null;
  bars: { ym: string; label: string; cents: number }[];
  advances: { cents: number; policies: number };
  earned: { cents: number; count: number };
  plan: { cents: number; count: number };
  chargebacks: { cents: number; policies: number };
  statements: PayRun[];
  /** "December": the agency pays a month in early the next (money-core: "the agency pays in early …"). */
  paysIn: string;
  /** The day of the month the agency pays on, when its paid statements agree (G1 "paid on the 5th"). */
  paidDay: number | null;
  /** "Renewals and months 10–12" when the carriers paid this month agree on the advance length. */
  earnedMeta: string;
  /** "2 policies lapsed in month 4", from the month of each policy's life it came back in. */
  chargebackMeta: string;
  /** The clients whose policies came back this month (G7). */
  chargebackNames: string[];
  /** This month's share before what came back: advances, earned and pay plan (G7 "Your share of November commission"). */
  shareCents: number;
};

/** "Renewals and months 10–12": only when every carrier with an advance length agrees on it. */
export function earnedLine(entries: readonly PayEntry[], facts: PayFacts | null | undefined): string {
  const months = [...new Set(entries.map((e) => (e.carrierId ? facts?.advanceMonthsByCarrier[e.carrierId] : undefined)).filter((m): m is number => typeof m === "number"))];
  const one = months.length === 1 ? months[0] : null;
  if (one !== null && one < 11) return `Renewals and months ${one + 1}–12`;
  if (one === 11) return "Renewals and month 12";
  return "Renewals and earned months";
}

/** "2 policies lapsed in month 4" / "… in months 3–5"; without the policies' dates, "2 policies came back". */
export function chargebackLine(backs: readonly PayEntry[], facts: PayFacts | null | undefined): string {
  const policies = new Set(backs.map((e) => e.policyNumber).filter(Boolean)).size || backs.length;
  if (!policies) return "Nothing came back";
  const months = backs.map((e) => facts?.policyMonthByEntry[e.id]).filter((m): m is number => typeof m === "number");
  const who = plural(policies, "policy", "policies");
  if (!months.length || months.length !== backs.length) return `${who} came back`;
  const lo = Math.min(...months);
  const hi = Math.max(...months);
  return `${who} lapsed in ${lo === hi ? `month ${lo}` : `months ${lo}–${hi}`}`;
}

export function myPaySummary(data: MyPay, today: string): MyPaySummary {
  const month = today.slice(0, 7);
  const own = data.entries.filter((e) => e.occurredOn.startsWith(month) && e.basis === "reported");
  const of = (k: PayKind) => own.filter((e) => payKind(e.entryType) === k);
  const sum = (es: PayEntry[]) => es.reduce((s, e) => s + e.amountCents, 0);
  const policies = (es: PayEntry[]) => new Set(es.map((e) => e.policyNumber).filter(Boolean)).size;
  const last = monthNet(data.entries, shiftMonth(month, -1));
  const expected = monthNet(data.entries, month);
  const hadLast = data.entries.some((e) => e.occurredOn.startsWith(shiftMonth(month, -1)));
  return {
    month,
    expectedCents: expected,
    deltaCents: hadLast ? expected - last : null,
    bars: Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((ym) => ({ ym, label: monthShort(ym), cents: Math.max(0, monthNet(data.entries, ym)) })),
    advances: { cents: sum(of("advance")), policies: policies(of("advance")) },
    earned: { cents: sum(of("earned")), count: of("earned").length },
    plan: { cents: sum(of("plan")), count: of("plan").length },
    chargebacks: { cents: sum(of("chargeback")), policies: policies(of("chargeback")) },
    statements: [...data.runs].filter((r) => r.status === "published" || r.status === "paid").sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
    paysIn: monthName(shiftMonth(month, 1)),
    paidDay: payDay(data.runs),
    earnedMeta: earnedLine([...of("advance"), ...of("earned")], data.facts),
    chargebackMeta: chargebackLine(of("chargeback"), data.facts),
    chargebackNames: [...new Set(of("chargeback").map((e) => e.clientName).filter((n): n is string => !!n))],
    shareCents: sum([...of("advance"), ...of("earned"), ...of("plan")]),
  };
}

/** "Paid 5 Nov" or "Published, not marked paid yet": a statement's second line. */
export function runLine(run: Pick<PayRun, "status" | "paidOn">): string {
  return run.status === "paid" && run.paidOn ? `Paid ${dayShort(run.paidOn)}` : "Published, not paid yet";
}

/**
 * How a statement was paid, as the agency wrote it ("Bank transfer", "Zelle", "Direct deposit": Team payouts stores the
 * label itself); a code-like value ("bank_transfer", "ach") reads as words, an acronym in capitals.
 */
export function methodLabel(method: string | null | undefined): string | null {
  const m = method?.trim();
  if (!m) return null;
  if (/^(ach|ach_debit|wire)$/i.test(m)) return m.toLowerCase() === "wire" ? "Wire" : "ACH";
  if (!/^[a-z0-9_]+$/.test(m)) return m;
  const words = m.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "11 policies issued" / "1 policy". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// ─── Pay statement (G2): the statement's lines, grouped as the board draws them ───────────────
export type StatementGroup = { key: "advances" | "back" | "earned" | "plan" | "other"; title: string; lines: StatementLine[]; totalCents: number };
const GROUP_TITLE: Record<StatementGroup["key"], string> = { advances: "Advances", back: "Back to the carrier", earned: "As earned", plan: "Pay plan", other: "Other lines" };

/** statementCore's labels decide the group; anything that came back (a negative line) is "Back to the carrier". */
export function statementGroups(lines: StatementLine[]): StatementGroup[] {
  const keyOf = (l: StatementLine): StatementGroup["key"] => {
    if (l.chargebackCents !== null && l.netCents < 0) return "back";
    if (/advance/i.test(l.label)) return "advances";
    if (/earned/i.test(l.label)) return "earned";
    if (l.label === "Base pay" || l.label.startsWith("Bonus") || l.label === "Saved deal") return "plan";
    return "other";
  };
  const order: StatementGroup["key"][] = ["advances", "back", "earned", "plan", "other"];
  return order.map((key) => {
    const ls = lines.filter((l) => keyOf(l) === key);
    return { key, title: GROUP_TITLE[key], lines: ls, totalCents: ls.reduce((s, l) => s + l.netCents, 0) };
  }).filter((g) => g.lines.length > 0);
}

/** The distinct policies on a statement, and how many of them came back. */
export function statementCounts(lines: StatementLine[]): { policies: number; chargedBack: number } {
  const real = (p: string) => p && p !== "—";
  return {
    policies: new Set(lines.map((l) => l.policy).filter(real)).size,
    chargedBack: new Set(lines.filter((l) => l.netCents < 0 && l.chargebackCents !== null).map((l) => l.policy).filter(real)).size,
  };
}

// ─── Team payouts (G4): Team payouts' draft, as payPlanCore and draft.ts write it ─────────────
export type RunMode = "pay_full" | "withhold" | "recover" | "forgive";
/** Someone the month can pay or close: not paid yet, not the owner, something moved or owed (draft.ts `payable`). */
export const payable = (p: PreviewPerson) => !p.alreadyRun && p.planModel !== "solo_owner" && (p.periodCents !== 0 || p.balanceCents !== 0);
/** Below zero before or after the month (draft.ts `owes`). */
export const owes = (p: Pick<PreviewPerson, "balanceBeforeCents" | "balanceCents">) => p.balanceBeforeCents < 0 || p.balanceCents < 0;
/** Settings' rule for anyone below zero → the draft's default choice (payPlanCore `defaultChoice`). */
export function defaultChoice(policy: string | null | undefined): Exclude<RunMode, "pay_full"> {
  return policy === "cap" ? "recover" : policy === "write_off" ? "forgive" : "withhold";
}
function bpShare(cents: number, bp: number): number {
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(cents) * bp * 2 + 10000) / 20000);
}
/** One person's pay for the month by the choice (payPlanCore `draftPay`, mirroring agency_payout_commit). */
export function draftPay(x: { beforeCents: number; periodCents: number }, mode: RunMode, pctBp = 2000): { payCents: number; takenCents: number; forgivenCents: number } {
  const { beforeCents: b, periodCents: p } = x;
  if (mode === "pay_full") return { payCents: Math.max(p, 0), takenCents: 0, forgivenCents: 0 };
  if (mode === "withhold") { const pay = Math.max(b + p, 0); return { payCents: pay, takenCents: Math.max(Math.max(p, 0) - pay, 0), forgivenCents: 0 }; }
  if (mode === "recover") {
    const debt = Math.max(-b, 0);
    const take = Math.min(debt, bpShare(debt, pctBp), Math.max(p, 0));
    return { payCents: Math.max(p - take, 0), takenCents: take, forgivenCents: 0 };
  }
  const forgiven = Math.max(-(b + Math.min(p, 0)), 0);
  return { payCents: Math.max(Math.min(p, b + forgiven + p), 0), takenCents: 0, forgivenCents: forgiven };
}

export type TeamDraft = { person: PreviewPerson; mode: RunMode; payCents: number; why: string };
const MODEL: Record<string, string> = { sidekick: "Sidekick", salary_bonus: "Salary + bonus", big_split: "Big split", contract_level: "Contract level" };
const REASON: Partial<Record<RunMode, string>> = { withhold: "Took it all back: owed from before comes off first", forgive: "Let it go" };

/**
 * A person's line as the board words it (G4): "80% of advance · 14 policies", "70% · 1 chargeback", "Salary + bonus ·
 * 25 applications". The share and the counts are the month's own ledger lines (the route's `facts`); without them,
 * the pay plan's name.
 */
export function teamWhy(person: Pick<PreviewPerson, "planModel" | "chargebackCents">, fact: TeamFact | undefined, mode: RunMode): string {
  const plan = person.planModel ? MODEL[person.planModel] ?? null : null;
  const lead = fact?.shareBps ? `${pct(fact.shareBps)}${fact.policies ? " of advance" : ""}` : plan;
  const bits = [
    lead,
    fact?.policies ? plural(fact.policies, "policy", "policies") : null,
    fact?.chargebacks ? plural(fact.chargebacks, "chargeback", "chargebacks") : !fact && person.chargebackCents ? "chargebacks this month" : null,
    fact?.applications && !fact.policies ? plural(fact.applications, "application", "applications") : null,
    mode !== "pay_full" ? "owes the agency" : null,
  ].filter(Boolean);
  return bits.join(" · ") || "Commission this month";
}

/** Everyone the month pays, with the web's default choice for anyone who owes, largest pay first. */
export function teamDraft(preview: PreviewPerson[], rules: { negativePolicy: string; recoveryPctBp: number }, facts?: Record<string, TeamFact>): TeamDraft[] {
  const fallback = defaultChoice(rules.negativePolicy);
  return preview.filter(payable).map((person) => {
    const mode: RunMode = owes(person) ? fallback : "pay_full";
    const { payCents } = draftPay({ beforeCents: person.balanceBeforeCents, periodCents: person.periodCents }, mode, rules.recoveryPctBp);
    return { person, mode, payCents, why: teamWhy(person, facts?.[person.producerUserId], mode) };
  }).sort((a, b) => b.payCents - a.payCents || a.person.displayName.localeCompare(b.person.displayName));
}

/** The body Team payouts' Confirm and mark paid sends (POST /api/app/agency/payouts), with the web's own wording. */
export function teamPayoutBody(month: string, drafts: TeamDraft[], how: { method: string; paidOn: string }, recoveryPctBp: number) {
  const { from, to } = monthRange(month);
  return {
    from, to, paidOn: how.paidOn, method: how.method, reference: null,
    decisions: drafts.map((d) => ({
      producerUserId: d.person.producerUserId, mode: d.mode, pctBp: d.mode === "recover" ? recoveryPctBp : null,
      reason: d.mode === "recover" ? `Took a share: ${pct(recoveryPctBp)} of what was owed` : REASON[d.mode] ?? null,
      method: how.method, reference: null, paidOn: how.paidOn,
    })),
  };
}

/** Basis points as a percent, by string: 2000 → "20%", 1250 → "12.5%". */
export function pct(bp: number): string {
  const d = String(Math.abs(bp)).padStart(3, "0");
  const frac = d.slice(-2).replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${d.slice(0, -2)}${frac ? `.${frac}` : ""}%`;
}

/** Two letters for a person's gold avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

// ─── Money tab (G3): where a To do row opens on the phone ─────────────────────────────────────
export type TodoOpen =
  | { kind: "bill"; id: string }
  | { kind: "payment"; id: string }
  | { kind: "partners" }
  | { kind: "expense"; id: string }
  | { kind: "computer"; path: string };

/** A row opens its phone screen where there is one (G3b, G3c, G3d, the expense OK sheet); otherwise the web page. */
export function todoOpens(item: Pick<TodoItem, "key" | "group" | "href">): TodoOpen {
  if (item.group === "bills" && item.key.startsWith("bill-")) return { kind: "bill", id: item.key.slice(5) };
  if (item.group === "bank" && item.key.startsWith("pay-")) return { kind: "payment", id: item.key.slice(4) };
  if (item.group === "payouts") return { kind: "partners" };
  if (item.group === "expenses" && item.key.startsWith("exp-")) return { kind: "expense", id: item.key.slice(4) };
  return { kind: "computer", path: item.href };
}

const TODO_ICON: Record<TodoItem["group"], "landmark" | "receipt" | "creditCard" | "handshake" | "file"> = { bank: "landmark", bills: "receipt", expenses: "creditCard", payouts: "handshake", tax: "file" };
export const todoIcon = (group: TodoItem["group"]) => TODO_ICON[group];

/** The web's chip tones in the app's colours. */
export function chipTone(tone: "warning" | "danger" | "neutral" | string): Tone {
  return tone === "danger" ? "bad" : tone === "warning" ? "warn" : "neutral";
}

/** A To do chip as the web words it: "$3,404.41 short" when the amount leads the label. */
export function todoChip(item: Pick<TodoItem, "chip" | "amountCents">): string {
  return item.chip.amount && item.amountCents !== null ? `${money(Math.abs(item.amountCents))} ${item.chip.label}` : item.chip.label;
}

// ─── Profit & loss (G3, G3e) ───────────────────────────────────────────────────────────────────
const IN_LABELS: Record<string, string> = { advance: "Commission advances", earned: "Earned & renewals", override: "Overrides", held: "Held by the carrier", chargeback: "Chargebacks", fee: "Carrier fees", advance_interest: "Advance interest", reversal: "Corrections" };
const CATEGORY_LABELS: Record<string, string> = { leads: "Leads (no invoice)", software: "Software", telephony: "Telephony & dialer", data_services: "Data services", insurance: "Insurance", professional_fees: "Professional fees", licensing: "Licensing", office: "Office & equipment", other: "Other" };
const COST_LABELS: Record<string, string> = { lead_cost: "Lead cost", partner_payout: "Partner payout", producer_split: "Producer split", platform_fee: "Platform fee", tool_subscription: "Tools & subscriptions", insurance: "Insurance", professional_fee: "Professional fees", refund: "Refund", adjustment: "Adjustment" };

/** A P&L line's name, as the web's statement lists it (pnlLinks `lineLabel`). */
export function lineLabel(l: Pick<PnlLine, "section" | "entryType" | "sourceType" | "sourceName">): string {
  if (l.section === "in" || l.section === "held") return IN_LABELS[l.entryType] ?? l.entryType;
  if (l.sourceType === "expense_category" && l.sourceName) return CATEGORY_LABELS[l.sourceName] ?? l.sourceName;
  const kind = l.entryType === "lead_cost" ? "Lead costs" : l.entryType === "partner_payout" ? "Partner payouts" : l.entryType === "refund" ? "Refunds" : l.entryType === "tool_subscription" || l.entryType === "platform_fee" ? "Platform & tools" : COST_LABELS[l.entryType] ?? l.entryType;
  return l.sourceName ? `${kind} — ${l.sourceName}` : l.entryType === "lead_cost" ? "Lead costs — no source" : kind;
}

/** The drill query for one line (pnlLinks `entriesHref`), on the drill route. */
export function drillPath(l: PnlLine, period: { kind: string; anchor: string; basis: string }): string {
  const q = new URLSearchParams({ kind: period.kind, anchor: period.anchor, basis: period.basis, section: l.section, entry_type: l.entryType });
  if (l.sourceType) q.set("source_type", l.sourceType);
  if (l.sourceId) q.set("source_id", l.sourceId);
  if (l.sourceType === "expense_category" && l.sourceName) q.set("category", l.sourceName);
  return `/api/app/accounting/pnl/drill?${q.toString()}`;
}

/** "Where it went": costs, largest first (costs are negative on the statement). */
export function costLines(lines: { acquisition: PnlLine[]; overhead: PnlLine[]; splits: PnlLine[] }): PnlLine[] {
  return [...lines.acquisition, ...lines.splits, ...lines.overhead].filter((l) => l.amountCents !== 0).sort((a, b) => a.amountCents - b.amountCents);
}

/** A cost as the board writes it in the "Where it went" list: what left, without a sign, in whole dollars. */
export const spent = (cents: number) => wholeMoney(Math.abs(cents));

export type PnlCategory = { key: string; title: string; icon: "package" | "handshake" | "users" | "headset" | "building" | "creditCard" | "receipt"; meta: string | null; cents: number; lines: PnlLine[] };
const ROLL: Record<string, { title: string; icon: PnlCategory["icon"] }> = {
  leads: { title: "Leads", icon: "package" }, partners: { title: "Partner payouts", icon: "handshake" }, team: { title: "Team pay", icon: "users" },
  telephony: { title: "Dialer and phone lines", icon: "headset" }, office: { title: "Office and equipment", icon: "building" }, software: { title: "Software", icon: "creditCard" },
};
const ROLL_ORDER = ["leads", "partners", "team", "telephony", "office", "software"];

/** Which roll-up a statement line belongs to (G3e): by the server's own section, entry type and expense category. */
function rollKey(l: PnlLine): string {
  if (l.section === "splits") return "team";
  if (l.sourceType === "expense_category") return l.sourceName ?? "other";
  if (l.entryType === "lead_cost" || (l.entryType === "refund" && l.sourceType === "vendor")) return "leads";
  if (l.entryType === "partner_payout" || (l.entryType === "refund" && l.sourceType === "partner")) return "partners";
  if (l.entryType === "tool_subscription" || l.entryType === "platform_fee") return "software";
  return `cost:${l.entryType}`;
}

/**
 * "Where it went" in categories (board G3e: Leads · 4 vendors, Team pay · 6 people, Dialer and phone lines, Office and
 * equipment, Software), rolled up from the statement's own lines; any other category keeps its own name. Costs only:
 * the board's categories first, in its order, then the rest largest first.
 */
export function pnlCategories(lines: { acquisition: PnlLine[]; overhead: PnlLine[]; splits: PnlLine[] }, splitPeople?: number | null): PnlCategory[] {
  const by = new Map<string, PnlLine[]>();
  for (const l of costLines(lines)) by.set(rollKey(l), [...(by.get(rollKey(l)) ?? []), l]);
  const cats = [...by].map(([key, ls]): PnlCategory => {
    const cents = ls.reduce((s, l) => s + l.amountCents, 0);
    const named = ROLL[key];
    const vendors = new Set(ls.filter((l) => l.sourceType === "vendor" && l.sourceId).map((l) => l.sourceId)).size;
    const partners = new Set(ls.filter((l) => l.sourceType === "partner" && l.sourceId).map((l) => l.sourceId)).size;
    const meta = key === "leads" && vendors ? plural(vendors, "vendor", "vendors")
      : key === "partners" && partners ? plural(partners, "partner", "partners")
        : key === "team" && splitPeople ? plural(splitPeople, "person", "people") : null;
    const title = named?.title ?? (key.startsWith("cost:") ? lineLabel(ls[0]) : categoryLabel(key));
    return { key, title, icon: named?.icon ?? "receipt", meta, cents, lines: ls };
  }).filter((c) => c.cents !== 0);
  const rank = (k: string) => (ROLL_ORDER.includes(k) ? ROLL_ORDER.indexOf(k) : ROLL_ORDER.length);
  return cats.sort((a, b) => rank(a.key) - rank(b.key) || a.cents - b.cents);
}

// ─── Vendor bill (G3c) ─────────────────────────────────────────────────────────────────────────
/** The bill's one chip: matches, over or under what arrived (the difference past the agency's tolerance), or its status. */
export function billChip(inv: { status: InvoiceStatus; comparison: { summary: { invoicedCents: number; ourCents: number; flagged: boolean } } }): { tone: Tone; label: string } {
  const s = inv.comparison.summary;
  if (inv.status === "paid") return { tone: "ok", label: "Paid" };
  if (inv.status === "void") return { tone: "neutral", label: "Void" };
  if (inv.status === "disputed") return { tone: "neutral", label: "Disputed" };
  // Billed against what arrived (less returns credited): over means the bill asks for more than came in.
  const over = s.invoicedCents - s.ourCents;
  if (s.flagged && over !== 0) return { tone: "bad", label: `${money(Math.abs(over))} ${over > 0 ? "over" : "under"}` };
  return { tone: "ok", label: "Matches" };
}

/** The bill's facts as the board lists them: billed (count × price when one price), arrived, returns credited. */
export function billFacts(inv: { lines: { quantity: number; unitPriceCents: number }[]; comparison: { rows: { countable: boolean; invoicedQuantity: number; recorded: number; creditedCount: number }[] } }): { billed: string; arrived: string | null; returns: string | null } {
  const qty = inv.lines.reduce((s, l) => s + l.quantity, 0);
  const prices = [...new Set(inv.lines.map((l) => l.unitPriceCents))];
  const rows = inv.comparison.rows.filter((r) => r.countable);
  return {
    billed: prices.length === 1 ? `${qty.toLocaleString("en-US")} × ${money(prices[0])}` : qty.toLocaleString("en-US"),
    arrived: rows.length ? rows.reduce((s, r) => s + r.recorded, 0).toLocaleString("en-US") : null,
    returns: rows.length ? rows.reduce((s, r) => s + r.creditedCount, 0).toLocaleString("en-US") : null,
  };
}

// ─── Bank deposit (G3d) ────────────────────────────────────────────────────────────────────────
/** A payment's chip: short, missing or matched, as Bank deposits › Payments words its verdict. */
export function paymentChip(p: { verdict: string; shortCents: number; missingCents: number }, whole = false): { tone: Tone; label: string } {
  const fig = whole ? wholeMoney : money;
  switch (p.verdict) {
    case "bad_math": return { tone: "warn", label: `${fig(p.shortCents)} short` };
    case "missing_money": return { tone: "bad", label: `${fig(p.missingCents)} missing` };
    case "to_confirm": return { tone: "info", label: "To confirm" };
    case "waiting": return { tone: "neutral", label: "Waiting for the bank" };
    case "rate_missing": return { tone: "warn", label: "Rate missing" };
    default: return { tone: "ok", label: "Matched" };
  }
}

// ─── Pay issues (G8) ───────────────────────────────────────────────────────────────────────────
const KIND_WORDS: Record<string, [string, string]> = {
  missing: ["never paid", "never paid"], short_paid: ["paid short", "paid short"], over_paid: ["paid over", "paid over"], mis_rated: ["at the wrong rate", "at the wrong rate"],
  duplicate_chargeback: ["double chargeback", "double chargebacks"], unexpected_chargeback: ["unexpected chargeback", "unexpected chargebacks"], missing_chargeback: ["chargeback to come", "chargebacks to come"],
  held_building_up: ["held by the carrier", "held by the carrier"], debit_balance_growing: ["debit balance", "debit balances"], not_received: ["not received", "not received"],
};
const KIND_ORDER = ["missing", "short_paid", "mis_rated", "over_paid", "not_received"];
/** "4 never paid, 14 paid short" (board G8): never paid first, then paid short, then the rest by count. */
export function kindsLine(kinds: Record<string, number>): string {
  const rank = (k: string) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : KIND_ORDER.length);
  return Object.entries(kinds).filter(([, n]) => n > 0).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
    .map(([k, n]) => `${n} ${(KIND_WORDS[k] ?? [k.replaceAll("_", " "), k.replaceAll("_", " ")])[n === 1 ? 0 : 1]}`).join(", ");
}

// ─── Add expense (G6) ──────────────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = Object.keys(CATEGORY_LABELS);
export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c;
export const PAID_METHODS = [{ key: "card", label: "Card" }, { key: "ach", label: "ACH" }, { key: "cheque", label: "Cheque" }, { key: "wire", label: "Wire" }, { key: "other", label: "Other" }] as const;

/** The category this vendor was booked under last time, from the agency's earlier expenses (newest wins). */
export function suggestCategory(expenses: { vendorName: string; category: string; incurredOn: string; status: string }[], vendor: string): string | null {
  const name = vendor.trim().toLowerCase();
  if (!name) return null;
  const same = expenses.filter((e) => e.status !== "void" && e.vendorName.trim().toLowerCase() === name).sort((a, b) => b.incurredOn.localeCompare(a.incurredOn));
  return same[0]?.category ?? null;
}

/** "$155.12", "155.12", "1,204" → cents; null when it isn't money (lib/money.ts `parseDollarsToCents`). */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m || (m[1] === "" && !m[2])) return null;
  return Number(m[1] || "0") * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
}

/** "23 Nov 2026" ⇄ "2026-11-23": the date field reads as the board writes it and sends what the route takes. */
export function readableDay(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso;
}
export function parseDay(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(t);
  if (m) {
    const month = SHORT.findIndex((s) => s.toLowerCase() === m[2].toLowerCase());
    if (month >= 0) return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

/** Today in the phone's own calendar, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
