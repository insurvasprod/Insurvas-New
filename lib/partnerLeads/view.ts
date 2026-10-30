/**
 * Pure: everything the partner Pipeline page derives from a lead row.
 *
 * Three jobs, kept together because the board and the table must not drift apart:
 *
 *   1. The board's columns. They are the shared lanes (lanes.ts), not the agency's configured
 *      stage names. The counters above the board already speak this vocabulary, so drawing the
 *      columns from the same source makes it impossible for the two to contradict each other —
 *      which they did ("Claimed 1" above a lead sitting in a column called "New lead"). The
 *      agency's own stage name is not lost: it rides on each card, and the table keeps its column.
 *   2. How old a submission is allowed to get before the page says so.
 *   3. How a submitted form value is read by a person rather than by a database.
 */
import { dayMonthYear } from "../format/dates.ts";
import { NOBODY_CLAIMED_LABEL, PARTNER_LANES, type PartnerLane } from "./lanes.ts";

/* ── The board's columns ─────────────────────────────────────────────────────────────────────── */

export type BoardColumn = {
  key: PartnerLane;
  /** The column head. Plain words, not the lane key: "On a call", never "Verification". */
  label: string;
  /** What being in this column means, for the column's title attribute. */
  footnote: string;
  /** Picks the head's ground and ink, the way the stage columns were toned by `stage_type`. */
  tone: "open" | "won" | "closed";
};

/**
 * The four open-to-won columns, in the order the counters above them read. The labels come from
 * PARTNER_LANES' own footnotes where the lane key is jargon: the "verification" lane's footnote is
 * literally "on a call", so that is what the column says.
 *
 * These nest inside the stat cards rather than matching them one for one, and the cards' footnotes
 * name the nesting: "With a closer" counts Claimed + On a call, and its footnote reads
 * "Claimed or on a call".
 */
export const PARTNER_BOARD_COLUMNS: readonly BoardColumn[] = [
  { key: "new", label: "New", footnote: "Waiting for a closer to claim it", tone: "open" },
  { key: "claimed", label: "Claimed", footnote: "A closer is working it", tone: "open" },
  { key: "verification", label: "On a call", footnote: "On the phone with your customer now", tone: "open" },
  { key: "converted", label: "Converted", footnote: "Became business in the last 30 days", tone: "won" },
];

/** Shown only when it holds something: a column of finished-without-a-sale is noise on a quiet board. */
export const CLOSED_COLUMN: BoardColumn = {
  key: "closed",
  label: "Closed",
  footnote: "Finished without a sale, or sold more than 30 days ago",
  tone: "closed",
};

export function boardColumns(hasClosed: boolean): readonly BoardColumn[] {
  return hasClosed ? [...PARTNER_BOARD_COLUMNS, CLOSED_COLUMN] : PARTNER_BOARD_COLUMNS;
}

const LANES = new Set<PartnerLane>([...PARTNER_LANES.map((lane) => lane.key), "closed"]);

/** The lanes are a closed set; a row that somehow carries none is treated as newly arrived. */
export function laneOf(row: { lane?: PartnerLane | null }): PartnerLane {
  return row.lane && LANES.has(row.lane) ? row.lane : "new";
}

/* ── How long it has been waiting ────────────────────────────────────────────────────────────── */

export type AgeTone = "neutral" | "warning" | "danger";
export type AgeThresholds = { warnSeconds: number; dangerSeconds: number };

/**
 * The queue SLA ladder's own defaults (`DEFAULTS` in lib/queueSla/service.ts): the partner rung
 * fires at 5 minutes — the point the agency itself has decided is late enough to tell the partner —
 * and a transfer expires at 4 hours.
 *
 * They are defaults, not constants: the ladder is configured per tenant
 * (`tenant_queue_sla_settings`), so the page passes the tenant's own values when it has them. An
 * invented "amber after 4 hours" would have painted every lead green right up to the moment it
 * expired.
 */
export const DEFAULT_AGE_THRESHOLDS: AgeThresholds = { warnSeconds: 300, dangerSeconds: 14_400 };

/** The SLA ladder has already told this partner nobody claimed it: ground truth, not a guess. */
export function nobodyClaimedRow(row: { stageName?: string | null }): boolean {
  return row.stageName === NOBODY_CLAIMED_LABEL;
}

/**
 * Whether a submission's age is worth saying something about.
 *
 * A finished lead is never late — converted and closed are always neutral, however old they are.
 * An open lead the ladder has already flagged is at least amber whatever the clock says, because
 * that flag is the agency's own decision rather than this page's arithmetic.
 */
export function ageTone(
  row: { submittedAt: string; lane?: PartnerLane | null; stageName?: string | null },
  now: number = Date.now(),
  thresholds: AgeThresholds = DEFAULT_AGE_THRESHOLDS,
): AgeTone {
  const lane = laneOf(row);
  if (lane === "converted" || lane === "closed") return "neutral";
  const seconds = Math.max(0, (now - new Date(row.submittedAt).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "neutral";
  if (seconds >= thresholds.dangerSeconds) return "danger";
  if (seconds >= thresholds.warnSeconds || nobodyClaimedRow(row)) return "warning";
  return "neutral";
}

/**
 * The words beside the colour (UI-CONSISTENCY §12: never colour alone). Neutral says nothing —
 * there is nothing to say about a lead that arrived four minutes ago.
 */
export const AGE_TONE_TEXT: Record<AgeTone, string | null> = {
  neutral: null,
  warning: "Waiting longer than usual",
  danger: "Past the time your agency allows",
};

/** "12 min", "3 hr", "yesterday", "4 d" — how long ago, the way the board's cards say it. */
export function ageShort(value: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr`;
  if (minutes < 48 * 60) return "yesterday";
  return `${Math.round(minutes / (24 * 60))} d`;
}

/**
 * Whether the Still open figure is worth painting amber: the longest-waiting open submission is
 * past the ladder's expiry rung.
 *
 * Expiry, not the partner rung the rows are toned by. The partner rung is minutes (300s by
 * default), so a card keyed to it would be amber for any partner with a lead older than five
 * minutes — permanent amber says nothing. A card shouts when something has run out of time.
 */
export function oldestOpenIsStuck(
  oldestOpenAt: string | null | undefined,
  now: number,
  thresholds: AgeThresholds = DEFAULT_AGE_THRESHOLDS,
): boolean {
  if (!oldestOpenAt) return false;
  const seconds = (now - new Date(oldestOpenAt).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= thresholds.dangerSeconds;
}

/* ── The submitted form, as a person reads it ────────────────────────────────────────────────── */

export type SnapshotField = { key: string; label: string; value: string };
export type SnapshotGroup = { key: string; label: string; fields: SnapshotField[] };

/**
 * Already on the panel's header, so repeating them inside it is noise: the title said "test test"
 * while the body said FIRST NAME test / LAST NAME test.
 */
const HIDDEN = new Set(["first_name", "last_name", "full_name", "name", "customer", "customer_name", "product", "product_line"]);

/**
 * The order a person reads a submission in: who they are, how to reach them, what they asked for,
 * anything else written down. A key not named here keeps its place at the end rather than being
 * dropped — a template can add any field it likes.
 */
const GROUPS: ReadonlyArray<{ key: string; label: string; keys: readonly string[] }> = [
  { key: "person", label: "Person", keys: ["date_of_birth", "dob", "age", "gender", "state", "zip", "zip_code", "language", "tobacco", "tobacco_use", "height", "weight"] },
  { key: "contact", label: "Contact", keys: ["phone", "phone_number", "mobile", "alternate_phone", "email", "address", "address_line_1", "address_line_2", "city", "best_time_to_call"] },
  { key: "coverage", label: "Coverage", keys: ["coverage_amount", "face_amount", "premium", "monthly_premium", "term_length", "existing_coverage", "existing_carrier", "beneficiary_name", "beneficiary_relationship"] },
  { key: "notes", label: "Notes", keys: ["health_notes", "medications", "conditions", "notes", "comments", "additional_information"] },
];
const OTHER = { key: "other", label: "Other details" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_KEY = /(amount|premium|coverage|face|payout|benefit)/;
const PHONE_KEY = /(phone|mobile|tel)/;

/** `date_of_birth` → "Date of birth". Sentence case, the way every other label on the page reads. */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : key;
}

/**
 * One submitted value, formatted.
 *
 * Money: a template's amount is typed by a person in dollars, not stored in cents like the
 * `*_cents` columns, so 55000 is $55,000 — never `formatCentsAsCurrency`, which would read it as
 * $550.00 and quietly shrink a customer's coverage by a hundredfold.
 */
export function snapshotValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return Array.isArray(value) ? value.map((item) => snapshotValue(key, item)).join(", ") : JSON.stringify(value);
  const text = String(value).trim();
  if (text === "") return "—";
  if (text === "true" || text === "false") return text === "true" ? "Yes" : "No";
  if (ISO_DATE.test(text)) return dayMonthYear(text);
  if (PHONE_KEY.test(key)) {
    const digits = text.replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
    return text;
  }
  if (MONEY_KEY.test(key) && /^\d+(\.\d+)?$/.test(text)) {
    const amount = Number(text);
    return `$${amount.toLocaleString("en-US", { maximumFractionDigits: amount % 1 === 0 ? 0 : 2 })}`;
  }
  return text;
}

/** The submission, grouped and formatted. Empty groups are left out. */
export function snapshotFields(values: Record<string, unknown> | null | undefined): SnapshotGroup[] {
  const entries = Object.entries(values ?? {}).filter(([key]) => !HIDDEN.has(key.toLowerCase()));
  const taken = new Set<string>();
  const groups: SnapshotGroup[] = [];
  for (const group of GROUPS) {
    const fields: SnapshotField[] = [];
    for (const wanted of group.keys) {
      const found = entries.find(([key]) => key.toLowerCase() === wanted);
      if (!found || taken.has(found[0])) continue;
      taken.add(found[0]);
      fields.push({ key: found[0], label: humanise(found[0]), value: snapshotValue(found[0], found[1]) });
    }
    if (fields.length) groups.push({ key: group.key, label: group.label, fields });
  }
  const rest = entries.filter(([key]) => !taken.has(key));
  if (rest.length) groups.push({ ...OTHER, fields: rest.map(([key, value]) => ({ key, label: humanise(key), value: snapshotValue(key, value) })) });
  return groups;
}
