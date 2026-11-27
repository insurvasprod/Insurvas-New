import type { Tone } from "@/theme/tokens";

import type { BreakdownLine, ChatEntry, ChatMessage, Directory, PartnerLeadRow, PartnerMe, PartnerType, PayoutRun, TemplateField } from "./types";

/**
 * The partner app's rules, pure so the tests read the same rules the screens use. Where the web has the
 * rule (lib/partnerAuth/portalAccess.ts, lib/partnerLeads/lanes.ts, lib/consent/capture.ts) it is copied
 * here word for word in meaning, and named; the phone decides nothing the server does not decide again.
 */

// ─── which pages a partner gets (lib/partnerAuth/portalAccess.ts) ────────────────────────────────
export type PartnerPage = "submit" | "refer" | "pipeline" | "links" | "messages" | "statements" | "team";
const BY_TYPE: Record<PartnerType, ReadonlySet<PartnerPage>> = {
  publisher: new Set(["submit", "pipeline", "messages", "statements", "team"]),
  marketing: new Set(["refer", "submit", "pipeline", "messages", "statements", "team"]),
  affiliate: new Set(["links", "pipeline", "refer", "messages", "statements"]),
};
const ADMIN_ONLY: ReadonlySet<PartnerPage> = new Set(["statements", "team"]);

export function pageAllowed(page: PartnerPage, me: Pick<PartnerMe, "partnerType" | "role" | "hasTeam">): boolean {
  if (ADMIN_ONLY.has(page) && me.role !== "partner_admin") return false;
  if (BY_TYPE[me.partnerType]?.has(page)) return true;
  // An affiliate with more than one person gets Team access back (portalAccess.ts AFFILIATE_TEAM_PAGES).
  return me.partnerType === "affiliate" && me.hasTeam && page === "team";
}

/**
 * How the Send tab sends: a call centre (publisher) sends the agency's partner template, which may be a
 * live transfer; marketing and affiliate partners send the short referral (name, phone, state, product).
 */
export function sendMode(type: PartnerType): "template" | "referral" {
  return type === "publisher" ? "template" : "referral";
}

/** The Send tab's words: an affiliate refers someone (PARTNER_WORDS), everyone else sends a lead. */
export function sendLabel(type: PartnerType): string {
  return type === "affiliate" ? "Refer someone" : "Send a lead";
}

/** "Referrals" for an affiliate, "Pipeline" otherwise (PARTNER_WORDS.pipelineTitle, the phone's short form). */
export function pipelineLabel(type: PartnerType): string {
  return type === "affiliate" ? "Referrals" : "Pipeline";
}

// ─── dates ───────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** This month from its first day, and the whole of last month, as the pipeline's date filter takes them. */
export function monthRange(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevLast = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: ymd(first), prevFrom: ymd(prevFirst), prevTo: ymd(prevLast), month: MONTH_NAMES[now.getMonth()], prevMonth: MONTH_NAMES[prevFirst.getMonth()] };
}

/** The clock, read in an event handler (kept out of render, where React wants no impure calls). */
export const nowMs = () => Date.now();

/** "today", "yesterday" or "21 Nov". */
export function dayWords(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (ymd(d) === ymd(now)) return "today";
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (ymd(d) === ymd(y)) return "yesterday";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "2:09 pm". */
export function clock(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "am" : "pm"}`;
}

/** "October 2026" — a statement is named by the month its period starts in. */
export function monthTitle(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : iso;
}

// ─── the home's figures ──────────────────────────────────────────────────────────────────────────
/** Queue statuses in which the agency never took the lead (lib/partnerLeads/lanes.ts: unclaimed, expired). */
const NOT_TAKEN = new Set(["unclaimed", "expired"]);
/** Dispositions that mean the lead became business (lanes.ts SALE_DISPOSITIONS). */
const SALES = new Set(["application_submitted", "sold", "issued", "converted"]);

export function isSold(row: Pick<PartnerLeadRow, "stageType" | "disposition" | "lane">): boolean {
  return row.stageType === "won" || row.lane === "converted" || (row.disposition !== null && SALES.has(row.disposition));
}

/**
 * Sent, accepted and sold this month, from the month's rows. Accepted counts what the agency took (any
 * status but unclaimed or expired). `complete` is false when the page holds fewer rows than the total,
 * so the screen shows only Sent rather than a share of a part.
 */
export function homeFigures(rows: PartnerLeadRow[], total: number, prevTotal: number | null) {
  const accepted = rows.filter((r) => !NOT_TAKEN.has(r.status)).length;
  const sold = rows.filter(isSold).length;
  return {
    sent: total,
    rise: prevTotal === null ? null : total - prevTotal,
    accepted,
    acceptedPct: total ? Math.round((accepted / total) * 100) : 0,
    sold,
    per100: total ? Math.round((sold / total) * 1000) / 10 : 0,
    complete: rows.length >= total,
  };
}

/** The one chip on a lead: the partner's own stage name, toned by what it means. */
export function leadChip(row: Pick<PartnerLeadRow, "stageName" | "stageType" | "lane" | "status" | "disposition" | "live">): { tone: Tone; label: string } {
  if (row.lane === "verification") return { tone: "info", label: "On a call" };
  if (isSold(row)) return { tone: "ok", label: row.stageName };
  if (row.stageType === "lost") return { tone: "bad", label: row.stageName };
  // A booked callback is the thing to know about a lead still being worked (board K3 "Callback").
  if (row.live?.callbackAt) return { tone: "info", label: "Callback" };
  // Waiting for the agency to take it, or nobody claimed it before the window (the server's own words).
  if (row.status === "unclaimed" || row.status === "expired") return { tone: "warn", label: row.stageName };
  return { tone: "info", label: row.stageName };
}

/** "Sent 21 Nov · wrong number": when it was sent, and the agency's coded outcome when there is one. */
export function leadMeta(row: Pick<PartnerLeadRow, "submittedAt" | "outcome">, now = new Date()): string {
  const sent = `Sent ${dayWords(row.submittedAt, now)}`;
  return row.outcome ? `${sent} · ${row.outcome}` : sent;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri" for a day in the coming week, "today", "tomorrow", else "28 Nov" (board K3 "Callback Fri"). */
export function soonWords(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(d) - start(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The live line under a lead (board K1 "Latest", K3 rows), from the server's own facts only:
 *   on a call      K1 "Transferred 2:09 pm · Jordan took it" · K3 "On a call with Jordan · 2:09 pm"
 *   callback       "Callback Fri"
 *   applied        "Applied · at the carrier" (the agency's application_submitted outcome)
 *   waiting        "agency is reviewing" (the queue item is unclaimed: no agent has taken it yet)
 *   an outcome     K1 "Sent 20 Nov · returned: wrong number" · K3 "Contacted · interested"
 * The agent is named by first name only, as the server sends it.
 */
export function liveMeta(row: PartnerLeadRow, where: "home" | "pipeline", now = new Date()): string {
  const sent = `Sent ${dayWords(row.submittedAt, now)}`;
  const live = row.live;
  if (row.lane === "verification") {
    const at = live?.claimedAt ? clock(live.claimedAt) : null;
    if (where === "home") return at ? `Transferred ${at}${live?.claimedBy ? ` · ${live.claimedBy} took it` : ""}` : sent;
    return `On a call${live?.claimedBy ? ` with ${live.claimedBy}` : ""}${at ? ` · ${at}` : ""}`;
  }
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  if (where === "home") {
    if (row.status === "unclaimed") return `${sent} · agency is reviewing`;
    if (row.outcome) return `${sent} · ${row.stageType === "lost" ? `${lower(row.stageName)}: ` : ""}${lower(row.outcome)}`;
    return sent;
  }
  if (!isSold(row) && row.stageType !== "lost" && live?.callbackAt) return `Callback ${soonWords(live.callbackAt, now)}`;
  if (row.disposition === "application_submitted") return "Applied · at the carrier";
  if (row.status === "unclaimed") return "Agency is reviewing";
  if (row.outcome) return `${row.stageName} · ${lower(row.outcome)}`;
  return sent;
}

/** The newest first. */
export function newestFirst<T extends { submittedAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

// ─── the pipeline (board K3: the partner's own stages only) ─────────────────────────────────────
export type PipelineFilter = "all" | "open" | "won" | "lost" | "returned";
export const PIPELINE_FILTERS: { key: PipelineFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "open", label: "Working" }, { key: "won", label: "Sold" }, { key: "lost", label: "Not sold" }, { key: "returned", label: "Returned" },
];

/**
 * "Returned" is the partner's own closed stage of that name (board K3), when the agency's pipeline for
 * this partner type has one: there is no separate returns record, so the chip follows the stage and is
 * offered only when such a stage exists. Not sold then means the other closed stages.
 */
const RETURNED = /^returned\b/i;
export const isReturnedStage = (stage: { stageType: string; name?: string; stageName?: string }) => stage.stageType === "lost" && RETURNED.test((stage.name ?? stage.stageName ?? "").trim());

export function inFilter(row: PartnerLeadRow, filter: PipelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "won") return isSold(row);
  if (filter === "returned") return !isSold(row) && isReturnedStage(row);
  if (filter === "lost") return row.stageType === "lost" && !isSold(row) && !isReturnedStage(row);
  return row.stageType !== "lost" && !isSold(row);
}

/** Counts per filter from the partner's own stages (the server counts every lead, not just the page). */
export function filterCounts(stages: { stageType: string; leadCount: number; isArchived: boolean; name?: string }[], total: number): Record<PipelineFilter, number> {
  const sum = (list: typeof stages) => list.reduce((n, s) => n + (s.leadCount || 0), 0);
  return {
    all: total,
    open: sum(stages.filter((s) => s.stageType === "open")),
    won: sum(stages.filter((s) => s.stageType === "won")),
    lost: sum(stages.filter((s) => s.stageType === "lost" && !isReturnedStage(s))),
    returned: sum(stages.filter((s) => isReturnedStage(s))),
  };
}

/** The filter chips this partner's stages support: Returned only when its pipeline has that stage. */
export function pipelineFilters(stages: { stageType: string; name?: string }[]) {
  const returned = stages.some((s) => isReturnedStage(s));
  return PIPELINE_FILTERS.filter((f) => f.key !== "returned" || returned);
}

/** Search the page by the customer's name. */
export function matches(row: PartnerLeadRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || row.customer.toLowerCase().includes(s);
}

// ─── statements ──────────────────────────────────────────────────────────────────────────────────
/** What is owed next: the newest statement published and not yet paid. */
export function nextPayout(runs: PayoutRun[]): PayoutRun | null {
  return runs.find((r) => r.status === "published") ?? null;
}

/** "5 Dec" for an ISO day (no time zone shift: the server sends a plain date). */
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : day;
}

const NOUNS: Record<string, [string, string]> = {
  sale: ["sold lead", "sold leads"],
  transfer: ["transfer", "transfers"],
  lead: ["lead", "leads"],
  submitted_application: ["application", "applications"],
  issued_policy: ["issued policy", "issued policies"],
};
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** "41 sold leads × $95 + 12 transfers × $35" from the statement's per-unit lines (board K4). */
export function breakdownText(lines: BreakdownLine[], revenueShareCents: number | null = null): string | null {
  const parts = lines.filter((l) => NOUNS[l.itemType]).map((l) => `${l.count.toLocaleString()} ${NOUNS[l.itemType][l.count === 1 ? 0 : 1]} × ${dollars(l.rateCents)}`);
  if (revenueShareCents) parts.push(`${dollars(revenueShareCents)} revenue share`);
  return parts.length ? parts.join(" + ") : null;
}

export function runMeta(run: PayoutRun): string {
  return run.status === "paid" ? (run.paidOn ? `Paid ${dayWords(run.paidOn)}` : "Paid") : "Published · not paid yet";
}

// ─── consent proof (board K2: proof, never a bare checkbox) ─────────────────────────────────────
export type ConsentKind = "certificate" | "verbal";

const TRUSTEDFORM_URL = /^https?:\/\/(?:cert\.|www\.)?trustedform\.com\/[0-9a-f]{20,}/i;
const CERT_ID = /^[0-9a-f]{40}$/i;
const JORNAYA = /^[A-Za-z0-9-]{8,128}$/;

/**
 * Whether the proof can stand behind the partner's consent attestation: a TrustedForm certificate (its URL
 * or id) or a Jornaya LeadiD token (lib/consent/capture.ts reads the same shapes), or, for a recorded
 * verbal, the recording's reference. Null when it can; the words to show when it cannot.
 */
export function consentProblem(kind: ConsentKind, value: string): string | null {
  const v = value.trim();
  if (kind === "certificate") {
    if (!v) return "Paste the TrustedForm certificate or the Jornaya LeadiD.";
    return TRUSTEDFORM_URL.test(v) || CERT_ID.test(v) || JORNAYA.test(v) ? null : "That doesn’t look like a certificate ID.";
  }
  return v.length >= 3 ? null : "Name the call recording where they agreed.";
}

/** "TrustedForm · 7f3c…a19e" — the proof as the field shows it once entered. */
export function consentShort(value: string): string {
  const v = value.trim();
  const id = v.replace(/^https?:\/\/(?:cert\.|www\.)?trustedform\.com\//i, "").split(/[/?#]/)[0];
  const provider = TRUSTEDFORM_URL.test(v) || CERT_ID.test(v) ? "TrustedForm" : "LeadiD";
  return id.length > 10 ? `${provider} · ${id.slice(0, 4)}…${id.slice(-4)}` : `${provider} · ${id}`;
}

/** Template keys that hold a consent certificate (lib/consent/capture.ts CONSENT_COLUMN_ALIASES). */
const CONSENT_KEYS = new Set(["xxtrustedformcerturl", "trustedformcerturl", "trustedformurl", "trustedformcertificateurl", "trustedformcertificate", "trustedform", "tfcerturl", "certurl", "certificateurl", "jornayaleadid", "leadidtoken", "universalleadid", "leadid", "jornayatoken", "jornaya", "trustedformcertid", "trustedformid", "certificateid", "certid", "consentcertificate", "consentcertificateid", "consentproof"]);
const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The agency template's own consent-certificate field, when it has one: the proof is filed there. */
export function consentField(fields: TemplateField[]): TemplateField | null {
  return fields.find((f) => CONSENT_KEYS.has(norm(f.field_key))) ?? null;
}

// ─── the agency's partner template (board K2, short on a phone) ─────────────────────────────────
/** The template's questions in its order, the consent field left to the proof control. */
export function formFields(fields: TemplateField[]): TemplateField[] {
  const consent = consentField(fields);
  return [...fields].filter((f) => f !== consent).sort((a, b) => a.sort_order - b.sort_order);
}

/** A yes/no question starts as "no", as the switch shows it, so it is always answered. */
export function withDefaults(fields: TemplateField[], values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const f of fields) if (f.type === "boolean" && typeof out[f.field_key] !== "boolean") out[f.field_key] = false;
  return out;
}

export function missingRequired(fields: TemplateField[], values: Record<string, unknown>): TemplateField[] {
  return fields.filter((f) => f.is_required && f.type !== "boolean" && (values[f.field_key] === undefined || values[f.field_key] === null || String(values[f.field_key]).trim() === "" || (Array.isArray(values[f.field_key]) && (values[f.field_key] as unknown[]).length === 0)));
}

/** A version-4 UUID for a submission's retry key (the server refuses a submission without one). */
export function submissionId(random: () => number = Math.random): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(random() * 4)]}${hex(3)}-${hex(12)}`;
}

/** A US state code from what was typed ("al", "Alabama" → "AL"), or null. */
const STATES: Record<string, string> = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" };
export const STATE_NAMES: [string, string][] = Object.entries(STATES).map(([name, code]) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase())]);
export function stateCode(typed: string): string | null {
  const t = typed.trim();
  if (/^[A-Za-z]{2}$/.test(t) && Object.values(STATES).includes(t.toUpperCase())) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? null;
}

// ─── the transfer card (board K2b "70 · AL · final expense") ─────────────────────────────────────
/** Whole years from a date of birth as the form stores it (ISO or MM/DD/YYYY); null when it is not a real date. */
export function ageFrom(value: unknown, now = new Date()): number | null {
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  const [y, m, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : us ? [Number(us[3]), Number(us[1]), Number(us[2])] : [NaN, NaN, NaN];
  if (!y || !m || !d || m > 12 || d > 31) return null;
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

const DOB_KEY = /(^|_)(dob|date_?of_?birth|birth_?date)$/i;
const STATE_KEY = /(^|_)state$/i;

/** Age · state · product from the submission's own answers, each left out when it isn't there. */
export function transferFacts(values: Record<string, unknown> | undefined, product: string | null): string {
  const entries = Object.entries(values ?? {});
  const dob = entries.find(([k]) => DOB_KEY.test(k))?.[1];
  const state = entries.find(([k, v]) => STATE_KEY.test(k) && typeof v === "string")?.[1];
  const age = ageFrom(dob);
  const code = typeof state === "string" ? stateCode(state) ?? state.toUpperCase() : null;
  return [age !== null ? String(age) : null, code, product ? product.charAt(0).toLowerCase() + product.slice(1) : null].filter(Boolean).join(" · ");
}

/**
 * The template's questions as the board lays them out on a phone (K2): First | Last, Phone,
 * Date of birth | State, then the Product picker, the rest in the agency's order, the consent proof, and
 * a note for the agent last. A pair is drawn side by side only when the template has both halves.
 */
export type FormRow = { kind: "pair"; left: TemplateField; right: TemplateField } | { kind: "one"; field: TemplateField };
const FIRST_KEY = /^first_?name$/i;
const LAST_KEY = /^last_?name$/i;
const NOTE_KEY = /note/i;
export function formLayout(fields: TemplateField[]): { top: FormRow[]; rest: FormRow[]; notes: FormRow[] } {
  const used = new Set<TemplateField>();
  const take = (test: (f: TemplateField) => boolean) => fields.find((f) => test(f) && !used.has(f));
  const top: FormRow[] = [];
  const pairOf = (a: TemplateField | undefined, b: TemplateField | undefined) => {
    if (a) used.add(a);
    if (b) used.add(b);
    if (a && b) top.push({ kind: "pair", left: a, right: b });
    else if (a) top.push({ kind: "one", field: a });
    else if (b) top.push({ kind: "one", field: b });
  };
  pairOf(take((f) => FIRST_KEY.test(f.field_key)), take((f) => LAST_KEY.test(f.field_key)));
  const phone = take((f) => f.type === "phone");
  if (phone) { used.add(phone); top.push({ kind: "one", field: phone }); }
  pairOf(take((f) => DOB_KEY.test(f.field_key) || f.type === "date" && /birth/i.test(f.label)), take((f) => STATE_KEY.test(f.field_key)));
  const left = fields.filter((f) => !used.has(f));
  const isNote = (f: TemplateField) => NOTE_KEY.test(f.field_key) && (f.type === "text" || f.type === "long_text");
  return {
    top,
    rest: left.filter((f) => !isNote(f)).map((field): FormRow => ({ kind: "one", field })),
    notes: left.filter(isNote).map((field): FormRow => ({ kind: "one", field })),
  };
}

// ─── chat (board H3, K5) ─────────────────────────────────────────────────────────────────────────
export function nameMap(directory: Directory | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of [...(directory?.tenantUsers ?? []), ...(directory?.partnerUsers ?? [])]) {
    const name = p.users?.name?.trim() || p.users?.email || "";
    if (name) names.set(p.user_id, name);
  }
  return names;
}

export const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "·";
}

export type ThreadItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "bubble"; key: string; mine: boolean; text: string; meta: string | null; attachments: ChatMessage["attachments"] }
  | { kind: "card"; key: string; customer: string; facts: string; workItemId: string | null; meta: string | null };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A conversation as the board draws it: a time line where a new stretch starts, the other side's
 * messages on the left with "Maya · 2:11 pm" under them, the reader's own on the right, and each lead
 * update as a small record card (the customer, then product · state).
 */
export function threadItems(messages: ChatMessage[], viewerId: string, names: Map<string, string>, options: { now?: Date; otherSide?: string | null } = {}): ThreadItem[] {
  const now = options.now ?? new Date();
  const items: ThreadItem[] = [];
  let lastAt = 0;
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const m of sorted) {
    const at = new Date(m.createdAt).getTime();
    // A new stretch after half an hour of quiet gets its own time line, as the board's "Today 2:09 pm".
    if (!lastAt || at - lastAt > 30 * 60_000) {
      const day = dayWords(m.createdAt, now);
      items.push({ kind: "day", key: `day-${m.id}`, label: `${day.charAt(0).toUpperCase()}${day.slice(1)} ${clock(m.createdAt)}` });
    }
    lastAt = at;
    const mine = m.createdBy === viewerId;
    const who = m.createdBy ? names.get(m.createdBy) : null;
    if (m.messageKind === "system_card") {
      const p = m.cardPayload;
      const customer = text(p.customer) ?? "A lead";
      items.push({ kind: "card", key: m.id, customer, facts: [text(p.product), text(p.state)].filter(Boolean).join(" · ") || m.message, workItemId: m.workItemId, meta: who ? `${firstWord(who)}${options.otherSide ? ` · ${options.otherSide}` : ""} · ${clock(m.createdAt)}` : clock(m.createdAt) });
      continue;
    }
    items.push({ kind: "bubble", key: m.id, mine, text: m.message, meta: mine ? null : `${who ? `${firstWord(who)} · ` : ""}${clock(m.createdAt)}`, attachments: m.attachments ?? [] });
  }
  return items;
}

/** "Read 2:12 pm" under the reader's last message, once someone on the other side has read past it. */
export function readMark(messages: ChatMessage[], viewerId: string, othersReadAt: string | null | undefined): string | null {
  const mine = [...messages].filter((m) => m.createdBy === viewerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!mine || !othersReadAt || othersReadAt < mine.createdAt) return null;
  return `Read ${clock(othersReadAt)}`;
}

export function totalUnread(channels: ChatEntry[]): number {
  return channels.filter((c) => c.channel.status === "active").reduce((n, c) => n + (c.unreadCount || 0), 0);
}

/** The partner's conversations for K5: active ones, newest first, with the last word and who wrote it. */
export function conversationRows(channels: ChatEntry[], viewerId: string, names: Map<string, string>) {
  return channels
    .filter((c) => c.channel.status === "active" && !c.state?.archivedAt)
    .map((c) => {
      const last = [...c.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;
      const who = !last || last.messageKind === "system_card" || !last.createdBy ? null : last.createdBy === viewerId ? "You" : firstWord(names.get(last.createdBy) ?? "") || null;
      const words = last?.message.replace(/\s+/g, " ").trim() || null;
      return { id: c.channel.id, name: c.channel.name, kind: c.channel.channel_type, preview: words ? (who ? `${who}: ${words}` : words) : null, at: last?.createdAt ?? null, unread: c.unreadCount || 0 };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Allowed attachment types (lib/partnerChat/service.ts ALLOWED_ATTACHMENT_TYPES) and the 10 MB cap. */
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/gif", "application/pdf", "text/plain"] as const;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export function attachmentProblem(file: { mimeType?: string | null; fileSize?: number | null }): string | null {
  if (!file.mimeType || !(ATTACHMENT_TYPES as readonly string[]).includes(file.mimeType)) return "That file type can’t be sent.";
  if (file.fileSize && file.fileSize > ATTACHMENT_MAX_BYTES) return "Each attachment must be smaller than 10 MB.";
  return null;
}
