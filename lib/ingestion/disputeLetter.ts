/**
 * LA-4.15 (Notion sprint) · the dispute letter: a filled template, never AI prose. The figures are
 * the argument, so every number comes straight from the discrepancy records — policy, what was
 * expected and from which rate, what was paid and from which lines, the difference — laid out
 * plainly. One letter can carry several items for one carrier. We draft; the agent sends.
 *
 * Pure; integer cents only.
 */

import { DISCREPANCY_LABELS, OWED_TYPES, type DiscrepancyType } from "./discrepancyEngine.ts";

/** The types a letter argues. The rest are warnings for the agent alone (held, a debit, a chargeback coming, an overpayment). */
export const DISPUTABLE: ReadonlySet<DiscrepancyType> = new Set(["missing", "short_paid", "mis_rated", "duplicate_chargeback", "unexpected_chargeback"]);

export type LetterItem = {
  id: string;
  type: DiscrepancyType;
  policyNumber: string | null;
  expectedCents: number | null;
  reportedCents: number | null;
  differenceCents: number | null;
  toleranceCents: number | null;
  expectedSource: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
  lines: number;
};

export type LetterParty = {
  agencyName: string;
  agencyAddress: string | null;
  npn: string | null;
  writingNumber: string | null;
  carrierName: string;
  recipient: string | null;
  signer: { name: string | null; email: string | null; phone: string | null };
  today: string;
};

export const money = (cents: number) => {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const pad = (text: string, width: number, right = false) => (text.length >= width ? text.slice(0, width) : right ? text.padStart(width) : text.padEnd(width));

/**
 * The amount a letter claims for one item: the difference owed to the agent, never a guess. An
 * unexpected chargeback is a question (please confirm the policy's status), not a claim: nothing.
 */
export const claimed = (item: Pick<LetterItem, "type" | "differenceCents">) => (OWED_TYPES.has(item.type) ? Math.max(0, item.differenceCents ?? 0) : 0);

/** How the expected figure was reached, from its record. */
function basis(item: LetterItem): string {
  const s = item.expectedSource ?? {};
  if (item.type === "missing") return `No commission line received${item.evidence.overdue_from ? ` by ${longDay(String(item.evidence.overdue_from))}` : ""}${item.evidence.trigger_on ? `; the policy ${item.evidence.trigger === "on_issue" ? "issued" : "drafted"} on ${longDay(String(item.evidence.trigger_on))}` : ""}.`;
  if (item.type === "duplicate_chargeback") return "The same chargeback appears twice for one lapse.";
  if (item.type === "unexpected_chargeback") return "Charged back while your policy records show the policy in force. Please confirm the policy's status.";
  if (s.rate_bp !== undefined && s.rate_bp !== null && s.commissionable_premium_cents !== undefined && s.commissionable_premium_cents !== null) {
    return `Expected at ${Number(s.rate_bp) / 100}% of ${money(Number(s.commissionable_premium_cents))}${s.schedule_version ? ` (commission schedule effective ${longDay(String(s.schedule_version))})` : ""}.${item.toleranceCents !== null ? ` Differences of ${money(item.toleranceCents)} or less are treated as rounding.` : ""}`;
  }
  return "";
}

/** The letter, as plain text: the same words on screen, in the PDF, and in the record kept. */
export function letterText(party: LetterParty, items: LetterItem[]): { body: string; totalCents: number } {
  const argued = items.filter((i) => DISPUTABLE.has(i.type));
  const total = argued.reduce((sum, i) => sum + claimed(i), 0);
  const n = argued.length;
  const header = [
    party.agencyName,
    party.agencyAddress,
    party.npn ? `NPN ${party.npn}` : null,
    "",
    longDay(party.today),
    "",
    party.recipient?.trim() || `${party.carrierName}\nCommissions Department`,
    "",
    `Re: Commission discrepancies${party.writingNumber ? ` - writing number ${party.writingNumber}` : ""}`,
    "",
    "To the Commissions Department,",
    "",
    `Comparing your commission statements with our records, the ${n === 1 ? "item below differs" : `${n} items below differ`} from what is owed${total > 0 ? `, ${money(total)} in all` : ""}. Each line shows what we expected, what was paid and the difference. Please review ${n === 1 ? "it" : "them"} and pay the difference, or tell us where our figures are wrong.`,
    "",
  ].filter((line) => line !== null) as string[];
  const table = [`${pad("Policy", 14)}${pad("Problem", 30)}${pad("Expected", 12, true)}${pad("Paid", 12, true)}${pad("Difference", 13, true)}`, "-".repeat(81)];
  for (const item of argued) {
    table.push(`${pad(item.policyNumber ?? "-", 14)}${pad(DISCREPANCY_LABELS[item.type].label, 30)}${pad(item.expectedCents === null ? "-" : money(item.expectedCents), 12, true)}${pad(item.reportedCents === null ? "-" : money(item.reportedCents), 12, true)}${pad(item.differenceCents === null ? "-" : money(item.differenceCents), 13, true)}`);
    const why = basis(item);
    if (why) table.push(`    ${why}`);
  }
  table.push("-".repeat(81), `${pad("Total owed", 68)}${pad(money(total), 13, true)}`);
  const footer = ["", "Thank you,", "", party.signer.name ?? party.agencyName, [party.agencyName, party.signer.phone, party.signer.email].filter(Boolean).join(" · ")];
  return { body: [...header, ...table, ...footer].join("\n"), totalCents: total };
}
