import { csvCell } from "../csv/cell.ts";
import { AUDITED_SECTIONS, type SettingsAuditEntry, type SettingsChangeType } from "./constants.ts";

/**
 * Settings round 8 · Settings history. One audit row as a person reads it: "Price band max $14.50 →
 * $15.00", never "price_band_max_cents: 1450 → 1500". Pure (no server-only, no aliases): the screen,
 * the change sheet, the CSV and the tests share it.
 *
 * The log stores what each writer wrote: a snapshot label ("Invoice tolerance cents"), and old/new
 * values as text (cents, basis points, milliseconds, enum keys, booleans, JSON, ids). The wording
 * here is built from the setting key's unit and each section's own labels; anything it does not know
 * still reads as words (snake_case → "Writing agent"), and the raw row stays behind "Show technical
 * details".
 */

/* ── kinds: the one chip a row carries ──────────────────────────────────── */

export type ChangeKind = "changed" | "added" | "removed" | "reset";
export const CHANGE_KINDS: readonly ChangeKind[] = ["changed", "added", "removed", "reset"];
export const KIND_LABEL: Record<ChangeKind, string> = { changed: "Changed", added: "Added", removed: "Removed", reset: "Reset" };
export const KIND_TONE: Record<ChangeKind, "neutral" | "good" | "danger" | "info"> = { changed: "neutral", added: "good", removed: "danger", reset: "info" };
/** The log's change type behind each kind, for the API filter. */
export const KIND_TYPE: Record<ChangeKind, SettingsChangeType> = { changed: "update", added: "create", removed: "delete", reset: "reset_to_default" };
export const kindOf = (type: SettingsChangeType): ChangeKind => (type === "create" ? "added" : type === "delete" ? "removed" : type === "reset_to_default" ? "reset" : "changed");

/* ── sections: where a change lives in Settings today ───────────────────── */

/**
 * The audit section key → the Settings registry section (lib/settings/sections.ts) that holds it now.
 * Keys the registry has under the same id map to themselves and are not listed.
 */
export const SECTION_HOME: Readonly<Record<string, string>> = {
  "sales-preferences": "sales-process",
  "sales-pipeline-sync": "sales-process",
  "sales-carriers": "carriers",
  "carrier-rules": "carriers",
  dispositions: "pipelines",
};

/** Names for sections the registry may not have (the history must still name them). */
const SECTION_FALLBACK: Readonly<Record<string, string>> = {
  "my-profile": "My profile",
  products: "Products",
  carriers: "Carriers",
  "sales-process": "Sales process",
  pipelines: "Pipelines & outcomes",
  integrations: "API keys & webhooks",
  "lead-posting": "Lead posting",
  cadence: "Dialing cadence",
  calendar: "Calendar & availability",
  "queue-sla": "Inbound settings",
  "form-templates": "Application forms",
  "sales-ai": "AI assistant",
  "sales-extension": "Browser extension",
};

/** The sub-place inside the home section, when it says more than the home's name. */
const SECTION_PLACE: Readonly<Record<string, string>> = {
  "sales-preferences": "Quote & case checks",
  "sales-pipeline-sync": "Application stages",
  "sales-carriers": "Carriers and products",
  "carrier-rules": "Carrier terms",
  dispositions: "Call outcomes",
};

export const homeOf = (sectionKey: string) => SECTION_HOME[sectionKey] ?? sectionKey;

/** "Sales process": the section a person knows. `registryLabel` reads lib/settings/sections.ts (the screen passes it). */
export function areaLabel(sectionKey: string, registryLabel?: (id: string) => string | undefined): string {
  const home = homeOf(sectionKey);
  return registryLabel?.(home) ?? SECTION_FALLBACK[home] ?? AUDITED_SECTIONS.find((s) => s.key === sectionKey)?.label ?? sentence(home.replace(/-/g, " "));
}

/** "Settings › Sales process › Quote & case checks". */
export function wherePath(sectionKey: string, registryLabel?: (id: string) => string | undefined): string {
  const place = SECTION_PLACE[sectionKey];
  return ["Settings", areaLabel(sectionKey, registryLabel), ...(place ? [place] : [])].join(" › ");
}

/** The filter's name for one audit section ("Sales process · Quote & case checks"). */
export function sectionFilterLabel(sectionKey: string, registryLabel?: (id: string) => string | undefined): string {
  const place = SECTION_PLACE[sectionKey];
  return place ? `${areaLabel(sectionKey, registryLabel)} · ${place}` : areaLabel(sectionKey, registryLabel);
}

/* ── settings we know by key: their screen's words and what they do ─────── */

type Known = { label: string; does?: string; unit?: Unit };
type Unit = "money" | "percent" | "days" | "ms" | "month" | "count" | "phone";

/** By `section|setting key` (ids in keys are written `<id>`). */
const KNOWN: Readonly<Record<string, Known>> = {
  "accounting|invoice_tolerance_cents": { label: "Flag a bill that differs by more than", does: "A vendor bill this far from what was expected is flagged for review.", unit: "money" },
  "accounting|bank_amount_tolerance_cents": { label: "Bank match: amounts may differ by", does: "A deposit within this amount of a carrier payment is offered as a match.", unit: "money" },
  "accounting|bank_window_days": { label: "Bank match: days to look either side", does: "How far from the payment date a deposit can land and still be offered as a match.", unit: "days" },
  "accounting|payout_dispute_tolerance_cents": { label: "Ignore payout disputes under", does: "A partner's dispute below this amount does not open a dispute.", unit: "money" },
  "accounting|payout_statement_footer": { label: "Statement footer", does: "The last lines on every partner payout statement." },
  "accounting|payout_draft_days": { label: "Draft payouts this many days ahead", unit: "days" },
  "accounting|payout_cadence": { label: "Pay partners" },
  "accounting|payout_auto_publish": { label: "Publish payout statements on their own" },
  "accounting|persistency_month": { label: "Persistency is measured at", does: "The policy month the persistency figure is read at.", unit: "month" },
  "accounting|producer_default_split_bp": { label: "Producer default split", does: "The share of commission a new producer's pay plan starts with.", unit: "percent" },
  "accounting|producer_recovery_cap_bp": { label: "Recover at most this much of a payout", unit: "percent" },
  "accounting|producer_default_basis": { label: "Pay producers on" },
  "accounting|producer_negative_policy": { label: "When a producer's balance goes negative" },
  "accounting|producers_see_balance": { label: "Producers see their balance" },
  "accounting|producer_share_fees": { label: "Producers share fees" },
  "accounting|sample_threshold": { label: "Show a figure once it has", does: "Below this many policies a rate is marked as too few to trust.", unit: "count" },
  "accounting|tax_1099_threshold_cents": { label: "1099 threshold", does: "A partner paid at least this much in a year needs a 1099.", unit: "money" },
  "accounting|default_basis": { label: "Count money when" },
  "accounting|fy_start_month": { label: "Financial year starts in" },
  "retention|queue_min_band": { label: "Put a policy in the queue from", does: "Policies at this risk or higher go into the retention queue." },
  "retention|queue_owner_paper_bill": { label: "Who works paper-bill reminders" },
  "retention|queue_owner_reinstatement": { label: "Who works reinstatements" },
  "retention|queue_owner_save_queue": { label: "Who works the save queue" },
  "retention|bill_talk_track": { label: "Paper-bill talk track" },
  "compliance|complaint_deadlines.complaints.redDays": { label: "Complaints turn red with", does: "A complaint this close to its response deadline is shown in red.", unit: "days" },
  "compliance|deletion_requests.deletion.holdDays": { label: "Hold a deletion request for", does: "Days a verified deletion waits before it can run, so it can still be cancelled.", unit: "days" },
  "compliance|transfer_gate.gate.timeoutMs": { label: "Time allowed for each transfer check", unit: "ms" },
  "compliance|purge_job.purge.recipients": { label: "Who hears about each purge" },
  "calling-windows|agency_hours": { label: "Agency calling hours" },
  "calling-windows|noSunday": { label: "No calls on Sundays" },
  "calling-windows|noFederalHolidays": { label: "No calls on federal holidays" },
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HAS_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const keyShape = (key: string) => key.replace(UUID, "<id>");
const knownOf = (entry: Pick<SettingsAuditEntry, "sectionKey" | "settingKey">) => KNOWN[`${entry.sectionKey}|${keyShape(entry.settingKey)}`] ?? null;

/** What a setting does, when its section says (the sheet's "What it does"). */
export function settingPurpose(entry: Pick<SettingsAuditEntry, "sectionKey" | "settingKey">): string | null {
  return knownOf(entry)?.does ?? null;
}

/** The unit a value is stored in, read off the setting key. */
function unitOf(entry: Pick<SettingsAuditEntry, "sectionKey" | "settingKey">): Unit | null {
  const known = knownOf(entry);
  if (known?.unit) return known.unit;
  const key = entry.settingKey;
  if (/(?:_cents|Cents)$/.test(key)) return "money";
  if (/(?:_bp|Bp)$/.test(key)) return "percent";
  if (/(?:_days|Days)$/.test(key)) return "days";
  if (/(?:_ms|Ms)$/.test(key)) return "ms";
  if (/phone|mobile/i.test(key)) return "phone";
  return null;
}

/* ── words ──────────────────────────────────────────────────────────────── */

const sentence = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const words = (token: string) => token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The snapshot label as words: "Bank amount tolerance cents" → "Bank amount tolerance";
 * "Complaint deadlines › complaints › redDays" → "Complaint deadlines › Red days";
 * "Retention rules › call attempt logs:CA" → "Retention rules › Call attempt logs (CA)".
 */
export function cleanLabel(label: string): string {
  const parts = label.split(/\s*›\s*/).filter(Boolean);
  const kept: string[] = [];
  for (const raw of parts) {
    const state = /:([A-Z]{2,3})$/.exec(raw)?.[1] ?? null;
    let part = raw.replace(/:[A-Z]{2,3}$/, "").replace(/:/g, " ").trim();
    // A stored key ("redDays", "holdDays", "call_attempt_logs") becomes words; a written label stays as written.
    if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$|_/.test(part)) part = words(part).replace(/\b(api|ach|npn|zip|qa|ai|id|sla|dnc|tcpa|ftc)\b/g, (m) => m.toUpperCase());
    part = part.replace(/\s+(?:cents|bp|ms)$/i, "");
    if (state) part = `${part} (${state})`;
    const previous = kept[kept.length - 1]?.toLowerCase() ?? "";
    // A group key repeating its parent ("Complaint deadlines › complaints") says nothing new.
    if (/^[a-z]+$/.test(part) && previous && previous.includes(part.slice(0, 5))) continue;
    kept.push(sentence(part));
  }
  return kept.join(" › ") || label;
}

/** Families of keys a section writes with an id or a code inside, by key prefix. */
const KNOWN_PREFIX: ReadonlyArray<{ section: string; prefix: string; label: (rest: string) => string }> = [
  { section: "compliance", prefix: "legal_holds.place:", label: () => "Legal hold placed" },
  { section: "compliance", prefix: "legal_holds.lift:", label: () => "Legal hold lifted" },
  { section: "accounting", prefix: "tax_category:commission_entry_type:", label: (rest) => `Tax category for ${words(rest)} commission` },
  { section: "accounting", prefix: "tax_category:", label: (rest) => `Tax category for ${words(rest.replace(/:/g, " "))}` },
];

/** The label a person reads for this row. */
export function settingName(entry: Pick<SettingsAuditEntry, "sectionKey" | "settingKey" | "settingLabel">): string {
  const known = knownOf(entry)?.label;
  if (known) return known;
  const family = KNOWN_PREFIX.find((f) => f.section === entry.sectionKey && entry.settingKey.startsWith(f.prefix));
  if (family) return family.label(entry.settingKey.slice(family.prefix.length));
  // An outcome's key names it by its code ("Outcome “application_submitted” moves the lead").
  return cleanLabel(entry.settingLabel.replace(/“([a-z0-9_]+)”/g, (_, code: string) => `“${sentence(words(code))}”`)).replace(/\s+(days?)$/i, "");
}

const ZONES: Readonly<Record<string, string>> = {
  "America/New_York": "Eastern time", "America/Detroit": "Eastern time", "America/Indiana/Indianapolis": "Eastern time",
  "America/Chicago": "Central time", "America/Denver": "Mountain time", "America/Phoenix": "Arizona time",
  "America/Los_Angeles": "Pacific time", "America/Anchorage": "Alaska time", "Pacific/Honolulu": "Hawaii time",
};

export const dollars = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Names for ids the server could resolve (people, stages), keyed by the id. */
export type IdNames = Readonly<Record<string, string>>;

function idWords(text: string, names: IdNames): string {
  return text
    .replace(/\bstage ([0-9a-f-]{36})/gi, (_, id: string) => (names[id.toLowerCase()] ? `“${names[id.toLowerCase()]}”` : "another stage"))
    .replace(UUID, (id) => (names[id.toLowerCase()] ? `“${names[id.toLowerCase()]}”` : "another one"));
}

/** An object value in a few words: "21 days · CA CDI request for information: 21 days." */
function objectWords(value: Record<string, unknown>, names: IdNames): string {
  const bits: string[] = [];
  const num = (k: string) => (typeof value[k] === "number" ? (value[k] as number) : null);
  if (num("response_days") !== null) bits.push(plural(num("response_days") as number, "day"));
  const years = num("retain_years") ?? num("retention_years");
  const months = num("retain_months") ?? num("retention_months");
  const days = num("retain_days") ?? num("retention_days");
  if (years !== null) bits.push(`keep ${plural(years, "year")}`);
  else if (months !== null) bits.push(`keep ${plural(months, "month")}`);
  else if (days !== null) {
    // 1,461 days is "4 years": a retention period is set in whole years and stored in days.
    const asYears = Math.round(days / 365.25);
    bits.push(`keep ${asYears >= 1 && days >= asYears * 365 - 1 && days <= asYears * 366 ? plural(asYears, "year") : plural(days, "day")}`);
  }
  if (typeof value.action === "string") bits.push(`then ${words(value.action)}`);
  const note = typeof value.note === "string" ? value.note : typeof value.notes === "string" ? value.notes : null;
  if (bits.length === 0) {
    for (const [k, v] of Object.entries(value)) {
      if (bits.length >= 3) break;
      if (k === "note" || k === "notes" || v === null || typeof v === "object") continue;
      bits.push(`${words(k)} ${scalarWords(String(v), null, names)}`);
    }
  }
  if (note) bits.push(note);
  return sentence(bits.join(" · ")) || "Details changed";
}

function scalarWords(raw: string, unit: Unit | null, names: IdNames): string {
  const text = raw.trim();
  const n = Number(text);
  const numeric = text !== "" && Number.isFinite(n);
  if (numeric && unit === "money") return dollars(n);
  if (numeric && unit === "percent") return `${(n / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (numeric && unit === "days") return plural(n, "day");
  if (numeric && unit === "ms") return n % 1000 === 0 ? plural(n / 1000, "second") : `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} seconds`;
  if (numeric && unit === "month") return `month ${n}`;
  if (numeric && unit === "count") return plural(n, "policy", "policies");
  if (unit === "phone" && /^\+?1?\d{10}$/.test(text.replace(/\D/g, "").slice(-11))) {
    const d = text.replace(/\D/g, "").slice(-10);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  // Unitless numbers (a ZIP code, an NPN, a count typed as text) read as typed.
  if (numeric) return text;
  if (ZONES[text]) return ZONES[text];
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(text)) return text.split("/")[1].replace(/_/g, " ") + " time";
  if (HAS_ID.test(text)) return idWords(text, names);
  // An enum key ("writing_agent", "gross_receipts", "medium") reads as words.
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(text)) return sentence(words(text));
  return text;
}

/** One stored value as words. Null when there was none. */
export function valueWords(raw: string | null, unit: Unit | null, names: IdNames = {}): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "" || text === "null") return null;
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return "None";
        const items = parsed.map((item) => (typeof item === "object" && item !== null ? objectWords(item as Record<string, unknown>, names) : scalarWords(String(item), unit, names)));
        const people = parsed.every((item) => typeof item === "string" && /^[0-9a-f-]{36}$/i.test(item));
        if (people && items.some((item) => item === "another one")) return plural(parsed.length, "person", "people");
        return items.map((item) => item.replace(/^“|”$/g, "")).join(", ");
      }
      if (parsed && typeof parsed === "object") return objectWords(parsed as Record<string, unknown>, names);
    } catch {
      // not JSON after all: read as text
    }
  }
  return scalarWords(text, unit, names);
}

/** A stored key or secret prefix is never shown ("isk_94cnKJgL…"). */
const SECRETISH = /^[a-z]{2,6}_[A-Za-z0-9]{4,}…?$/;
/** Values the writer meant as what happened, not as a value. */
const HAPPENED = new Set(["edited", "archived", "unarchived", "restored", "created", "added", "removed", "deleted", "revoked", "rotated", "uploaded"]);

export type DescribedChange = {
  /** "Price band max". */
  label: string;
  /** "$14.50" (null when there was none). */
  before: string | null;
  after: string | null;
  /** What happened when it is not "before → after": "turned on", "removed", "set to $15.00". */
  phrase: string | null;
  /** Before or after is long text: the row shows it shortened, the sheet in full. */
  long: boolean;
  kind: ChangeKind;
};

const LONG = 48;
export const shorten = (text: string, max = LONG) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function describeChange(entry: Pick<SettingsAuditEntry, "sectionKey" | "settingKey" | "settingLabel" | "oldValue" | "newValue" | "changeType">, names: IdNames = {}): DescribedChange {
  const label = settingName(entry);
  const unit = unitOf(entry);
  const kind = kindOf(entry.changeType);
  const secret = /^api_key:/.test(entry.settingKey);
  const read = (raw: string | null) => (secret && raw && SECRETISH.test(raw.trim()) ? null : valueWords(raw, unit, names));
  let before = read(entry.oldValue);
  let after = read(entry.newValue);
  const flag = (value: string | null) => (value === null ? null : /^(true|on|yes)$/i.test(value) ? true : /^(false|off|no)$/i.test(value) ? false : undefined);
  const long = Boolean((before && before.length > LONG) || (after && after.length > LONG));
  const quoteLong = (value: string | null) => (value && long && !/^\$|^\d/.test(value) ? `“${value}”` : value);

  let phrase: string | null = null;
  const was = flag(entry.oldValue?.trim() ?? null);
  const now = flag(entry.newValue?.trim() ?? null);
  const isFlag = now === true || now === false;
  if (isFlag) {
    before = was === true ? "On" : was === false ? "Off" : before;
    after = now ? "On" : "Off";
  }
  if (entry.changeType === "reset_to_default") {
    phrase = after ? `back to the default, ${quoteLong(after)}` : "back to the default";
  } else if (entry.changeType === "delete" && !after) {
    phrase = secret ? "revoked" : "removed";
  } else if (isFlag) {
    phrase = now ? "turned on" : "turned off";
  } else if (after && HAPPENED.has(after.toLowerCase())) {
    phrase = after.toLowerCase();
  } else if (after && /^New \w+ uploaded$/.test(after)) {
    phrase = "uploaded";
  } else if (!before && after) {
    phrase = `set to ${quoteLong(after.replace(/^to (?=“|another)/, ""))}`;
  } else if (before && !after) {
    phrase = "cleared";
  } else if (!before && !after) {
    phrase = kind === "added" ? "added" : "changed";
  }
  return { label, before: quoteLong(before), after: quoteLong(after), phrase, long, kind };
}

/** The row's sentence as text (search, the CSV, screen readers): "Price band max $14.50 → $15.00". */
export function changeSentence(change: DescribedChange): string {
  if (change.phrase) return `${change.label} ${change.phrase}`;
  return `${change.label} ${change.before ?? "nothing"} → ${change.after ?? "nothing"}`;
}

/* ── people ─────────────────────────────────────────────────────────────── */

const ROLE_WORDS: Readonly<Record<string, string>> = { owner: "Owner", admin: "Admin", manager: "Manager", agent: "Producer", producer: "Producer", bookkeeper: "Bookkeeper", setter: "Setter", qa: "QA" };

/** "Dana Ruiz"; the system and a person no longer on the team are named too. */
export function whoName(entry: Pick<SettingsAuditEntry, "actorName" | "source">): string {
  return entry.actorName ?? (entry.source === "system" ? "Insurvas" : entry.source === "migration" ? "Insurvas" : "Someone no longer on the team");
}
export const roleWords = (role: string | null) => (role ? ROLE_WORDS[role] ?? sentence(words(role)) : null);
/** Two letters for the avatar. */
export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

/* ── saves: entries written together ────────────────────────────────────── */

/** One person, one section, the same minute: one save. */
export const saveKey = (entry: Pick<SettingsAuditEntry, "actorUserId" | "actorName" | "sectionKey" | "occurredAt">) =>
  `${entry.actorUserId ?? entry.actorName ?? "-"}|${entry.sectionKey}|${Math.floor(new Date(entry.occurredAt).getTime() / 60_000)}`;

/* ── the export ─────────────────────────────────────────────────────────── */

/**
 * The CSV of what the filters show, in the words on screen: when, who, section, setting, before,
 * after, kind. Cells go through the shared, formula-guarded csvCell.
 */
export function plainHistoryCsv(entries: readonly SettingsAuditEntry[], names: IdNames = {}, registryLabel?: (id: string) => string | undefined): string {
  const head = ["When (UTC)", "Who", "Role then", "Section", "Setting", "Before", "After", "Kind", "Reason"];
  const lines = entries.map((entry) => {
    const change = describeChange(entry, names);
    const before = change.phrase && !change.before ? "" : change.before ?? "";
    const after = change.phrase && !change.after ? change.phrase : change.after ?? "";
    return [entry.occurredAt, whoName(entry), roleWords(entry.actorRole), areaLabel(entry.sectionKey, registryLabel), change.label, before.replace(/^“|”$/g, ""), after.replace(/^“|”$/g, ""), KIND_LABEL[change.kind], entry.reason].map(csvCell).join(",");
  });
  return [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
