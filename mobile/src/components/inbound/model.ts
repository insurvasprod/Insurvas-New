import { addDays, clock, dayKey, deviceZone, stateName, weekday, zonedLocalToUtc } from "@/components/calls/time";
import { phoneLabel } from "@/lib/format";
import type { CallerExtras, DispositionNode, FieldType, FloorCall, FloorMember, LadderStep, OutcomeOption, PanelField, Preflight, Screening, VerificationPanel, WalkStep } from "./types";

/**
 * The inbound call's rules, pure so they are tested (components/inbound/__tests__/model.test.ts).
 * Every figure comes from a server answer; nothing here invents a fact the server did not send.
 */

// ─── the call's steps (the web's ?phase=, lib/inbound/callPhase.ts) ─────────────────────────────
/** The web's four steps. This screen walks 1, 2 and 4; step 3 is the phone's own application (app/application). */
export const STEP_NAMES = ["Caller profile", "Verification", "Application", "Finish the call"] as const;
export type Phase = "check" | "verify" | "finish";
export const PHASE_STEP: Record<Phase, number> = { check: 0, verify: 1, finish: 3 };
export function phaseOf(raw: string | string[] | undefined): Phase {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "verify" || v === "finish" ? v : "check";
}

/** "03:18" (or "1:03:18") from a start time; null without one. */
export function onCallClock(startedAt: string | null | undefined, now: number): string | null {
  if (!startedAt) return null;
  const s = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  if (!Number.isFinite(s)) return null;
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "0:48" — a wait or a call length, minutes unpadded. */
export function mss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "0:19 ago" style, for a check the server ran. */
export function sinceLabel(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const s = (now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return null;
  if (s < 3600) return `${mss(s)} ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** The inbox's age as words ("66" → "66 yrs"; the web's ageLabel). Null when there is none. */
export function ageLabel(age: string | null | undefined): string | null {
  const v = (age ?? "").trim();
  if (!v || v === "—") return null;
  return /^\d{1,3}$/.test(v) ? `${v} yrs` : v;
}

// ─── the caller (C3) ───────────────────────────────────────────────────────────────────────────
const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function callerName(values: Record<string, unknown>): string {
  return text(values.full_name) || text(values.name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || "Customer";
}

function birthDate(values: Record<string, unknown>): { label: string; age: number } | null {
  const raw = text(values.date_of_birth) || text(values.dob) || text(values.birth_date);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1; const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo, d));
  const today = new Date();
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() < mo || (today.getUTCMonth() === mo && today.getUTCDate() < d)) age -= 1;
  const label = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return { label, age };
}

/** "71 yrs · Born 3 Mar 1954 · Jacksonville, FL" — only the parts the lead has. */
export function callerLine(values: Record<string, unknown>): string {
  const born = birthDate(values);
  const place = [text(values.city), text(values.state)].filter(Boolean).join(", ");
  return [born ? `${born.age} yrs` : null, born ? `Born ${born.label}` : null, place || null].filter(Boolean).join(" · ");
}

/** "her" / "him" from the lead's own gender field, else "them" (C4's "Read it back to her"). */
export function objectPronoun(values: Record<string, unknown>): "her" | "him" | "them" {
  const g = (text(values.gender) || text(values.sex)).toLowerCase();
  if (g === "f" || g === "female" || g === "woman") return "her";
  if (g === "m" || g === "male" || g === "man") return "him";
  return "them";
}

export function contactFacts(values: Record<string, unknown>) {
  return {
    phone: text(values.phone) || text(values.phone_number) || text(values.mobile_phone) || null,
    email: text(values.email) || text(values.email_address) || null,
    language: text(values.language) || text(values.preferred_language) || null,
  };
}

/** What the card already says: not repeated in the partner's list (the web's ON_THE_CARD). */
const ON_THE_CARD = /^(full_?name|name|first_?name|last_?name|date_?of_?birth|dob|birth_?date|city|state|zip|zip_?code|postal_?code|address.*|street.*|email.*|phone.*|mobile.*|cell.*|language|preferred_language)$/i;
const MONEY = /amount|premium|coverage|income|salary|benefit/i;

/** One stored value as the caller profile shows it (the web's caller-value.ts). */
export function shownValue(field: { field_key: string; label: string; type?: string | null }, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  if (field.type === "currency") return usd(Number(raw) / 100);
  if (MONEY.test(`${field.field_key} ${field.label}`)) return usd(Number(raw));
  return raw;
}

/** Every detail the partner sent, in the template's order, once each, minus what the card shows. */
export function partnerDetails(panel: Pick<VerificationPanel, "sections" | "lead">): { key: string; label: string; value: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string; value: string }[] = [];
  for (const f of panel.sections.flatMap((s) => s.fields)) {
    if (seen.has(f.field_key)) continue;
    seen.add(f.field_key);
    if (ON_THE_CARD.test(f.field_key)) continue;
    const v = shownValue(f, panel.lead.values[f.field_key]);
    if (v !== null) out.push({ key: f.field_key, label: f.label, value: v });
  }
  return out;
}

const NOTE_FIELD = /note|comment|remark|message|summary|reason/i;

/** The partner's own words, when the form has a free-text note field with a value: shown as a quote (C3). */
export function partnerQuote(panel: Pick<VerificationPanel, "sections" | "lead">): { key: string; value: string } | null {
  for (const f of panel.sections.flatMap((s) => s.fields)) {
    if (f.type !== "long_text" && f.type !== "text") continue;
    if (!NOTE_FIELD.test(`${f.field_key} ${f.label}`)) continue;
    const v = panel.lead.values[f.field_key];
    if (typeof v === "string" && v.trim()) return { key: f.field_key, value: v.trim() };
  }
  return null;
}

/** "First call with us" / "Called 3 times before" — from the server's counts, or null. */
export function historyLine(calls: { count: number } | null | undefined, transfers: number | null | undefined): string | null {
  if (calls && calls.count > 0) return `Called ${calls.count} ${calls.count === 1 ? "time" : "times"} before`;
  if (transfers === 1 && calls && calls.count === 0) return "First call with us";
  if (transfers && transfers > 1) return `Transferred in ${transfers} times`;
  return null;
}

// ─── checks (C1b, C3): ticks from the screening ladder and the stored preflight ─────────────────
/** 1 = passed (green tick), 0 = matched (red ×), null = not known yet (clock). */
export type Tick = { key: string; ok: 1 | 0 | null; title: string; meta: string | null };

export function checkTicks(screening: Pick<Screening, "steps" | "checkedAt"> | null, preflight: Preflight | InboxPreflight | undefined, now: number, extras?: Pick<CallerExtras, "consent" | "zones" | "duplicate"> | null): Tick[] {
  const ticks: Tick[] = [];
  const consent = extras ? consentTick(extras.consent) : null;
  const step = (k: LadderStep["key"]) => screening?.steps.find((s) => s.key === k)?.state ?? null;
  if (screening) {
    const own = step("tenant_dnc");
    const registry = step("dnc_registry");
    const checked = sinceLabel(screening.checkedAt, now);
    if (own === "match") ticks.push({ key: "dnc", ok: 0, title: "On your do-not-call list", meta: checked ? `Checked ${checked}` : null });
    else if (registry === "match") ticks.push({ key: "dnc", ok: 0, title: "On the Do Not Call registry", meta: "The partner confirmed before sending" });
    else if (own === "passed" && registry === "passed") ticks.push({ key: "dnc", ok: 1, title: "Not on any Do Not Call list", meta: checked ? `Checked ${checked}` : null });
    else ticks.push({ key: "dnc", ok: null, title: "Do Not Call not checked", meta: "Screening did not finish for this number" });
  }
  // The board's order: Do Not Call, consent, the existing-client check, then the window — four ticks on a clear
  // caller (C3). A duplicate is shown only when the server matched one (a red ×); a passed duplicate check adds no tick.
  if (consent) ticks.push(consent);
  if (screening && step("duplicate") === "match") ticks.push({ key: "dup", ok: 0, title: "Maybe already a lead", meta: duplicateLine(extras?.duplicate) ?? "This phone is on another of your leads" });
  const pf = preflight ?? null;
  if (pf && pf.status !== "not_checked") {
    const match = pf.matches?.[0];
    const by = match ? [match.partnerName, match.matchedOn?.length ? `matched on ${match.matchedOn.join(", ")}` : null].filter(Boolean).join(" · ") : null;
    if (pf.status === "already_customer") ticks.push({ key: "client", ok: 0, title: "Already your client", meta: by || null });
    else if (pf.status === "spoken_before") ticks.push({ key: "client", ok: null, title: "Spoken to before", meta: by || null });
    else ticks.push({ key: "client", ok: 1, title: "Not already your client", meta: "No match on phone or date of birth" });
  }
  const window = extras ? windowTick(extras.zones, now) : null;
  if (window) ticks.push(window);
  return ticks;
}

/** C1b: "Walter Brooks, (478) 555-0133, Contacted 4 Oct by Sam Lee" — the earlier lead the server matched. */
export function duplicateLine(dup: CallerExtras["duplicate"]): string | null {
  if (!dup || !(dup.name || dup.phone)) return null;
  const when = dup.lastContact ? dayLabel(dup.lastContact.at) : null;
  const contacted = when ? `Contacted ${when}${dup.lastContact?.by ? ` by ${dup.lastContact.by}` : ""}` : null;
  return [dup.name, phoneLabel(dup.phone), contacted].filter(Boolean).join(", ");
}

const PROVIDERS: Record<string, string> = { trustedform: "TrustedForm", jornaya: "Jornaya", leadid: "Jornaya LeadiD", activeprospect: "ActiveProspect" };
/** "TrustedForm" from the stored provider code. */
export function providerLabel(provider: string | null | undefined): string | null {
  const raw = (provider ?? "").trim();
  if (!raw) return null;
  return PROVIDERS[raw.toLowerCase().replace(/[\s_-]+/g, "")] ?? raw.replace(/[_-]+/g, " ");
}

function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: deviceZone() });
}

/**
 * The consent certificate on the lead (the consent locker's newest row): claimed is on file; pending
 * holds only the provider's link; expired / failed have no copy. Nothing when the server could not say.
 */
export function consentTick(consent: CallerExtras["consent"]): Tick | null {
  if (consent === undefined) return null;
  if (consent === null) return { key: "consent", ok: null, title: "No consent proof on file yet", meta: null };
  const provider = providerLabel(consent.provider);
  if (consent.status === "claimed") return { key: "consent", ok: 1, title: "Consent on file", meta: [dayLabel(consent.consentAt ?? consent.capturedAt), provider].filter(Boolean).join(" · ") || null };
  if (consent.status === "expired") return { key: "consent", ok: 0, title: "Consent proof expired", meta: provider ? `${provider} link expired before a copy was claimed` : null };
  if (consent.status === "failed") return { key: "consent", ok: 0, title: "Consent proof could not be claimed", meta: provider ? `${provider} refused the claim` : null };
  return { key: "consent", ok: null, title: "Consent proof still arriving", meta: provider ? `${provider} link on file · our copy is not claimed yet` : null };
}

/** "8 pm" — a window's whole hour. */
function hourWord(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

/**
 * "Inside the calling window · 2:14 pm their time · open until 8 pm", from the customer's zone and the
 * effective window (federal, state and agency) the lead record computes. The server's own dial check
 * stays the authority (it also weighs holidays and the campaign); this reads the clock against it.
 */
export function windowTick(zones: CallerExtras["zones"], now: number): Tick | null {
  if (!zones?.customer || !zones.window) return null;
  const at = new Date(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: zones.customer, hour: "numeric", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at);
  } catch {
    return null;
  }
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const minute = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  if (!Number.isFinite(minute)) return null;
  const { start, end, noSunday } = zones.window;
  const sunday = noSunday && get("weekday") === "Sun";
  const inside = !sunday && minute >= start * 60 && minute < end * 60;
  const theirs = `${clock(at, zones.customer)} their time`;
  if (inside) return { key: "window", ok: 1, title: "Inside the calling window", meta: `${theirs} · open until ${hourWord(end)}` };
  return { key: "window", ok: null, title: "Outside the calling window", meta: sunday ? `${theirs} · closed on Sundays in ${zones.window.state}` : `${theirs} · opens ${hourWord(start)}` };
}
type InboxPreflight = { status: string; matches?: { partnerName: string | null; submittedAt: string; matchedOn: string[] }[] } | null;

// ─── verification (C4) ─────────────────────────────────────────────────────────────────────────
export type VerifyView = {
  done: PanelField[]; now: PanelField | null; later: PanelField[];
  confirmed: number; corrected: number; required: number; percent: number; total: number; checked: number;
};

/**
 * The fields in template order, grouped the board's way: Confirmed (confirmed or corrected), Now (the
 * one to ask — the chosen one, else the first required one still open, else the first open one), and
 * Still to check. The count is the server's: required details confirmed or corrected (progress.ts).
 */
export function verifyView(panel: Pick<VerificationPanel, "sections" | "requiredCount">, pick?: string | null): VerifyView {
  const seen = new Set<string>();
  const all = panel.sections.flatMap((s) => s.fields).filter((f) => f.is_visible !== false && !seen.has(f.field_key) && Boolean(seen.add(f.field_key)));
  const done = all.filter((f) => f.state !== "outstanding");
  const open = all.filter((f) => f.state === "outstanding");
  const chosen = pick ? all.find((f) => f.field_key === pick && f.state === "outstanding") ?? null : null;
  const now = chosen ?? open.find((f) => f.is_required) ?? open[0] ?? null;
  const requiredDone = all.filter((f) => f.is_required && f.state !== "outstanding").length;
  const required = Math.max(panel.requiredCount, all.filter((f) => f.is_required).length);
  return {
    done, now, later: open.filter((f) => f !== now),
    confirmed: requiredDone, corrected: done.filter((f) => f.state === "corrected").length, required,
    percent: required ? Math.floor((requiredDone / required) * 100) : 100,
    total: all.length, checked: done.length,
  };
}

/** The details the board corrects as one (C5's beneficiary: full name, relationship, share). */
const COMPOUND = /^(contingent_beneficiary|beneficiary|spouse|owner|payor|payer)(?=$|_)/;

/**
 * C5: the sibling fields of a compound detail — every visible field whose key is the detail's own or
 * starts with it ("beneficiary", "beneficiary_relationship", "beneficiary_share"), in template order.
 * Null for a field that stands alone, or a detail the template keeps in one field.
 */
export function compoundFields(panel: Pick<VerificationPanel, "sections">, field: Pick<PanelField, "field_key">): { label: string; fields: PanelField[] } | null {
  const m = COMPOUND.exec(field.field_key);
  if (!m) return null;
  const prefix = m[1];
  const seen = new Set<string>();
  const fields = panel.sections.flatMap((s) => s.fields).filter((f) => f.is_visible !== false && (f.field_key === prefix || f.field_key.startsWith(`${prefix}_`)) && !seen.has(f.field_key) && Boolean(seen.add(f.field_key)));
  if (fields.length < 2) return null;
  const words = prefix.replace(/_/g, " ");
  return { label: words.charAt(0).toUpperCase() + words.slice(1), fields };
}

/** A stored value read back on a row: the corrected value when there is one. */
export function fieldValue(field: PanelField, values: Record<string, unknown>): string | null {
  const v = field.state === "corrected" && field.new_value != null ? field.new_value : values[field.field_key];
  return shownValue(field, v);
}

/** The editor's starting text for a field (currency is stored in cents and typed in dollars). */
export function inputText(type: FieldType, value: unknown, masked: boolean): string {
  if (masked || value === null || value === undefined) return "";
  if (type === "currency" && typeof value === "number") return String(value / 100);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** What a correction sends (the web's FieldEditor): numbers as numbers, dollars as cents, Yes/No as booleans. */
export function correctionValue(type: FieldType, raw: string | string[]): unknown {
  if (type === "multi_select") return Array.isArray(raw) ? raw : raw ? [raw] : [];
  const s = (Array.isArray(raw) ? raw[0] ?? "" : raw).trim();
  if (type === "number") return s === "" ? undefined : Number(s.replace(/,/g, ""));
  if (type === "currency") return s === "" ? undefined : Math.round(Number(s.replace(/[$,]/g, "")) * 100);
  if (type === "boolean") return s === "true" ? true : s === "false" ? false : undefined;
  return s;
}

// ─── C2: which waiting transfer rings this phone ───────────────────────────────────────────────
/**
 * A transfer rings when it is new since the last read (not already on screen when the list first
 * loaded), nobody has passed on it here, and you are taking calls (ready). Longest-waiting first.
 */
export function nextRing(prevIds: string[] | null, items: { id: string; waitSeconds: number }[], passed: string[], presence: string | null | undefined, readOnly: boolean): string | null {
  if (prevIds === null || readOnly || presence !== "ready") return null;
  const fresh = items.filter((it) => !prevIds.includes(it.id) && !passed.includes(it.id)).sort((a, b) => b.waitSeconds - a.waitSeconds);
  return fresh[0]?.id ?? null;
}

// ─── C1c: the inbound team ─────────────────────────────────────────────────────────────────────
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const m = Math.floor((now - Date.parse(iso)) / 60000);
  return Number.isFinite(m) ? Math.max(0, m) : null;
}

function wall(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : clock(d, deviceZone());
}

/**
 * A call's line: a running m:ss / h:mm:ss timer, or — past 4 hours, which is a call nobody closed rather
 * than a real conversation — the day and time it began, so the screen never shows "1646:12:56".
 */
export function callLine(startedAt: string, now: number): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "On a call";
  const seconds = (now - started) / 1000;
  if (seconds <= 4 * 3600) return `On a call · ${mss(seconds)}`;
  const d = new Date(started);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: deviceZone() });
  return `On a call since ${day}, ${clock(d, deviceZone())}`;
}

/** L2's first line: "on a call · 4:18", or the start of a call nobody closed ("on a call since 17 Sept, 10:38 am"). */
export function barClock(startedAt: string, now: number): string {
  return callLine(startedAt, now).replace(/^On/, "on");
}

/** C1 "Handoffs for you": "Verification 75% done · 3 min ago" — only what the server sent. */
export function handoffLine(h: { progressPercentage: number | null; offeredAt?: string | null; productLine?: string | null }, now: number): string {
  const offered = h.offeredAt && Number.isFinite(Date.parse(h.offeredAt)) ? agoLabel(h.offeredAt, now) : null;
  const done = h.progressPercentage != null ? `Verification ${Math.round(h.progressPercentage)}% done` : productName(h.productLine);
  return [done, offered].filter(Boolean).join(" · ");
}

function agoLabel(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** "final_expense" → "Final expense" (lib/format codeLabel, kept here so the model stays pure). */
export function productName(code: string | null | undefined): string | null {
  if (!code) return null;
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/** C1 / C1b / C2: "71 yrs · FL · Final expense" — only the parts the server sent. */
export function waitingLine(it: { age?: string | null; state: string | null; productLine: string | null }): string {
  return [ageLabel(it.age), it.state && it.state !== "—" ? it.state : null, productName(it.productLine)].filter(Boolean).join(" · ");
}

export type TeamRow = { id: string; name: string; meta: string; chip: { tone: "ok" | "info" | "warn"; text: string } | null; taking: boolean; waiting?: number | null };

/** One member as C1c lists them: taking calls (ready or on a call) first, then everyone else. */
export function teamRow(m: FloorMember, me: string | null | undefined, calls: FloorCall[], now: number): TeamRow {
  const name = `${m.name}${m.id === me ? " (you)" : ""}${m.role === "assistant" ? " (assistant)" : ""}`;
  // An assistant verifies for a licensed agent and never takes a transfer himself, so the board lists
  // him with the people not taking calls ("Lena Park (assistant) · Verifying for Ava").
  if (m.role === "assistant") {
    const helping = calls.find((c) => c.buffer?.userId === m.id);
    if (helping) return { id: m.id, name, meta: `Verifying for ${helping.agentName.trim().split(/\s+/)[0] || helping.agentName}`, chip: null, taking: false };
  }
  if (m.availability === "on_call") {
    const supporting = m.supporting ? calls.find((c) => c.buffer?.userId === m.id) : undefined;
    const meta = supporting ? `Verifying for ${supporting.agentName}` : m.call ? callLine(m.call.startedAt, now) : "On a call";
    // The server marks an on-call member "away" when it has stopped hearing from them: they can't be
    // reached, so they are listed with the people not taking calls, never under "Taking calls".
    if (m.away) return { id: m.id, name, meta, chip: { tone: "warn", text: "Away" }, taking: false };
    return { id: m.id, name, meta, chip: { tone: "info", text: "On a call" }, taking: true };
  }
  if (m.availability === "ready") {
    const since = [m.statusChangedAt, m.lastCall?.endedAt].filter((x): x is string => Boolean(x)).sort().pop() ?? null;
    const mins = minutesSince(since, now);
    return { id: m.id, name, meta: mins === null ? "Ready" : `Ready · waiting ${mins} min`, chip: null, taking: m.role !== "assistant", waiting: mins };
  }
  if (m.availability === "on_break") return { id: m.id, name, meta: wall(m.statusChangedAt) ? `On a break since ${wall(m.statusChangedAt)}` : "On a break", chip: null, taking: false };
  if (m.availability === "offline") return { id: m.id, name, meta: wall(m.lastSeenAt) ? `Away since ${wall(m.lastSeenAt)}` : "Not signed in", chip: null, taking: false };
  return { id: m.id, name, meta: "Off today", chip: null, taking: false };
}

/**
 * C1c's two groups. Taking calls: the ready people, longest waiting first, then those on a call (the
 * board's order); everyone else after. No rotation is drawn: the server has none (a waiting transfer
 * goes to whoever claims it first), so there is no "Next" to name.
 */
export function teamGroups(members: FloorMember[], me: string | null | undefined, calls: FloorCall[], now: number): { taking: TeamRow[]; notTaking: TeamRow[] } {
  const rows = members.map((m) => teamRow(m, me, calls, now));
  const rank = (r: TeamRow) => (r.chip ? 1 : 0);
  const taking = rows.filter((r) => r.taking).sort((a, b) => rank(a) - rank(b) || (b.waiting ?? -1) - (a.waiting ?? -1));
  return { taking, notTaking: rows.filter((r) => !r.taking) };
}

/** C4b: one licensed agent's line, from the floor (null when the floor did not list them). */
export function agentLine(m: FloorMember | undefined, now: number): string | null {
  if (!m) return null;
  if (m.availability === "on_call") return m.call ? callLine(m.call.startedAt, now) : "On a call";
  if (m.availability === "ready") { const mins = minutesSince(m.statusChangedAt, now); return mins === null ? "Ready" : `Ready · ${mins} min`; }
  if (m.availability === "on_break") return "On a break";
  if (m.availability === "offline") return "Not signed in";
  return "Not taking calls";
}

/** C4b: "Licensed in Georgia for final expense, ready now" — the caller's state and product, when known. */
export function handoffQualifier(state: string | null | undefined, productLine: string | null | undefined): string | null {
  const where = stateName(state ?? null);
  if (!where) return null;
  const product = productName(productLine);
  return `Licensed in ${where}${product ? ` for ${product.charAt(0).toLowerCase()}${product.slice(1)}` : ""}, ready now`;
}

/**
 * C4b's list: the agents licensed in the caller's state, ready ones first. When the server sent no
 * licences, or nobody is licensed there, every agent the server offers (the server is the gate).
 */
export function handoffAgents<A extends { id: string }>(agents: A[], licensed: Record<string, string[]> | null | undefined, state: string | null | undefined, floor: FloorMember[] | null | undefined): { agents: A[]; filtered: boolean } {
  const code = (state ?? "").trim().toUpperCase();
  const there = licensed && code ? agents.filter((a) => (licensed[a.id] ?? []).includes(code)) : [];
  const list = there.length ? there : agents;
  const ready = (a: A) => (floor?.find((m) => m.id === a.id)?.availability === "ready" ? 0 : 1);
  return { agents: [...list].sort((a, b) => ready(a) - ready(b)), filtered: there.length > 0 };
}

// ─── C6: finish the call ───────────────────────────────────────────────────────────────────────
export const CALLBACK_KEY = "callback_scheduled";

export function answerLabel(step: WalkStep, node: DispositionNode | undefined): string {
  const label = (k: string) => node?.options.find((o) => o.option_key === k)?.label ?? k;
  if (step.option_key) return label(step.option_key);
  if (Array.isArray(step.answer)) return step.answer.map((v) => label(String(v))).join(", ");
  if (typeof step.answer === "string" && step.answer.trim()) return step.answer;
  return "Answered";
}

/** Three quick times in the customer's zone (tomorrow 2 pm, then 10 am and 4 pm the days after); the server checks the window. */
export function quickTimes(zone: string, now: number): { local: string; label: string }[] {
  const today = dayKey(new Date(now), zone);
  const picks: [number, string][] = [[1, "14:00"], [2, "10:00"], [3, "16:00"]];
  return picks.map(([d, t]) => {
    const day = addDays(today, d);
    const local = `${day}T${t}`;
    const at = zonedLocalToUtc(local, zone);
    return { local, label: `${d === 1 ? "Tomorrow" : weekday(day)} ${clock(at, zone).replace(":00", "")}` };
  });
}

/** "What happens when you save": the server's own consequences for the chosen outcome. */
export function consequences(option: OutcomeOption | null, callback: { at: Date; zone: string; mine: string } | null, reminderMinutes?: number | null): { icon: "calCheck" | "kanban" | "shieldX" | "lock" | "bell"; text: string; bold?: string }[] {
  if (!option) return [];
  const out: { icon: "calCheck" | "kanban" | "shieldX" | "lock" | "bell"; text: string; bold?: string }[] = [];
  if (callback) {
    const theirs = `${callback.at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: callback.zone })}, ${clock(callback.at, callback.zone)} their time`;
    // Board C6 always draws both clocks, even when they match ("2:00 pm her time (2:00 pm yours)").
    out.push({ icon: "calCheck", text: `Callback ${theirs} (${clock(callback.at, callback.mine)} yours)` });
  }
  if (option.stage && !option.stage.is_current) out.push({ icon: "kanban", text: "Lead moves to", bold: option.stage.name });
  if (option.adds_to_do_not_call) out.push({ icon: "shieldX", text: "The number goes on your do-not-call list" });
  if (option.needs_verification) out.push({ icon: "lock", text: "Refused until verification is complete" });
  // The server's reminder lead time (the agency's setting, else the platform's), only with a callback.
  if (callback && reminderMinutes != null && reminderMinutes > 0) out.push({ icon: "bell", text: `You get a reminder ${reminderMinutes} ${reminderMinutes === 1 ? "minute" : "minutes"} before` });
  return out;
}
