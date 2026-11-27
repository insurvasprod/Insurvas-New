import type { Tone } from "@/theme/tokens";

import type { CallbackItem, Complaint, ComplaintEvent, ConsentArtefact, LeadFunnelTotals, PersistencyAnswer, PreflightAnswer, PreflightCheck, ProducerScore, QualityRow, Ratio, RosterRow, Vault } from "./types";

/**
 * The Team, Reports and Compliance screens' words and figures, pure so the tests read the same rules the screens use.
 * Every rule here is the web's own (named beside it); nothing decides who may see what — the routes do.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

// ─── who sees money ───────────────────────────────────────────────────────────────────────────
/**
 * Money on these screens is the owner's (an admin carries the owner role) and the bookkeeper's. A manager runs people,
 * not money (owner rule): he gets the same lists in counts. Everyone else is refused by the routes themselves.
 */
export function seesMoney(me: { role: string; memberRole?: string | null } | null | undefined): boolean {
  if (!me || me.memberRole === "manager") return false;
  return me.role === "owner" || me.role === "bookkeeper";
}

/** "$14,920": whole dollars, never cents (owner rule for figures); "—" when unknown. */
export function wholeMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? "−" : ""}$${dollars.toLocaleString("en-US")}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

// ─── periods ──────────────────────────────────────────────────────────────────────────────────
export type PeriodKey = "week" | "month" | "quarter" | "year";
export type Period = { from: string; to: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The calendar week (Monday on), month, quarter or year that holds `now`, as YYYY-MM-DD days (the web's period picker). */
export function periodOf(key: PeriodKey, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === "week") {
    const start = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7));
    return { from: iso(start), to: iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)) };
  }
  if (key === "month") return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (key === "quarter") {
    const q = Math.floor(m / 3) * 3;
    return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** The period before: last week, last month, last quarter, last year. */
export function previousPeriod(key: PeriodKey, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === "week") return periodOf("week", new Date(y, m, now.getDate() - 7));
  if (key === "month") return periodOf("month", new Date(y, m - 1, 1));
  if (key === "quarter") return periodOf("quarter", new Date(y, m - 3, 1));
  return periodOf("year", new Date(y - 1, 0, 1));
}

/** How a change names its comparison (board I4: "every change names its comparison"): "October", "last week". */
export function comparisonName(key: PeriodKey, now = new Date()): string {
  if (key === "month") return LONG_MONTHS[(now.getMonth() + 11) % 12];
  return key === "week" ? "last week" : key === "quarter" ? "last quarter" : "last year";
}

/** "November", "this week", "Q4", "2026": the period in the card titles. */
export function periodName(key: PeriodKey, now = new Date()): string {
  if (key === "month") return LONG_MONTHS[now.getMonth()];
  if (key === "quarter") return `Q${Math.floor(now.getMonth() / 3) + 1}`;
  return key === "week" ? "this week" : String(now.getFullYear());
}

/** "9 Dec" / "9 Dec 2027" when the year is not this one. */
export function dayMonth(day: string | null | undefined, now = new Date()): string {
  if (!day) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const label = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return Number(m[1]) === now.getFullYear() ? label : `${label} ${m[1]}`;
}

/** "Mar 2025": a start or renewal far away. */
export function monthYear(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(day ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
}

/** "Thu 26 Nov". */
export function weekdayDate(at: string): string {
  const d = new Date(at);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Whole days from today to a calendar day (negative once it has passed). */
export function daysUntil(day: string, now = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return Number.NaN;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

/** A change as the board writes it: "↑ 18", "↓ 2.1", "Same as"; `unit` follows the number. */
export function change(now: number, before: number, digits = 0): { arrow: "↑" | "↓" | null; text: string } {
  const diff = now - before;
  const rounded = Number(Math.abs(diff).toFixed(digits));
  if (rounded === 0) return { arrow: null, text: "Same as" };
  return { arrow: diff > 0 ? "↑" : "↓", text: rounded.toLocaleString("en-US", { maximumFractionDigits: digits }) };
}

// ─── I1 · Team ────────────────────────────────────────────────────────────────────────────────
export type RankBy = "premium" | "issued" | "placement" | "submitted";

/** A placement text as a number for sorting: "82%" → 82, "2/3" → 66.7, "—" → -1. */
function placementValue(text: string): number {
  const pct = /^(\d+)%$/.exec(text);
  if (pct) return Number(pct[1]);
  const frac = /^(\d+)\/(\d+)$/.exec(text);
  if (frac && Number(frac[2]) > 0) return (100 * Number(frac[1])) / Number(frac[2]);
  return -1;
}

export function rankValue(row: ProducerScore, by: RankBy): number {
  if (by === "premium") return row.issuedAnnualCents ?? 0;
  if (by === "issued") return row.issued;
  if (by === "submitted") return row.submitted;
  return placementValue(row.placement);
}

/** Highest first, ties by name; `needle` keeps the names that contain it. */
export function rankProducers(rows: ProducerScore[], by: RankBy, needle = ""): ProducerScore[] {
  const n = needle.trim().toLowerCase();
  return rows
    .filter((r) => !n || r.name.toLowerCase().includes(n))
    .sort((a, b) => rankValue(b, by) - rankValue(a, by) || a.name.localeCompare(b.name));
}

/** The leader row's right-hand figure: money only for who sees money, else the count the ranking reads. */
export function rankFigure(row: ProducerScore, by: RankBy): string {
  if (by === "premium") return wholeMoney(row.issuedAnnualCents ?? 0);
  if (by === "placement") return row.placement;
  if (by === "submitted") return `${row.submitted} apps`;
  return `${row.issued} issued`;
}

/** Agency placement over every row shown: placed of issued, a percent (a count under the sample size). */
export function agencyPlacement(rows: ProducerScore[], minSample: number): string {
  const issued = rows.reduce((s, r) => s + r.issued, 0);
  const placed = rows.reduce((s, r) => s + r.placed, 0);
  if (!issued) return "—";
  if (issued < minSample) return `${placed}/${issued}`;
  return `${Math.round((100 * placed) / issued)}%`;
}

// ─── I2 · Producer ────────────────────────────────────────────────────────────────────────────
export type LicenceLine = { key: string; title: string; meta: string; chip: { tone: Tone; text: string } };

/** The chip a renewal date earns: expired (bad), inside 30 days (warn, "15 days"), else Active (ok). */
export function renewalChip(day: string, now = new Date()): { tone: Tone; text: string } {
  const left = daysUntil(day, now);
  if (left < 0) return { tone: "bad", text: "Expired" };
  if (left <= 30) return { tone: "warn", text: left === 1 ? "1 day" : `${left} days` };
  return { tone: "ok", text: "Active" };
}

/** A renewal as the row's words: "renews 9 Dec" this year, "renews Aug 2027" further out. */
export function renewsText(day: string, now = new Date()): string {
  const left = daysUntil(day, now);
  if (left < 0) return `lapsed ${dayMonth(day, now)}`;
  return left <= 60 ? `renews ${dayMonth(day, now)}` : `renews ${monthYear(day)}`;
}

/** Appointments by carrier: active ones as "Appointed in N states", pending ones as "Sent 12 Nov · TX, GA". */
export function appointmentLines(rows: { carrierName: string; appointments: { state: string; status: string; effectiveFrom?: string | null }[] }[]): LicenceLine[] {
  const out: LicenceLine[] = [];
  for (const r of rows) {
    const active = r.appointments.filter((a) => a.status === "appointed" || a.status === "active");
    const pending = r.appointments.filter((a) => a.status === "pending");
    if (active.length) out.push({ key: `${r.carrierName}:a`, title: r.carrierName, meta: `${active.length} ${active.length === 1 ? "state" : "states"}`, chip: { tone: "ok", text: "Appointed" } });
    else if (pending.length) {
      const sent = pending.map((a) => a.effectiveFrom).filter(Boolean).sort()[0];
      out.push({ key: `${r.carrierName}:p`, title: r.carrierName, meta: [sent ? `Sent ${dayMonth(sent)}` : null, pending.map((a) => a.state).join(", ")].filter(Boolean).join(" · "), chip: { tone: "info", text: "Pending" } });
    }
  }
  return out;
}

/** I7 · the vault's appointments grouped by carrier, named from the vault's carrier list. Terminated ones are left out. */
export function vaultAppointments(vault: Vault): LicenceLine[] {
  const names = new Map(vault.carriers.map((c) => [c.id, c.name]));
  const by = new Map<string, { carrierName: string; appointments: { state: string; status: string; effectiveFrom: string }[] }>();
  for (const a of vault.appointments) {
    if (a.status === "terminated") continue;
    const name = names.get(a.carrier_id) ?? "Carrier";
    if (!by.has(a.carrier_id)) by.set(a.carrier_id, { carrierName: name, appointments: [] });
    by.get(a.carrier_id)!.appointments.push({ state: a.state, status: a.status, effectiveFrom: a.effective_from });
  }
  return appointmentLines([...by.values()].sort((a, b) => a.carrierName.localeCompare(b.carrierName)));
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
export const stateName = (code: string) => STATE_NAMES[code] ?? code;

/** I7 · the agency's licences, soonest renewal first. */
export function licenceLines(vault: Vault, now = new Date()): LicenceLine[] {
  return [...vault.licenses]
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
    .map((l) => {
      const kind = l.licence_type === "resident" ? "Resident" : l.licence_type === "non_resident" ? "Non-resident" : null;
      const renews = renewsText(l.expires_at, now);
      return { key: l.id, title: stateName(l.state), meta: kind ? `${kind} · ${renews}` : renews[0].toUpperCase() + renews.slice(1), chip: renewalChip(l.expires_at, now) };
    });
}

/** I2 / I7 · a person's state licences that lapse inside `days` (the Team page's 60-day horizon), soonest first. */
export function expiringStates(expiries: Record<string, string> | undefined, now = new Date(), days = 60): { state: string; on: string }[] {
  return Object.entries(expiries ?? {})
    .filter(([, on]) => daysUntil(on, now) <= days)
    .map(([state, on]) => ({ state, on }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

// ─── I4 · Sales performance ───────────────────────────────────────────────────────────────────
export type FunnelStep = { key: string; label: string; count: number; pct: number | null };

/** From quote to issue, each step's share of the quoted (the board's percentages run against the first step). */
export function funnelSteps(f: { quoted: number; applied: Ratio; submitted: Ratio; issued: Ratio }): FunnelStep[] {
  const base = f.quoted;
  const pct = (n: number) => (base > 0 ? Math.round((1000 * n) / base) / 10 : null);
  return [
    { key: "quoted", label: "Quoted", count: f.quoted, pct: null },
    { key: "applied", label: "Applied", count: f.applied.n, pct: pct(f.applied.n) },
    { key: "submitted", label: "Submitted", count: f.submitted.n, pct: pct(f.submitted.n) },
    { key: "issued", label: "Issued", count: f.issued.n, pct: pct(f.issued.n) },
  ];
}

/** A running total, so a period's sparkline climbs the way the month did. */
export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v));
}

// ─── I4b · Team activity ──────────────────────────────────────────────────────────────────────
/** Contacts are dials times the contact rate, as the web works them out (lib/activityLog/types.ts contactsOf). */
export function contactsOf(row: { clicked: number; contact_rate_percent: number | null }): number {
  return Math.round(((Number(row.clicked) || 0) * (Number(row.contact_rate_percent) || 0)) / 100);
}

/** The window as the activity route reads it: from midnight today, Monday or the 1st, to now. */
export function activityWindow(key: "today" | "week" | "month", now = new Date()): { from: string; to: string } {
  const start = key === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : key === "week" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: start.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() };
}

// ─── I4c · Retention scorecard ────────────────────────────────────────────────────────────────
/** The save rate as the web writes it: a percent over 10 decided, else "3 of 5 saved"; "—" with none decided. */
export function rateText(l: { saved: number; lost: number; rate: number | null }): string {
  if (l.saved + l.lost === 0) return "—";
  return l.rate === null ? `${l.saved} of ${l.saved + l.lost} saved` : `${Math.round(l.rate * 100)}%`;
}

// ─── I4d · Callbacks kept ─────────────────────────────────────────────────────────────────────
/** The callbacks report's rule (lib/reports/callbackResultsCore.ts): completed is kept, cancelled, missed, else open. */
export function callbackOutcome(c: Pick<CallbackItem, "status" | "missedAt">): "kept" | "missed" | "cancelled" | "open" {
  if (c.status === "completed") return "kept";
  if (c.status === "cancelled") return "cancelled";
  if (c.status === "missed" || c.missedAt) return "missed";
  return "open";
}

export const KEEP_MIN_DECIDED = 5;
export type KeptWeek = { key: string; label: string; kept: number; missed: number; booked: number; rate: number | null };

/** Monday (local) of the week a time falls in. */
function mondayOf(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() - ((at.getDay() + 6) % 7));
}

/** The last `weeks` weeks, oldest first, each with its kept and missed callbacks (by the day each was due). */
export function keptWeeks(items: CallbackItem[], now = new Date(), weeks = 8): KeptWeek[] {
  const thisMonday = mondayOf(now);
  const out: KeptWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7 * i);
    out.push({ key: iso(start), label: i === 0 ? "This wk" : "", kept: 0, missed: 0, booked: 0, rate: null });
  }
  for (const c of items) {
    const key = iso(mondayOf(new Date(c.scheduledAtUtc)));
    const w = out.find((x) => x.key === key);
    if (!w) continue;
    w.booked += 1;
    const o = callbackOutcome(c);
    if (o === "kept") w.kept += 1;
    else if (o === "missed") w.missed += 1;
  }
  for (const w of out) w.rate = w.kept + w.missed > 0 ? Math.round((100 * w.kept) / (w.kept + w.missed)) : null;
  return out;
}

/** Kept of kept and missed over the weeks: a whole percent, or null under five decided (the report's small-sample rule). */
export function keepRate(weeks: { kept: number; missed: number }[]): { rate: number | null; kept: number; decided: number } {
  const kept = weeks.reduce((s, w) => s + w.kept, 0);
  const decided = kept + weeks.reduce((s, w) => s + w.missed, 0);
  return { rate: decided >= KEEP_MIN_DECIDED ? Math.round((100 * kept) / decided) : null, kept, decided };
}

/** This week's missed callbacks, latest first. */
export function missedThisWeek(items: CallbackItem[], now = new Date()): CallbackItem[] {
  const from = mondayOf(now).getTime();
  return items
    .filter((c) => callbackOutcome(c) === "missed" && Date.parse(c.scheduledAtUtc) >= from)
    .sort((a, b) => b.scheduledAtUtc.localeCompare(a.scheduledAtUtc));
}

/** "2 h late, still open" / "1 day late" / "not called": how late a missed callback is, from when it was due. */
export function lateText(c: CallbackItem, now = new Date()): string {
  const h = Math.max(0, Math.floor((now.getTime() - Date.parse(c.scheduledAtUtc)) / 3_600_000));
  if (h < 1) return "due just now";
  if (h < 24) return `${h} h late`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day late" : `${d} days late`;
}

// ─── I4e · Partner quality ────────────────────────────────────────────────────────────────────
/** Submitted per 100 leads sent, one decimal; null with nothing sent. */
export function per100(submitted: number, sent: number): number | null {
  return sent > 0 ? Math.round((1000 * submitted) / sent) / 10 : null;
}

/**
 * The partners that sent leads, best first. "Best" goes to the top one only when it sent enough to mean something
 * (20 leads); "Many returns" when a tenth or more of what it sent was disqualified. Never spend: this is the
 * cost-free view, kept apart from True CPA on purpose.
 */
export function qualityRows(rows: QualityRow[]): { row: QualityRow; per100: number; chip: { tone: Tone; text: string } | null }[] {
  const sent = rows.filter((r) => r.sent > 0).map((r) => ({ row: r, per100: per100(r.submitted, r.sent) ?? 0 }));
  sent.sort((a, b) => b.per100 - a.per100 || b.row.sent - a.row.sent);
  return sent.map((x, i) => {
    const manyReturns = x.row.sent >= 10 && x.row.disqualified / x.row.sent >= 0.1;
    const chip = manyReturns ? { tone: "warn" as Tone, text: "Many returns" } : i === 0 && x.row.sent >= 20 && x.per100 > 0 ? { tone: "gold" as Tone, text: "Best" } : null;
    return { ...x, chip };
  });
}

// ─── I5 · Check a number ──────────────────────────────────────────────────────────────────────
export type CheckVerdict = { title: string; chip: { tone: Tone; text: string }; checks: PreflightCheck[]; message: string | null };

/** The preflight's answer (or its refusal) as the card: a refusal is "Don't call", a vendor that could not answer is "Can't confirm". */
export function checkVerdict(answer: PreflightAnswer, status: number): CheckVerdict {
  const checks = answer.checks ?? [];
  if (answer.ok) return { title: "Clear to call", chip: { tone: "ok", text: "Clear" }, checks, message: answer.message ?? null };
  if (status === 503) return { title: "Can’t confirm this number yet", chip: { tone: "warn", text: "Not verified" }, checks, message: answer.error ?? null };
  return { title: "Don’t call this number", chip: { tone: "bad", text: "Blocked" }, checks, message: answer.error ?? null };
}

/** A check's mark: green tick, red cross, or a grey clock for what could not be decided. */
export function checkMark(c: PreflightCheck): "ok" | "bad" | "open" {
  if (c.tone === "success") return "ok";
  if (c.tone === "error" || c.refuses) return "bad";
  return "open";
}

export function phoneDigits(text: string): string {
  return text.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

// ─── I5b · Consent ────────────────────────────────────────────────────────────────────────────
/** A certificate's state as the locker words it: only a claimed copy is consent on file; a link alone is pending. */
export function consentChip(status: ConsentArtefact["status"]): { tone: Tone; text: string } {
  if (status === "claimed") return { tone: "ok", text: "Consent on file" };
  // Short enough for a row's right edge; the card's rows say the rest.
  if (status === "pending") return { tone: "info", text: "Not claimed" };
  if (status === "expired") return { tone: "warn", text: "Expired" };
  return { tone: "bad", text: "Claim failed" };
}

/** "18 Nov 2026, 3:42 pm": when consent was given (else captured). */
export function givenText(at: string | null | undefined): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "9a1f…22c0": a long certificate id cut to its two ends. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

// ─── I6 · Complaints ──────────────────────────────────────────────────────────────────────────
/** The countdown's chip (the web's countdown tones): overdue and the red window warm, a calm deadline blue. */
export function countdownChip(c: Complaint["countdown"]): { tone: Tone; text: string } {
  // A chip has a row's right edge only: "23 days late", never the web's longer sentence (cut off on a phone).
  if (c.tone === "overdue") return { tone: "bad", text: typeof c.daysLeft === "number" ? (c.daysLeft === -1 ? "1 day late" : `${Math.abs(c.daysLeft)} days late`) : "Late" };
  if (c.tone === "red" || c.tone === "amber") return { tone: "warn", text: c.daysLeft === 1 ? "1 day left" : `${c.daysLeft} days left` };
  if (c.tone === "calm") return { tone: "info", text: `${c.daysLeft} days left` };
  return { tone: "neutral", text: "No deadline" };
}

export const isClosed = (c: Pick<Complaint, "status">) => c.status === "resolved";

/** Open ones soonest deadline first (no deadline last); closed ones newest first. */
export function splitComplaints(list: Complaint[]): { open: Complaint[]; closed: Complaint[] } {
  const left = (c: Complaint) => c.countdown.daysLeft ?? Number.POSITIVE_INFINITY;
  return {
    open: list.filter((c) => !isClosed(c)).sort((a, b) => left(a) - left(b) || a.receivedAt.localeCompare(b.receivedAt)),
    closed: list.filter(isClosed).sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
  };
}

export function complaintWho(c: Pick<Complaint, "complainantName" | "phoneDigits">): string {
  if (c.complainantName?.trim()) return c.complainantName.trim();
  const d = c.phoneDigits ?? "";
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d || "Unnamed complainant";
}

const CHANNEL: Record<string, string> = { agent: "To the agent", carrier: "Through the carrier", doi: "State insurance department", ftc: "FTC", other: "Other" };
const VIA: Record<string, string> = { phone: "By phone", email: "By email", letter: "By letter", portal: "Through a portal", carrier_notice: "Carrier notice" };
export const channelLabel = (c: Pick<Complaint, "channel" | "regulatorState">) => (c.channel === "doi" && c.regulatorState ? `${c.regulatorState} insurance department` : CHANNEL[c.channel] ?? c.channel);
export const viaLabel = (v: string) => VIA[v] ?? v;

/** The countdown ring: the share of the response time still left (full on the day it came in, empty when due). */
export function countdownShare(c: Pick<Complaint, "receivedAt" | "responseDueAt">, now = new Date()): number {
  if (!c.responseDueAt) return 0;
  const total = Date.parse(c.responseDueAt) - Date.parse(c.receivedAt);
  const left = Date.parse(c.responseDueAt) - now.getTime();
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * left) / total)));
}

/** The complaint's log, from the facts the record keeps (the web keeps no separate event list): oldest first. */
export function complaintLog(c: Complaint): { key: string; icon: "inbox" | "ban" | "send" | "checkC"; title: string; meta: string }[] {
  const log: { key: string; icon: "inbox" | "ban" | "send" | "checkC"; title: string; meta: string; at: string }[] = [
    { key: "in", icon: "inbox", title: `Received · owner ${c.owner.name}`, meta: `${dayMonth(c.receivedAt.slice(0, 10))} · ${viaLabel(c.receivedVia).toLowerCase()}`, at: c.receivedAt },
  ];
  if (c.dncAddedAt) log.push({ key: "dnc", icon: "ban", title: "Number put on the do-not-call list", meta: dayMonth(c.dncAddedAt.slice(0, 10)), at: c.dncAddedAt });
  if (c.respondedAt) log.push({ key: "reply", icon: "send", title: "Reply logged", meta: [dayMonth(c.respondedAt.slice(0, 10)), c.responseText?.trim() ? c.responseText.trim() : null].filter(Boolean).join(" · "), at: c.respondedAt });
  if (c.resolvedAt) log.push({ key: "done", icon: "checkC", title: "Resolved", meta: dayMonth(c.resolvedAt.slice(0, 10)), at: c.resolvedAt });
  return log.sort((a, b) => a.at.localeCompare(b.at)).map((e) => ({ key: e.key, icon: e.icon, title: e.title, meta: e.meta }));
}

// ─── I8 · Partner ─────────────────────────────────────────────────────────────────────────────
const PAYOUT: Record<string, string> = {
  per_submitted_application: "Per submitted application", per_transfer: "Per transfer", per_lead: "Per lead", per_sale: "Per sale", per_issued_policy: "Per issued policy", revenue_share: "Revenue share",
};
export const payoutLabel = (model: string) => PAYOUT[model] ?? model;
const PARTNER_TYPE: Record<string, string> = { publisher: "Publisher", marketing: "Marketing partner", affiliate: "Affiliate" };
export const partnerTypeLabel = (t: string) => PARTNER_TYPE[t] ?? t;

/** The deal's rate as words: "$95" a unit, "10%" a share. */
export function rateLabel(term: { rate_cents: number | null; rate_pct_bp: number | null }): string {
  if (term.rate_cents !== null) return wholeMoney(term.rate_cents);
  if (term.rate_pct_bp !== null) return `${(term.rate_pct_bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  return "—";
}

// ─── I1 · teams ───────────────────────────────────────────────────────────────────────────────
export type TeamPick = { key: string; label: string; members: Set<string> };

/**
 * The team picker (board I1 "All 18 ▾"): everyone, then one team per manager — the manager and the producers who
 * report to him on the agency's roster (managerProducerId). A roster without managers gives no teams.
 */
export function teamPicks(roster: RosterRow[]): TeamPick[] {
  const byProducer = new Map(roster.map((r) => [r.id, r]));
  const teams = new Map<string, Set<string>>();
  for (const r of roster) {
    if (!r.managerProducerId || !byProducer.has(r.managerProducerId)) continue;
    const set = teams.get(r.managerProducerId) ?? new Set<string>([byProducer.get(r.managerProducerId)!.userId]);
    set.add(r.userId);
    teams.set(r.managerProducerId, set);
  }
  return [...teams.entries()]
    .map(([id, members]) => {
      const first = (byProducer.get(id)!.displayName.trim().split(/\s+/)[0] ?? "").replace(/^./, (c) => c.toUpperCase());
      return { key: id, label: `${first}’s team`, members };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── I2 · goal ────────────────────────────────────────────────────────────────────────────────
/** The day the running total of issued premium first reached the goal (board I2 "Goal passed on 19 Nov"), else null. */
export function goalPassedOn(days: [string, number][] | undefined, target: number | null): string | null {
  if (!days?.length || !target || target <= 0) return null;
  let sum = 0;
  for (const [day, cents] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) {
    sum += cents;
    if (sum >= target) return day;
  }
  return null;
}

// ─── I3 · Book scorecards ─────────────────────────────────────────────────────────────────────
/**
 * The 13-month persistency card (board I3): the book's 13-month rate now, against the newest issue quarter old
 * enough to have one compared with the quarter before it, and a sparkline of each quarter's 13-month rate.
 * Null rate while no policy is 13 months old.
 */
export function persistencyCard(report: PersistencyAnswer["report"]): { rate: number | null; eligible: number; quarters: number[]; change: { arrow: "↑" | "↓" | null; text: string } | null } {
  const at13 = (cells: { month: number; rate: number | null; eligible: number }[]) => cells.find((c) => c.month === 13) ?? null;
  const overall = at13(report.overall);
  const quarters = [...report.byCohort].reverse().map((r) => at13(r.cells)?.rate).filter((r): r is number => typeof r === "number").map((r) => Math.round(r * 1000) / 10);
  const last = quarters[quarters.length - 1];
  const before = quarters[quarters.length - 2];
  return {
    rate: overall?.rate ?? null,
    eligible: overall?.eligible ?? 0,
    quarters,
    change: last !== undefined && before !== undefined ? change(last, before, 1) : null,
  };
}

// ─── I4 · From lead to policy ─────────────────────────────────────────────────────────────────
/** The scorecard's figure each bar opens (GET /api/app/true-cpa/leads?stage=). */
export type LeadStage = "received" | "contacted" | "quoted" | "applied" | "issued";
export type LeadStep = { key: LeadStage; label: string; count: number; pct: number | null };

/**
 * Leads, Contacted, Quoted, Applied, Issued (board I4) from the lead scorecard's totals, each a share of the leads
 * (one decimal under 10%). A step the scorecard cannot count yet (quoted before its update) is left out.
 */
export function leadFunnelSteps(t: LeadFunnelTotals): LeadStep[] {
  const base = t.leads_received;
  const pct = (n: number) => (base > 0 ? (n * 100) / base : null);
  const round = (v: number | null) => (v === null ? null : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
  const steps: LeadStep[] = [
    { key: "received", label: "Leads", count: base, pct: null },
    { key: "contacted", label: "Contacted", count: t.contacted_leads, pct: round(pct(t.contacted_leads)) },
  ];
  if (t.quoted_leads !== null) steps.push({ key: "quoted", label: "Quoted", count: t.quoted_leads, pct: round(pct(t.quoted_leads)) });
  const applied = t.applied_leads ?? t.applications;
  steps.push({ key: "applied", label: "Applied", count: applied, pct: round(pct(applied)) });
  steps.push({ key: "issued", label: "Issued", count: t.issued_policies, pct: round(pct(t.issued_policies)) });
  return steps;
}

// ─── I6b · the complaint's history ────────────────────────────────────────────────────────────
const FIELD_WORDS: Record<string, string> = { status: "status", outcome: "outcome", notes: "notes", checklist: "checklist", regulator_state: "regulator", responded_at: "reply date" };

/** One audit entry as a log row (board I6b "Assigned to Tom Baker · Dana · 20 Nov"): what happened, by whom, when. */
export function historyLine(e: ComplaintEvent, now = new Date()): { key: string; icon: "inbox" | "userPlus" | "send" | "clock" | "note"; title: string; meta: string } {
  const who = e.by ? e.by.trim().split(/\s+/)[0] : "Someone";
  const meta = `${who} · ${dayMonth(e.at.slice(0, 10), now)}`;
  const key = `${e.at}:${e.action}`;
  if (e.action === "opened") return { key, icon: "inbox", title: "Recorded", meta };
  if (e.action === "deadline_set") return { key, icon: "clock", title: "Regulator deadline set", meta };
  if (e.fields.includes("owner_user_id")) return { key, icon: "userPlus", title: "Reassigned", meta };
  if (e.fields.includes("response_text")) return { key, icon: "send", title: "Reply logged", meta };
  const words = e.fields.map((f) => FIELD_WORDS[f]).filter(Boolean);
  return { key, icon: "note", title: words.length ? `Changed ${words.join(", ")}` : "Updated", meta };
}

// ─── I7 · your own licences ───────────────────────────────────────────────────────────────────
/** A person's licensed states as rows, soonest renewal first (no date last): "Texas", "Renews 9 Dec", the chip. */
export function ownLicenceLines(rows: { state: string; expiresOn: string | null }[], now = new Date()): LicenceLine[] {
  return [...rows]
    .sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") || a.state.localeCompare(b.state))
    .map((l) => {
      if (!l.expiresOn) return { key: l.state, title: stateName(l.state), meta: "No renewal date recorded", chip: { tone: "ok" as Tone, text: "Licensed" } };
      const renews = renewsText(l.expiresOn, now);
      return { key: l.state, title: stateName(l.state), meta: renews[0].toUpperCase() + renews.slice(1), chip: renewalChip(l.expiresOn, now) };
    });
}
