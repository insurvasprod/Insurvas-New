/**
 * LA-6.3 (Notion sprint, Module 6 — Compliance) · the gaps section, in words. The checks themselves
 * run in the database (compliance_gaps, 20261015120000) for one number and for a whole book alike;
 * this file only orders them by severity and says what each one means. Pure, so it is tested
 * without a database.
 *
 * "Called after a do-not-call entry" and "called after a complaint" are the two that matter most:
 * both mean we were told to stop and did not.
 */

export type GapStatus = "gap" | "undetermined";
export type GapSeverity = "critical" | "high" | "medium";

export type GapRow = {
  category: string;
  phone_digits: string | null;
  status: GapStatus;
  calls: number;
  first_at: string | null;
  last_at: string | null;
  detail: Record<string, unknown> | null;
};

export const GAP_CATEGORIES = [
  { key: "called_after_dnc", label: "Called after a do-not-call entry", severity: "critical", unit: "call" },
  { key: "called_after_complaint", label: "Called after a complaint", severity: "critical", unit: "call" },
  { key: "calls_without_consent", label: "Calls with no consent artefact", severity: "high", unit: "call" },
  { key: "consent_expired_before_call", label: "Consent artefact expired before the call", severity: "high", unit: "call" },
  { key: "outside_legal_hours", label: "Calls outside legal hours", severity: "high", unit: "call" },
  { key: "never_scrubbed", label: "Calls on a never-scrubbed number", severity: "medium", unit: "call" },
  { key: "transfer_without_verdict", label: "Transfer accepted with no verdict", severity: "medium", unit: "transfer" },
  { key: "disclosure_missing", label: "Missing disclosure on an application", severity: "medium", unit: "disclosure" },
] as const satisfies readonly { key: string; label: string; severity: GapSeverity; unit: string }[];

export type GapCategory = (typeof GAP_CATEGORIES)[number]["key"];
export const GAP_KEYS: readonly GapCategory[] = GAP_CATEGORIES.map((c) => c.key);

const META = new Map<string, (typeof GAP_CATEGORIES)[number]>(GAP_CATEGORIES.map((c) => [c.key, c]));
const RANK: Record<GapSeverity, number> = { critical: 0, high: 1, medium: 2 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Aug" (UTC day), with the year when it is not the year of `ref`. */
export function gapDay(iso: string | null, ref = new Date()): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === ref.getUTCFullYear() ? day : `${day} ${d.getUTCFullYear()}`;
}

/** Minutes past midnight as "07:48". */
export function clock(minute: unknown): string {
  const m = typeof minute === "number" ? minute : Number(minute);
  if (!Number.isFinite(m)) return "?";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const between = (row: GapRow, ref?: Date) =>
  row.first_at && row.last_at && gapDay(row.first_at, ref) !== gapDay(row.last_at, ref) ? `between ${gapDay(row.first_at, ref)} and ${gapDay(row.last_at, ref)}` : `on ${gapDay(row.first_at, ref)}`;

export type GapItem = {
  category: string;
  label: string;
  severity: GapSeverity;
  status: GapStatus;
  phoneDigits: string | null;
  count: number;
  /** The plain sentences under the bullet. */
  lines: string[];
};

/** One gap row in words. */
export function describeGap(row: GapRow, ref = new Date()): GapItem {
  const meta = META.get(row.category);
  const label = meta?.label ?? row.category.replace(/_/g, " ");
  const severity: GapSeverity = meta?.severity ?? "medium";
  const base = { category: row.category, label, severity, status: row.status, phoneDigits: row.phone_digits, count: row.calls };
  const reason = typeof row.detail?.reason === "string" ? row.detail.reason : null;
  if (row.status === "undetermined" && reason) return { ...base, lines: [`Undetermined: ${reason}`] };
  const calls = plural(row.calls, "call was", "calls were");
  switch (row.category) {
    case "calls_without_consent":
      return { ...base, lines: ["No consent artefact exists for this number.", `${calls} made ${between(row, ref)}.`] };
    case "consent_expired_before_call":
      return { ...base, lines: ["Consent was captured, but no certificate was retained or still inside its claim window when the call was made.", `${calls} made after it lapsed, ${between(row, ref)}.`] };
    case "never_scrubbed":
      return { ...base, lines: [`No scrub or screening of this number before its first call on ${gapDay(row.first_at, ref)}.`, `${calls} made.`] };
    case "called_after_dnc":
      return { ...base, lines: [`On the do-not-call list since ${gapDay(String(row.detail?.listed_at ?? ""), ref)}.`, `${calls} made after it was added, ${between(row, ref)}. Fix today.`] };
    case "called_after_complaint":
      return { ...base, lines: [`A complaint was received on ${gapDay(String(row.detail?.complaint_at ?? ""), ref)}.`, `${calls} made after it, ${between(row, ref)}. Fix today.`] };
    case "outside_legal_hours": {
      const detailCalls = Array.isArray(row.detail?.calls) ? (row.detail!.calls as Record<string, unknown>[]) : [];
      if (row.status === "undetermined") {
        const reasons = Array.isArray(row.detail?.reasons) ? (row.detail!.reasons as string[]).map((r) => r.replace(/_/g, " ")).join(", ") : "unknown";
        return { ...base, lines: [`${plural(row.calls, "call")} could not be checked against the legal window (${reasons}).`, "Undetermined is not a pass."] };
      }
      const lines = detailCalls.slice(0, 5).map((c) => `${row.calls === 1 ? "One call" : "A call"} on ${gapDay(String(c.at ?? ""), ref)} at ${clock(c.local_minute)} local was outside legal hours. Window for ${c.state ?? "the state"} is ${clock(c.start_minute)}–${clock(c.end_minute)}.`);
      if (row.calls > lines.length) lines.push(`${row.calls - lines.length} more.`);
      return { ...base, lines: lines.length ? lines : [`${calls} made outside legal hours.`] };
    }
    case "transfer_without_verdict":
      return { ...base, lines: [`${plural(row.calls, "partner transfer was", "partner transfers were")} accepted with no recorded verdict, ${between(row, ref)}.`] };
    case "disclosure_missing": {
      const names = Array.isArray(row.detail?.disclosures) ? (row.detail!.disclosures as string[]).join(", ") : "";
      return { ...base, lines: [`${plural(row.calls, "required disclosure was", "required disclosures were")} never acknowledged on a submitted application${names ? `: ${names}` : ""}.`] };
    }
    default:
      return { ...base, lines: [`${row.calls} ${meta?.unit ?? "record"}(s).`] };
  }
}

/** The gaps section of one report: real gaps first, by severity, then what could not be checked. */
export function gapsSection(rows: GapRow[], ref = new Date()) {
  const items = rows.map((r) => describeGap(r, ref));
  const order = (a: GapItem, b: GapItem) => RANK[a.severity] - RANK[b.severity] || GAP_KEYS.indexOf(a.category as GapCategory) - GAP_KEYS.indexOf(b.category as GapCategory);
  const gaps = items.filter((i) => i.status === "gap").sort(order);
  const undetermined = items.filter((i) => i.status === "undetermined").sort(order);
  return { gapCount: gaps.length, gaps, undetermined, checked: GAP_KEYS.length };
}

export type BookGapLine = { category: GapCategory; label: string; severity: GapSeverity; numbers: number; count: number; undeterminedNumbers: number; undeterminedCount: number; undeterminedReason: string | null };

/** The book-wide scan as a summary: per category, how many numbers and how many calls. */
export function bookSummary(rows: GapRow[]): BookGapLine[] {
  return GAP_CATEGORIES.map((c) => {
    const mine = rows.filter((r) => r.category === c.key);
    const gaps = mine.filter((r) => r.status === "gap");
    const und = mine.filter((r) => r.status === "undetermined");
    const reason = und.map((r) => (typeof r.detail?.reason === "string" ? r.detail.reason : null)).find(Boolean) ?? null;
    return {
      category: c.key,
      label: c.label,
      severity: c.severity,
      numbers: new Set(gaps.map((r) => r.phone_digits)).size,
      count: gaps.reduce((s, r) => s + r.calls, 0),
      undeterminedNumbers: new Set(und.filter((r) => r.phone_digits).map((r) => r.phone_digits)).size,
      undeterminedCount: und.reduce((s, r) => s + r.calls, 0),
      undeterminedReason: reason,
    };
  });
}

/** The headline sentence for a book line, as the spec writes it ("59 numbers have calls with no consent artefact."). */
export function bookLine(line: BookGapLine): string {
  if (!line.numbers && line.undeterminedReason) return `${line.label}: undetermined — ${line.undeterminedReason}`;
  const numbers = plural(line.numbers, "number");
  switch (line.category) {
    case "outside_legal_hours":
      return `${plural(line.count, "call")} outside legal hours${line.undeterminedCount ? ` (${line.undeterminedCount} undetermined)` : ""}.`;
    case "called_after_dnc":
      return `${numbers} ${line.numbers === 1 ? "was" : "were"} called after a DNC entry.`;
    case "called_after_complaint":
      return `${numbers} ${line.numbers === 1 ? "was" : "were"} called after a complaint.`;
    case "calls_without_consent":
      return `${numbers} ${line.numbers === 1 ? "has" : "have"} calls with no consent artefact.`;
    case "consent_expired_before_call":
      return `${numbers} ${line.numbers === 1 ? "was" : "were"} called after the consent artefact lapsed.`;
    case "never_scrubbed":
      return `${numbers} ${line.numbers === 1 ? "was" : "were"} called without a scrub first.`;
    case "transfer_without_verdict":
      return `${plural(line.count, "transfer")} accepted with no verdict.`;
    default:
      return `${plural(line.count, "required disclosure")} never acknowledged.`;
  }
}

/** Ten digits as "(817) 555-0142". */
export function formatPhone(digits: string | null): string {
  if (!digits || !/^\d{10}$/.test(digits)) return digits ?? "";
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
