/**
 * The rules the lead screens apply, kept pure so they can be tested on their own. Each one is the
 * web's own rule, ported: a stage move is a disposition (components/app/lead-detail-workspace.tsx
 * `moveTo` and components/app/pipeline-views.tsx `callPathOnly`), a form question shows by the
 * template's logic (lib/templates/logic.ts + visibility.ts), verification states are the three the
 * database allows (confirmed, corrected, outstanding).
 */

// ─── stage moves ────────────────────────────────────────────────────────────────────────────────
export type MappedDisposition = { key: string; label: string; nextAction: string | null; nextActionMinutes: number | null };
export type PipelineContext = { dispositionsByStage: Record<string, MappedDisposition[]> };

const CALL_PATH_KEYS = new Set(["callback_scheduled", "do_not_call"]);
/** Outcomes only a call can record (a callback needs a time, do-not-call writes the suppression). */
export const callPathOnly = (option: MappedDisposition) => CALL_PATH_KEYS.has(option.key) || option.nextAction === "callback" || option.nextAction === "suppress";

/**
 * Which outcome a move to `stage` records: the one named like the stage, else the first mapped to it,
 * never one only a call can record. The error is the web's own sentence.
 */
export function planMove(stage: { id: string; name: string }, context: PipelineContext): { pick: MappedDisposition } | { error: string } {
  const options = (context.dispositionsByStage[stage.id] ?? []).filter((option) => !callPathOnly(option));
  if (!options.length) return { error: `Only a call can move a lead to ${stage.name}. Record it from the dialer or the call outcome.` };
  const named = options.find((option) => option.label.trim().toLowerCase() === stage.name.trim().toLowerCase());
  return { pick: named ?? options[0] };
}

// ─── small facts ────────────────────────────────────────────────────────────────────────────────
export function initials(name: string | null | undefined): string {
  return (name ?? "").split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/** Whole years from a date of birth ("1958-06-11" or anything Date reads), or null. */
export function ageFromDob(value: unknown, today = new Date()): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  let age = today.getFullYear() - d.getFullYear();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** The lead's age: the template's age answer, else worked out from the date of birth. */
export function leadAge(values: Record<string, unknown>, today = new Date()): number | null {
  const raw = values.age;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  for (const key of ["date_of_birth", "dob", "birth_date", "birthdate"]) {
    const age = ageFromDob(values[key], today);
    if (age !== null) return age;
  }
  return null;
}

/** "2 d", "5 h", "12 min": how long since `iso`. */
export function durationSince(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  if (m < 60) return `${Math.max(1, m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
}

/** "02/14/1957" (or "2/14/1957") typed → "1957-02-14"; null until it is a real date. */
export function usDateToIso(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [mm, dd, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/**
 * Typing a date with the number pad: the slashes come by themselves ("0214" → "02/14",
 * "02141957" → "02/14/1957"). A slash is only added once the next digit is typed, so deleting
 * back through it works. Slashes typed by hand after a one-digit month or day ("2/14/1957") and
 * text with letters or other marks are kept as typed.
 */
export function maskUsDate(text: string): string {
  if (/[^\d/\s]/.test(text)) return text;
  const parts = text.replace(/\s/g, "").split("/");
  if (parts.slice(0, -1).some((x) => x.length !== 2)) return text.trim();
  const d = parts.join("").slice(0, 8);
  return d.slice(0, 2) + (d.length > 2 ? `/${d.slice(2, 4)}` : "") + (d.length > 4 ? `/${d.slice(4, 8)}` : "");
}

/** "1957-02-14" → "02/14/1957"; anything else as given. */
export function isoToUsDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : value;
}

// ─── filters (board D8) ─────────────────────────────────────────────────────────────────────────
export type InStage = "today" | "1-3" | "3+" | "14+";
export type AgeBand = "under60" | "60-80" | "over80";
/** `callable`: only leads the calling-window check says may be dialled now (true), else null. */
export type LeadFilters = { owner: string | null; source: string | null; inStage: InStage | null; state: string | null; age: AgeBand | null; callable: true | null };
export const NO_FILTERS: LeadFilters = { owner: null, source: null, inStage: null, state: null, age: null, callable: null };
/** Owner filter values besides a teammate's name. */
export const OWNER_ME = "__me";
export const OWNER_NONE = "__none";

export const IN_STAGE_LABEL: Record<InStage, string> = { today: "Today", "1-3": "1–3 days", "3+": "Over 3 days", "14+": "Over 2 weeks" };
export const AGE_LABEL: Record<AgeBand, string> = { under60: "Under 60", "60-80": "60–80", over80: "Over 80" };

export type FilterableLead = { owner_user_id?: string | null; owner_name?: string | null; partner_name: string | null; source_name?: string | null; source_type?: string | null; stage_entered_at?: string | null; callable_now?: boolean | null; values: Record<string, unknown> };

const DAY = 86_400_000;
export function matchesFilters(lead: FilterableLead, f: LeadFilters, meId: string | null | undefined, now = Date.now()): boolean {
  if (f.owner === OWNER_ME && (!meId || lead.owner_user_id !== meId)) return false;
  if (f.owner === OWNER_NONE && lead.owner_user_id) return false;
  if (f.owner && f.owner !== OWNER_ME && f.owner !== OWNER_NONE && lead.owner_name !== f.owner) return false;
  if (f.source && leadSource(lead) !== f.source) return false;
  // The server's own calling-window answer; a lead it could not judge is not shown as callable.
  if (f.callable && lead.callable_now !== true) return false;
  if (f.inStage) {
    const t = lead.stage_entered_at ? Date.parse(lead.stage_entered_at) : NaN;
    if (Number.isNaN(t)) return false;
    const age = now - t;
    if (f.inStage === "today" && !(age < DAY)) return false;
    if (f.inStage === "1-3" && !(age >= DAY && age <= 3 * DAY)) return false;
    if (f.inStage === "3+" && !(age > 3 * DAY)) return false;
    if (f.inStage === "14+" && !(age > 14 * DAY)) return false;
  }
  if (f.state) {
    const s = typeof lead.values.state === "string" ? lead.values.state.trim() : "";
    if (s !== f.state) return false;
  }
  if (f.age) {
    const a = leadAge(lead.values, new Date(now));
    if (a === null) return false;
    if (f.age === "under60" && !(a < 60)) return false;
    if (f.age === "60-80" && !(a >= 60 && a <= 80)) return false;
    if (f.age === "over80" && !(a > 80)) return false;
  }
  return true;
}

export function activeFilterCount(f: LeadFilters): number {
  return Object.values(f).filter((v) => v !== null).length;
}

// ─── the board (D2) ─────────────────────────────────────────────────────────────────────────────
export type Lane<L> = { id: string; name: string; leads: L[] };
/** One lane per stage, in the pipeline's order; leads on a stage the pipeline no longer has are left out. */
export function boardLanes<L extends { stage_id: string | null }>(stages: { id: string; name: string }[], leads: L[]): Lane<L>[] {
  const by = new Map<string, L[]>(stages.map((s) => [s.id, []]));
  for (const lead of leads) if (lead.stage_id && by.has(lead.stage_id)) by.get(lead.stage_id)!.push(lead);
  return stages.map((s) => ({ id: s.id, name: s.name, leads: by.get(s.id) ?? [] }));
}

// ─── verification (D3d) ─────────────────────────────────────────────────────────────────────────
export type VerificationField = { field_key: string; state: string; old_value: unknown; new_value: unknown; confirmed_at: string | null };
export type VerificationRow = { key: string; label: string; state: "confirmed" | "corrected" | "outstanding"; meta: string };

export function shownValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymd = (value: unknown) => (typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim()) : null);

/** "1957-06-11" → "6/11/1957" (the board's US date in a row); anything else as shownValue gives it. */
export function usDateShort(value: unknown): string {
  const m = ymd(value);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : shownValue(value);
}

/** A verified answer as the person reads it: dates as 6/11/1957, US phone numbers as (813) 555-0177. */
export function verifiedValue(value: unknown, type?: string | null): string {
  if (ymd(value)) return usDateShort(value);
  if (type === "phone" && typeof value === "string") {
    const d = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return shownValue(value);
}

/**
 * Each field's row, in the form's order (`order`: the template's field keys in sort order): confirmed
 * shows the value, corrected shows what came in and what it is now ("Partner sent …" when a partner
 * sent the lead), outstanding says it was not asked.
 */
export function verificationRows(fields: VerificationField[], labels: Map<string, string>, values: Record<string, unknown>, options: { partner?: boolean; order?: string[]; types?: Map<string, string> } = {}): VerificationRow[] {
  const rank = new Map((options.order ?? []).map((key, i) => [key, i]));
  const sorted = options.order?.length ? [...fields].sort((a, b) => (rank.get(a.field_key) ?? 1e6) - (rank.get(b.field_key) ?? 1e6)) : fields;
  return sorted.map((f) => {
    const label = labels.get(f.field_key) ?? f.field_key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    const type = options.types?.get(f.field_key) ?? (/phone/.test(f.field_key) ? "phone" : null);
    if (f.state === "corrected") {
      const was = verifiedValue(f.old_value, type);
      const now = verifiedValue(f.new_value, type);
      return { key: f.field_key, label, state: "corrected" as const, meta: was ? `${options.partner ? "Partner sent" : "Was"} ${was} · corrected to ${now || "blank"}` : `Corrected to ${now || "blank"}` };
    }
    if (f.state === "confirmed") return { key: f.field_key, label, state: "confirmed" as const, meta: verifiedValue(f.new_value, type) || verifiedValue(values[f.field_key], type) || "Confirmed" };
    return { key: f.field_key, label, state: "outstanding" as const, meta: "Not asked" };
  });
}

// ─── dates and words the lead screens print ─────────────────────────────────────────────────────
/** "23 Nov": fixed English month names, so every phone prints the board's words. */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "11 Jun 1958" for a date of birth (read as the calendar day, never shifted by the phone's zone). */
export function dayMonthYear(value: string): string {
  const m = ymd(value);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Born row: "11 Jun 1958 · 68". */
export function bornLine(dob: string, today = new Date()): string {
  const age = ageFromDob(dob, today);
  return [dayMonthYear(dob), age === null ? null : String(age)].filter(Boolean).join(" · ");
}

/** When a timeline event happened: "today 9:12", "yesterday 18:40", else "Sun 22 Nov". */
export function eventWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.getTime() >= startOfToday) return `today ${time}`;
  if (d.getTime() >= startOfToday - 86_400_000) return `yesterday ${time}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A timeline label as one sentence: "tenant.lead_stage_changed" or "Lead Stage Changed" → "Lead stage changed". */
export function eventTitle(label: string): string {
  const tail = label.includes(".") ? label.slice(label.lastIndexOf(".") + 1) : label;
  const words = tail.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return label;
  // Acronyms (DNC, SMS) keep their capitals; every other word after the first is lower case.
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A timeline detail with stage ids read as their names; a part that is only an unknown id is left out. */
export function readableDetail(detail: string | null, stages: { id: string; name: string }[]): string | null {
  if (!detail) return null;
  const names = new Map(stages.map((s) => [s.id.toLowerCase(), s.name]));
  const parts = detail.split(" · ").map((part) => {
    const ids = part.match(UUID) ?? [];
    if (ids.some((id) => !names.has(id.toLowerCase()))) return null;
    return part.replace(UUID, (id) => names.get(id.toLowerCase()) ?? id);
  }).filter((part): part is string => Boolean(part));
  return parts.join(" · ") || null;
}

// ─── where a lead came from ─────────────────────────────────────────────────────────────────────
/** The web's words for a source row's kind (lead-detail-workspace.tsx SOURCE_LABEL). */
export const SOURCE_LABEL: Record<string, string> = { import: "List import", partner: "Partner submission", affiliate: "Affiliate link", recycle: "Recycled from nurture" };
export function sourceKind(type: string | null | undefined): string | null {
  if (!type) return null;
  return SOURCE_LABEL[type] ?? type.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
/** A list row's source: the vendor, else the partner who sent it, else the kind of source. */
export function leadSource(lead: { source_name?: string | null; partner_name: string | null; source_type?: string | null }): string | null {
  return lead.source_name || lead.partner_name || sourceKind(lead.source_type);
}

// ─── same person? (D9) ──────────────────────────────────────────────────────────────────────────
export type PersonCard = { when: string; name: string; phone: string | null; dob: string | null; place: string | null; source: string | null };
const MATCHED_ON: Record<string, string> = { phone: "phone", name: "name", dob: "date of birth", address: "address", email: "email" };
const DIFF_LABEL: Record<"phone" | "dob" | "place", string> = { phone: "Phone", dob: "Date of birth", place: "Place" };

/** "Same phone and date of birth. Place differs." — what the check matched on, then what the records disagree on. */
export function comparePeople(a: PersonCard, b: PersonCard, matchedOn: string[]): { same: string[]; differs: ("phone" | "dob" | "place")[]; line: string } {
  const same = matchedOn.map((k) => MATCHED_ON[k] ?? k.replace(/_/g, " "));
  const differs = (["phone", "dob", "place"] as const).filter((k) => a[k] && b[k] && a[k]!.trim().toLowerCase() !== b[k]!.trim().toLowerCase());
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts = [same.length ? `Same ${list(same)}.` : null, differs.length ? `${list(differs.map((k, i) => (i === 0 ? DIFF_LABEL[k] : DIFF_LABEL[k].toLowerCase())))} ${differs.length === 1 ? "differs" : "differ"}.` : null];
  return { same, differs: [...differs], line: parts.filter(Boolean).join(" ") || "The check matched these two records." };
}

// ─── the lead's ⋯ menu (D5): only what the server's `actions` permit ─────────────────────────────
export type MenuKey = "handoff" | "nudge" | "requeue" | "end_buffer" | "reopen" | "recheck" | "stage_fix" | "copy" | "unassign";
export type MenuFacts = {
  readOnly: boolean;
  queue: { id: string; status: string } | null;
  stage: { id: string } | null;
  actions: { canHandoff?: boolean; canRequeue?: boolean; canUnassign?: boolean; canEndBufferInvolvement?: boolean; canChangeStage?: boolean };
};
/**
 * The web ⋯ menu's items in the board's order (D5), each behind the web's condition
 * (lead-detail-workspace.tsx). Copy lead ID writes nothing, so a read-only workspace keeps it.
 */
export function leadMenu(w: MenuFacts): MenuKey[] {
  if (w.readOnly) return ["copy"];
  const out: MenuKey[] = [];
  if (w.queue && w.actions.canHandoff) out.push("handoff");
  if (w.queue) out.push("nudge");
  if (w.queue && w.actions.canRequeue) out.push("requeue");
  if (w.queue && w.actions.canEndBufferInvolvement) out.push("end_buffer");
  if (w.queue?.status === "expired") out.push("reopen");
  out.push("recheck");
  if (w.stage && w.actions.canChangeStage) out.push("stage_fix");
  out.push("copy");
  if (w.queue && w.actions.canUnassign) out.push("unassign");
  return out;
}

/** The release confirmations, worded as lib/transferInbox/constants.ts words them everywhere. */
export type ReleaseAction = "unassign" | "requeue" | "end_buffer";
export const RELEASE_TITLE: Record<ReleaseAction, { title: string; confirm: string }> = {
  unassign: { title: "Give this transfer back?", confirm: "Give it back" },
  requeue: { title: "Put this call back in the queue?", confirm: "Put back in queue" },
  end_buffer: { title: "End the buffer's involvement?", confirm: "End involvement" },
};
export function releaseConfirmation(action: ReleaseAction, names: { customer?: string | null; bufferName?: string | null; agentName?: string | null } = {}) {
  const customer = names.customer?.trim() || "this transfer";
  if (action === "unassign") return `Give ${customer} back to the queue? Nobody will own it until someone claims it. The verification so far is kept for them.`;
  if (action === "requeue") return `Put ${customer} back in the queue? It waits again from now, and whoever claims it picks up the verification where it stopped.`;
  return `End ${names.bufferName?.trim() || "the buffer"}'s involvement? ${names.agentName?.trim() || "The licensed agent"} keeps the call and the verification. This does not unassign the transfer.`;
}

// ─── template forms (D7), ported from lib/templates/logic.ts + visibility.ts ──────────────────────
export type TemplateRule = { field_key: string; op: string; value?: string; values?: string[] };
export type TemplateRuleGroup = { match: "all" | "any"; rules: TemplateRule[] };
export type TemplateLogic = { match: "all" | "any"; rules: (TemplateRule | TemplateRuleGroup)[] };
export type TemplateFormField = { field_key: string; is_required: boolean; show_when?: { field_key: string; equals: string } | null; conditional_on?: { field_key: string; equals: string } | null; width?: "half" | "full"; logic?: TemplateLogic | null; page_skip?: TemplateLogic | null };
export type TemplateFormSection = { section_key: string; label: string; fields: TemplateFormField[]; sort_order: number; skip_when?: TemplateLogic | null };
export type TemplateField = { field_key: string; label: string; type: string; is_required: boolean; options: string[]; sort_order: number; help_text?: string | null; validation?: { placeholder?: string } };
export type FormTemplate = { product_name: string; product_code: string; fields: TemplateField[]; form_definition: { sections: TemplateFormSection[] } };

const isGroup = (item: TemplateRule | TemplateRuleGroup): item is TemplateRuleGroup => Array.isArray((item as TemplateRuleGroup).rules);
const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const norm = (v: unknown) => {
  const text = String(v ?? "").trim();
  const lower = text.toLowerCase();
  return lower === "yes" || lower === "true" ? "true" : lower === "no" || lower === "false" ? "false" : text;
};
const same = (answer: unknown, target: string | undefined) => target !== undefined && (Array.isArray(answer) ? answer.some((a) => norm(a) === norm(target)) : norm(answer) === norm(target));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function ruleHolds(rule: TemplateRule, values: Record<string, unknown>, today = new Date()): boolean {
  const answer = values[rule.field_key];
  switch (rule.op) {
    case "is": return same(answer, rule.value);
    case "is_not": return !same(answer, rule.value);
    case "one_of": return (rule.values ?? []).some((v) => same(answer, v));
    case "filled": return !isEmpty(answer);
    case "empty": return isEmpty(answer);
    case "at_least": case "at_most": {
      const have = num(answer); const limit = num(rule.value);
      if (have === null || limit === null) return false;
      return rule.op === "at_least" ? have >= limit : have <= limit;
    }
    case "age_at_least": case "age_at_most": {
      const age = ageFromDob(answer, today); const limit = num(rule.value);
      if (age === null || limit === null) return false;
      return rule.op === "age_at_least" ? age >= limit : age <= limit;
    }
    default: return false;
  }
}

const groupHolds = (match: "all" | "any", results: boolean[]) => (results.length === 0 ? true : match === "all" ? results.every(Boolean) : results.some(Boolean));
export function logicHolds(logic: TemplateLogic | null | undefined, values: Record<string, unknown>, today = new Date()): boolean {
  if (!logic || logic.rules.length === 0) return true;
  return groupHolds(logic.match, logic.rules.map((item) => (isGroup(item) ? groupHolds(item.match, item.rules.map((r) => ruleHolds(r, values, today))) : ruleHolds(item, values, today))));
}

export function fieldVisible(field: TemplateFormField, values: Record<string, unknown>): boolean {
  if (field.page_skip && field.page_skip.rules.length && logicHolds(field.page_skip, values)) return false;
  if (field.logic && field.logic.rules.length) return logicHolds(field.logic, values);
  const condition = field.show_when ?? field.conditional_on;
  if (!condition) return true;
  const value = values[condition.field_key];
  return Array.isArray(value) ? value.includes(condition.equals) : String(value ?? "") === condition.equals;
}

/** Answers to questions that no longer show are dropped, as the web form does before it posts. */
export function pruneHidden(form: { sections: TemplateFormSection[] }, values: Record<string, unknown>): Record<string, unknown> {
  const next = { ...values };
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of form.sections) {
      const skipped = Boolean(section.skip_when && section.skip_when.rules.length && logicHolds(section.skip_when, next));
      for (const field of section.fields) {
        if ((skipped || !fieldVisible(field, next)) && Object.prototype.hasOwnProperty.call(next, field.field_key)) {
          delete next[field.field_key];
          changed = true;
        }
      }
    }
  }
  return next;
}

/** The questions to draw, in form order, paired two to a line where the form marks them half width. */
export function formLines(template: FormTemplate, values: Record<string, unknown>): { field: TemplateField; placed: TemplateFormField }[][] {
  const byKey = new Map(template.fields.map((f) => [f.field_key, f]));
  const shown: { field: TemplateField; placed: TemplateFormField }[] = [];
  for (const section of template.form_definition.sections) {
    if (section.skip_when && section.skip_when.rules.length && logicHolds(section.skip_when, values)) continue;
    for (const placed of section.fields) {
      const field = byKey.get(placed.field_key);
      if (field && fieldVisible(placed, values)) shown.push({ field, placed });
    }
  }
  const lines: { field: TemplateField; placed: TemplateFormField }[][] = [];
  for (let i = 0; i < shown.length; i += 1) {
    const a = shown[i];
    const b = shown[i + 1];
    const pairable = (x: typeof a) => x.placed.width === "half" && !["long_text", "multi_select"].includes(x.field.type);
    if (b && pairable(a) && pairable(b)) { lines.push([a, b]); i += 1; } else lines.push([a]);
  }
  return lines;
}

// ─── list rows and board cards (D1, D2) ─────────────────────────────────────────────────────────
export type RowTone = "brand" | "warn" | "info" | "ok" | "neutral" | "bad";
export type StageMeta = { id: string; name: string; stage_type?: string | null };
export type RowFacts = { stage_id: string | null; owner_user_id?: string | null; screening_outcome?: string | null; screening_warning?: boolean | null };

const words = (code: string) => {
  const w = code.replace(/[_-]+/g, " ").trim();
  return w ? w[0].toUpperCase() + w.slice(1) : code;
};

/**
 * A list row's one chip, coloured by what it means (board D1): a number the screening flagged reads
 * "Needs review" (warn) and a refused one says why (bad); on the pipeline's first stage a lead
 * someone holds reads "Assigned" (info) and one nobody holds keeps the stage's name (brand);
 * elsewhere the stage's name, sold (won) in ok, lost in neutral, every other stage in brand.
 */
export function rowChip(lead: RowFacts, stages: StageMeta[]): { tone: RowTone; text: string } | null {
  const outcome = lead.screening_outcome ?? null;
  if (outcome === "clear" && lead.screening_warning) return { tone: "warn", text: "Needs review" };
  if (outcome && outcome !== "clear" && outcome !== "unavailable") return { tone: "bad", text: words(outcome) };
  const at = stages.findIndex((s) => s.id === lead.stage_id);
  if (at < 0) return null;
  const stage = stages[at];
  if (at === 0 && lead.owner_user_id) return { tone: "info", text: "Assigned" };
  return { tone: stage.stage_type === "won" ? "ok" : stage.stage_type === "lost" ? "neutral" : "brand", text: stage.name };
}

export type CardFacts = { disposition: string | null; monthly_premium_cents?: number | null; callback_at?: string | null; callback_timezone?: string | null };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Overdue 2 h", "Today 10:30 am", "Callback Thu", "Callback 3 Dec" for the soonest open callback, in the lead's zone. */
export function callbackWords(at: string, zone: string | null | undefined, now = Date.now()): string | null {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  if (t < now) {
    const since = durationSince(at, now);
    return since ? `Overdue ${since}` : "Overdue";
  }
  const tz = zone || "UTC";
  let key: string;
  let today: string;
  let time: string;
  try {
    const day = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    };
    key = day(new Date(t));
    today = day(new Date(now));
    time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(t)).replace(/\s/g, " ").replace(/ AM$/, " am").replace(/ PM$/, " pm");
  } catch {
    return null;
  }
  if (key === today) return `Today ${time}`;
  const days = Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const d = new Date(`${key}T12:00:00Z`);
  return days < 7 ? `Callback ${WEEKDAY[d.getUTCDay()]}` : `Callback ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * A board card's one line, what comes next (board D2): the last outcome, the quote and the soonest
 * callback, each only when the server sent it ("Interested · $48/mo · callback Thu", "Overdue 2 h").
 */
export function cardLine(lead: CardFacts, now = Date.now()): string | null {
  const callback = lead.callback_at ? callbackWords(lead.callback_at, lead.callback_timezone, now) : null;
  const outcome = lead.disposition && !(callback && lead.disposition === "callback_scheduled") ? words(lead.disposition) : null;
  const quote = lead.monthly_premium_cents != null ? `$${Math.round(lead.monthly_premium_cents / 100).toLocaleString("en-US")}/mo` : null;
  const later = callback && (outcome || quote) ? callback.replace(/^Callback /, "callback ").replace(/^Today /, "today ").replace(/^Overdue /, "overdue ") : callback;
  const parts = [outcome, quote, later].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The stage a long-press offers first (board D2 → D6): the one after the card's, else the one before. */
export function nextStage<S extends { id: string }>(stages: S[], currentId: string | null): S | null {
  const at = stages.findIndex((s) => s.id === currentId);
  if (at < 0) return stages[0] ?? null;
  return stages[at + 1] ?? stages[at - 1] ?? null;
}

// ─── the lead page (D3) ─────────────────────────────────────────────────────────────────────────
export type Pronoun = "she" | "he" | "they";
/** "she", "he" or "they", from the lead's own gender answer. */
export function pronoun(values: Record<string, unknown>): Pronoun {
  const raw = [values.gender, values.sex].find((v) => typeof v === "string" && v.trim());
  const g = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (g === "f" || g === "female" || g === "woman") return "she";
  if (g === "m" || g === "male" || g === "man") return "he";
  return "they";
}
export const possessive = (p: Pronoun) => (p === "she" ? "her" : p === "he" ? "his" : "their");

/** Dollars with cents: "$28.00". */
export function usdCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type ReadinessItem = { key: "consent" | "coverage" | "beneficiary" | "bank"; done: boolean; faceAmountCents?: number | null };
const READY_LABEL: Record<ReadinessItem["key"], string> = { consent: "Consent on file", coverage: "Coverage amount picked", beneficiary: "Beneficiary named", bank: "Bank for the draft" };
const READY_ORDER: ReadinessItem["key"][] = ["consent", "coverage", "beneficiary", "bank"];
/** What happens next (board D3): the server's readiness answers in the board's order and words. */
export function readinessLines(items: ReadinessItem[]): { key: string; done: boolean; text: string }[] {
  return READY_ORDER.map((key) => items.find((i) => i.key === key)).filter((i): i is ReadinessItem => Boolean(i)).map((i) => ({
    key: i.key, done: i.done,
    text: i.key === "coverage" && i.done && i.faceAmountCents ? `${READY_LABEL.coverage} · $${Math.round(i.faceAmountCents / 100).toLocaleString("en-US")}` : READY_LABEL[i.key],
  }));
}

/** "Moved to Interested" for a stage-change event whose detail names the stage; null otherwise. */
export function moveTitle(label: string, detail: string | null, stages: { id: string; name: string }[]): string | null {
  if (!/lead stage changed/i.test(label) || !detail) return null;
  const m = /Stage: ([0-9a-f-]{36})/i.exec(detail);
  const stage = m ? stages.find((s) => s.id.toLowerCase() === m[1].toLowerCase()) : null;
  return stage ? `Moved to ${stage.name}` : null;
}

/** "Mon 23 Nov · 10:00 am" style day for an explain line: "Thu" within the week, else "3 Dec". */
export function shortDay(iso: string, zone: string | null | undefined, now = Date.now()): string | null {
  const w = callbackWords(iso, zone, now);
  if (!w) return null;
  return w.replace(/^Callback /, "").replace(/^Today .*/, "today").replace(/^Overdue.*/, "");
}
