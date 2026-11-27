import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { openLadderCaseId } from "@/lib/retention/cases/store";

import { ENTRY_LABELS, type EntryType } from "./commissionLedger";
import { fileDay } from "./constants";
import { DEFAULT_SORT, EMPTY_FILTERS, filterRows, rowStatusLabel, sortRows, type BookRow } from "./policyBook";
import { loadBook, loadHandPolicies, loadIssuedAwaiting, loadIssuedAwaitingOne, loadPolicy, type SourceField, type Viewer } from "./policyBookStore";
import { isInForce, moneyFigures, paymentsBehind, policyHealth, type MoneyFacts, type Tone } from "./policyMoney";
import { loadBookMoney } from "./policyMoneyStore";
import { nextDateThatMatters, statusTone } from "./policyPage";
import { policyKeys } from "./policyPageStore";

/**
 * The phone's Book (mobile board F1 Policies, F2 Policy, F2b Commission ledger), read with the web's own stores so
 * the phone and the web say the same thing: the web's list (loadBook + hand + recorded sales), its Health chip and
 * money (loadBookMoney), its policy page (loadPolicy) and its Money tab's figures (moneyFigures). Read only.
 *
 * The list is cut and paged here, not on the phone: a book runs to many thousands of policies. A row carries no
 * client contact detail (the board: "no client contact detail on the list"); a phone search may match a client's
 * phone number, but the number itself never leaves the server.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const PHONE_CHIPS = ["inforce", "pending", "behind", "lapsed"] as const;
export type PhoneChip = (typeof PHONE_CHIPS)[number];
export const isPhoneChip = (value: string | null): value is PhoneChip => (PHONE_CHIPS as readonly string[]).includes(value ?? "");

const PAGE = 60;

/** The web's Health chip, or (when the money can't be worked out) the row's status words with the web's tone. */
type Health = { label: string; tone: Tone };

export type PhoneBookRow = {
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  health: Health;
  /** "policy": the phone's own policy page. "computer": a policy entered by hand, or a sale whose carrier we don't know (web page only). */
  opens: "policy" | "computer";
  webPath: string | null;
};

/** `%a%b%c%`: a phone's digits match however the number was written (as Servicing's policy search). */
const digitsPattern = (digits: string) => `%${digits.split("").join("%")}%`;

/** The clients whose phone holds these digits, for the search only. Null when the box isn't a phone number. */
async function phoneHits(tenantId: string, q: string): Promise<Set<string> | null> {
  const digits = q.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^[\d\s()+.-]+$/.test(q) || digits.length < 4) return null;
  const { data, error } = await db().from("contacts").select("id").eq("tenant_id", tenantId).ilike("primary_phone", digitsPattern(digits)).limit(200);
  if (error) return new Set();
  return new Set(((data ?? []) as Loose[]).map((c) => c.id as string));
}

function chipOf(row: BookRow, flags: { inforce: boolean; behind: boolean; lapsed: boolean } | null): Record<PhoneChip, boolean> {
  return {
    inforce: flags ? flags.inforce : !row.source && isInForce(row.status),
    pending: row.source === "issued" || row.status === "submitted" || row.status === "approved_unpaid",
    behind: Boolean(flags?.behind),
    lapsed: row.status === "lapsed",
  };
}

const TONE_OF: Record<string, Tone> = { good: "good", warning: "warning", danger: "danger", neutral: "neutral", info: "info" };

/** One page of the book as the web's Policies list holds it for this viewer: searched, cut by one chip, sorted as the web sorts. */
export async function phoneBookPage(viewer: Viewer, input: { q: string; chip: PhoneChip | null; offset: number }) {
  const lists = Promise.all([loadBook(viewer), loadHandPolicies(viewer), loadIssuedAwaiting(viewer).catch(() => [] as BookRow[])]);
  const moneyRead = loadBookMoney(viewer.tenantId, lists.then(([book, hand, issued]) => [...(book.available ? book.rows : []), ...hand, ...issued])).catch(() => null);
  const q = input.q.trim().slice(0, 100);
  const [[book, hand, issued], money, phones] = await Promise.all([lists, moneyRead, q ? phoneHits(viewer.tenantId, q) : Promise.resolve(null)]);
  const all = [...(book.available ? book.rows : []), ...hand, ...issued];
  // The web's search (policy, client, carrier, agent), or a client whose phone holds the digits typed.
  const byText = new Set(filterRows(all, { ...EMPTY_FILTERS, q }));
  const searched = q ? all.filter((row) => byText.has(row) || Boolean(phones && row.contactId && phones.has(row.contactId))) : all;
  const flagsOf = (row: BookRow) => money?.byKey.get(`${row.carrierId}|${row.policyNumber}`)?.flags ?? null;
  const counts: Record<PhoneChip, number> & { all: number } = { all: searched.length, inforce: 0, pending: 0, behind: 0, lapsed: 0 };
  const kept: BookRow[] = [];
  for (const row of searched) {
    const chips = chipOf(row, flagsOf(row));
    for (const chip of PHONE_CHIPS) if (chips[chip]) counts[chip]++;
    if (!input.chip || chips[input.chip]) kept.push(row);
  }
  const sorted = sortRows(kept, DEFAULT_SORT);
  const offset = Math.max(0, Math.min(input.offset, sorted.length));
  const rows: PhoneBookRow[] = sorted.slice(offset, offset + PAGE).map((row) => {
    const m = money?.byKey.get(`${row.carrierId}|${row.policyNumber}`);
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

/** The web's per-value (i) on the policy page, in its words (components/app/book/policy/overview-tab.tsx provenance). */
function provenance(field: SourceField | undefined): string | null {
  if (!field) return null;
  if (field.computed) return `Worked out from ${field.computed}.`;
  const read = field.readFrom ? `Read from ${field.readFrom.fileName ?? "the carrier's file"}${field.readFrom.rowNumber ? `, row ${field.readFrom.rowNumber}` : ""} (file of ${fileDay(field.readFrom.snapshotDate)}).` : "Not in the carrier's latest row.";
  const changed = field.changedOn ? ` Last changed ${fileDay(field.changedOn)}${field.fromFile ? ` in ${field.fromFile}` : ""}.` : field.readFrom ? " Unchanged since the policy first arrived." : "";
  return `${read}${changed}`;
}

/** A ledger line's words, as the web's Money tab names it ("Advance", "Reversal of advance"). */
function lineWord(type: string, correctsType: string | null): string {
  if (type === "reversal" && correctsType) return `Reversal of ${(ENTRY_LABELS[correctsType as EntryType]?.label ?? correctsType).toLowerCase()}`;
  return ENTRY_LABELS[type as EntryType]?.label ?? type.replaceAll("_", " ");
}

/**
 * One policy for the phone: the header, the figure strip, the Policy card with where each value came from, the
 * Commission card and the ledger lines (F2b reads the same answer). `canSeeCase`: the viewer may open Retention
 * cases (owner, producer, retention on chargeback_radar), as the web's "Open the case".
 */
export async function phonePolicy(viewer: Viewer, carrierId: string, policyNumber: string, options: { canSeeCase: boolean }) {
  const view = await loadPolicy(viewer, carrierId, policyNumber);
  if (!view) {
    const sale = await loadIssuedAwaitingOne(viewer, carrierId, policyNumber).catch(() => null);
    if (!sale) return null;
    return {
      kind: "awaiting" as const,
      title: sale.clientName ?? `Policy ${sale.policyNumber}`,
      carrierName: sale.carrierName, product: sale.product, policyNumber: sale.policyNumber,
      health: { label: "Awaiting the file", tone: "info" as Tone },
      monthlyCents: sale.monthlyCents, faceCents: sale.faceCents, issuedOn: sale.issuedOn, agentName: sale.agentName, leadId: sale.leadId,
    };
  }
  const { policy, client, sale, source, ledger, expected } = view;
  const [keys, caseId] = await Promise.all([
    policyKeys(viewer, carrierId, policyNumber).catch(() => null),
    options.canSeeCase ? openLadderCaseId(viewer.tenantId, carrierId, policy.policyNumber).catch(() => null) : Promise.resolve(null),
  ]);
  const field = (label: string) => source.fields.find((f) => f.label === label);
  const behind = policy.daysPastDue ?? 0;
  const owed = behind > 0 ? paymentsBehind(policy.paidTo, policy.asOf, policy.premiumMode) : null;
  const health = policyHealth({ status: policy.status, paidTo: policy.paidTo, daysPastDue: policy.daysPastDue, asOf: policy.asOf, premiumMode: policy.premiumMode });

  // The Money tab's own figures (commissions-tab.tsx): an advance charged back whole is gone.
  const first = expected.available ? (expected.rows.find((row: Loose) => Number(row.policy_year) === 1) ?? expected.rows[0]) as Loose : undefined;
  const totals = ledger.totals;
  const grossAdvance = totals?.advancedCents ?? 0;
  const chargedBack = Math.min(0, totals?.chargedBackCents ?? 0);
  const takenBack = grossAdvance > 0 && grossAdvance + chargedBack <= 0;
  const facts: MoneyFacts = {
    status: policy.status, paidTo: policy.paidTo, daysPastDue: policy.daysPastDue, daysLeft: policy.daysLeft, asOf: policy.asOf, effectiveDate: policy.effectiveDate,
    premiumMode: policy.premiumMode, monthsPaid: policy.monthsPaid,
    expectedCents: first && first.confidence !== "no_rate_card" && first.expected_amount_cents != null ? Number(first.expected_amount_cents) : null,
    noRate: first?.confidence === "no_rate_card",
    advancedCents: takenBack ? 0 : grossAdvance, earnedLineCents: totals?.earnedCents ?? 0, chargedBackCents: totals?.chargedBackCents ?? 0,
    unearnedCents: ledger.unearned ? ledger.unearned.unearnedCents : 0, atRiskCents: ledger.unearned ? ledger.unearned.atRiskCents : 0,
    shortCents: 0, hasLines: ledger.entries.length > 0, graceDays: null,
  };
  const figures = moneyFigures(facts);
  const firstAdvance = ledger.entries.find((entry) => entry.type === "advance");
  const clawbackMonths = ledger.rule?.clawbackMonths ?? ledger.unearned?.months ?? null;

  return {
    kind: "policy" as const,
    // Round 6: the client is the title (people look for a name).
    title: client?.name ?? sale?.name ?? keys?.leadName ?? `Policy ${policy.policyNumber}`,
    carrierName: policy.carrierName, product: policy.product, policyNumber: policy.policyNumber,
    // Owner 2026-11-10: while behind, "N payments behind" is on the figure, not beside the name.
    health: behind > 0 ? null : { label: health.label, tone: health.tone },
    statusRaw: policy.statusRaw,
    premiumCents: policy.premiumCents, premiumMode: policy.premiumMode,
    monthlyCents: policy.annualCents === null ? null : Math.round(policy.annualCents / 12),
    faceCents: policy.faceCents,
    issuedOn: policy.issuedOn, effectiveDate: policy.effectiveDate, paidTo: policy.paidTo,
    monthsPaid: policy.monthsPaid, inClawbackWindow: policy.inClawbackWindow, clawbackMonths,
    behind: behind > 0 ? (owed ? `${owed} ${owed === 1 ? "payment" : "payments"} behind` : `${behind.toLocaleString("en-US")} days behind`) : null,
    next: nextDateThatMatters(policy),
    draftDay: policy.draftDay, agentName: policy.agentName, agentCode: policy.agentCode,
    file: source.file ? { name: source.file.name, date: source.file.date, rowNumber: source.file.rowNumber } : null,
    sources: {
      status: provenance(field("Status")), premium: provenance(field("Premium")), face: provenance(field("Face amount")),
      issued: provenance(field("Issue date")), agent: provenance(field("Writing agent (carrier's code)")), paidTo: provenance(field("Paid-to date")),
    },
    money: {
      available: ledger.available,
      advancedCents: totals ? grossAdvance + chargedBack : null,
      advancedOn: firstAdvance ? firstAdvance.transactionDate ?? firstAdvance.statementDate : null,
      earnedCents: figures.earnedCents,
      atRiskCents: figures.atRiskCents,
      paidToDateCents: totals ? totals.netReceivedCents : null,
      lines: ledger.entries.map((entry) => ({
        id: entry.id,
        label: lineWord(entry.type, entry.correctsType),
        type: entry.type,
        monthsAdvanced: entry.monthsAdvanced,
        amountCents: entry.amountCents,
        date: entry.transactionDate ?? entry.statementDate ?? entry.createdAt,
        fileName: entry.fileName,
        upline: entry.payeeLevel === "upline",
        held: entry.heldByStatement,
      })),
    },
    leadId: keys?.leadId ?? null,
    caseId,
  };
}
