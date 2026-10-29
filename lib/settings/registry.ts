import type { TenantRole } from "@/lib/tenantAuth/roles";
import type { SettingsGroup, SettingsItem, SettingsSection } from "./sections";

/**
 * The settings shell's logic (LA-8.1, Notion sprint): which sections a person may see, in what
 * order, where each one opens, and search across all of them.
 *
 * Everything here takes the section list as an argument, so a section registered anywhere — or a
 * made-up one in a test — is gated, grouped and found without this file changing. Nothing here
 * reads or writes a setting's value; it only knows where settings live.
 *
 * Client-safe: the rail runs this too.
 */

/** Fixed, in this order. A section moves group by changing its one `group` field. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = ["Your account", "Agency", "Contracting", "Sales process", "Leads & dialing", "Money & compliance", "Platform"];

/** The menu's gate: feature AND role. A section that fails either is absent, never greyed out. */
export function sectionAllowed(section: Pick<SettingsSection, "required_feature" | "required_roles" | "disabled">, granted: ReadonlySet<string>, role: TenantRole): boolean {
  if (section.disabled) return false;
  if (section.required_feature && !granted.has(section.required_feature)) return false;
  if (section.required_roles && !section.required_roles.includes(role)) return false;
  return true;
}

/** The sections this person may open, in group order then `sort_order`. */
export function visibleSections<T extends SettingsSection>(sections: readonly T[], granted: Iterable<string>, role: TenantRole): T[] {
  const have = granted instanceof Set ? (granted as ReadonlySet<string>) : new Set(granted);
  const rank = (group: SettingsGroup) => {
    const index = SETTINGS_GROUPS.indexOf(group);
    return index < 0 ? SETTINGS_GROUPS.length : index;
  };
  return sections
    .filter((section) => sectionAllowed(section, have, role))
    .map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section.group) - rank(b.section.group) || a.section.sort_order - b.section.sort_order || a.index - b.index)
    .map(({ section }) => section);
}

/** Groups with at least one visible section. An empty group renders nothing, not a bare heading. */
export function groupSections<T extends SettingsSection>(visible: readonly T[]): { group: SettingsGroup; items: T[] }[] {
  return SETTINGS_GROUPS
    .map((group) => ({ group, items: visible.filter((section) => section.group === group) }))
    .filter((run) => run.items.length > 0);
}

/** Where a section opens: its own module's screen, or its panel inside /app/settings. */
export function sectionHref(section: Pick<SettingsSection, "id" | "route">): string {
  return section.route ?? `/app/settings#${section.id}`;
}

/**
 * Where one setting opens. An in-page panel's anchor rides after the tab id (`#tab/anchor`) so the
 * tab is selected first and the control revealed second; another module's screen takes the anchor
 * as its own hash.
 */
export function itemHref(section: Pick<SettingsSection, "id" | "route">, item: Pick<SettingsItem, "anchor">): string {
  return section.route ? `${section.route}#${item.anchor}` : `/app/settings#${section.id}/${item.anchor}`;
}

/**
 * Sections merged into another (2026-10-26: Carrier library and States & licences became Carriers;
 * 2026-10-27: Dispositions joined Pipelines as Pipelines & outcomes; Carrier field maps became the
 * Carriers section's Field maps tab).
 * Old links, bookmarks and emails keep landing on the right place, on the right step.
 */
const MOVED_TABS: Record<string, string> = { "carrier-library": "carriers", "states-licences": "carriers/carriers-states", dispositions: "pipelines", alerts: "my-profile/notifications", "sales-carriers": "carriers", "sales-field-maps": "carriers/carriers-maps" };

/** A settings hash split into the tab and the control inside it: "sales-preferences/qa-buffer". */
export function parseSettingsHash(hash: string): { tab: string; anchor: string | null } {
  const given = hash.replace(/^#/, "");
  const [head, ...rest] = given.split("/");
  const raw = MOVED_TABS[head] ? [MOVED_TABS[head], ...rest].join("/") : given;
  const slash = raw.indexOf("/");
  return slash < 0 ? { tab: raw, anchor: null } : { tab: raw.slice(0, slash), anchor: raw.slice(slash + 1) || null };
}

// ── Search ────────────────────────────────────────────────────────────────────────────────────

/**
 * Words that carry no meaning in a settings question. "What do I owe Apex" is a question about the
 * payout cadence; only "owe" is doing any work, and "Apex" (a partner's name) matches nothing.
 */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "change", "do", "does", "for", "from", "how", "i", "in", "is", "it", "me", "my", "of",
  "on", "or", "our", "set", "setting", "settings", "the", "to", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

const normalise = (value: string) => value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const words = (value: string) => normalise(value).split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word));

export type SettingsSearchHit = {
  /** "Settings › Section" or "Settings › Section › Setting". */
  title: string;
  meta: string;
  href: string;
  score: number;
};

/**
 * Score one target. A whole-phrase match beats word matches; a label beats a keyword beats the
 * description. Each query word scores once, at its best field, and a word that matches only as a
 * prefix ("draft" in "drafts") scores lower than a whole word.
 */
function score(query: string, terms: string[], fields: { label: string; keywords: readonly string[]; description: string }): number {
  const label = normalise(fields.label);
  const keywords = fields.keywords.map(normalise);
  const description = normalise(fields.description);
  let total = 0;
  if (query && label === query) total += 100;
  else if (query && label.includes(query)) total += 60;
  if (query && keywords.some((keyword) => keyword === query)) total += 50;
  else if (query && keywords.some((keyword) => keyword.includes(query))) total += 30;
  for (const term of terms) {
    const whole = (text: string) => ` ${text} `.includes(` ${term} `);
    const part = (text: string) => text.split(" ").some((word) => word.startsWith(term));
    if (whole(label)) total += 12;
    else if (keywords.some(whole)) total += 10;
    else if (part(label)) total += 6;
    else if (keywords.some(part)) total += 5;
    else if (whole(description)) total += 3;
  }
  return total;
}

/**
 * Search the sections a person may open, and the individual settings inside them. Gate first, so a
 * setting someone cannot open is never offered — a result that answers 403 is worse than none.
 * A matching setting lands on its anchor; a matching section lands on the section.
 */
export function searchSettings(sections: readonly SettingsSection[], granted: Iterable<string>, role: TenantRole, query: string, limit = 5): SettingsSearchHit[] {
  const phrase = normalise(query);
  const terms = words(query);
  if (!phrase || (!terms.length && phrase.length < 2)) return [];
  const hits: SettingsSearchHit[] = [];
  for (const section of visibleSections(sections, granted, role)) {
    const sectionScore = score(phrase, terms, { label: section.label, keywords: section.search_keywords ?? [], description: section.description });
    if (sectionScore > 0) hits.push({ title: `Settings › ${section.label}`, meta: section.short ?? section.description, href: sectionHref(section), score: sectionScore });
    for (const item of section.items ?? []) {
      const itemScore = score(phrase, terms, { label: item.label, keywords: item.keywords ?? [], description: "" });
      // A setting is the more precise landing, so it wins a tie with its own section.
      if (itemScore > 0) hits.push({ title: `Settings › ${section.label} › ${item.label}`, meta: section.label, href: itemHref(section, item), score: itemScore + 1 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Words that stay lower-case inside a Title Case label, unless they start it. */
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "via", "vs"]);

/**
 * Settings names as they are shown (manager review, 2026-10-28: "C should be capital"): Title Case
 * for navigation, tabs and headings. The registry keeps its sentence-case data, which search and
 * tests match on. "API keys & webhooks" → "API Keys & Webhooks"; acronyms are left as written.
 */
export function titleLabel(label: string): string {
  return label
    .split(" ")
    .map((word, index) => {
      if (!word || /[A-Z]/.test(word.slice(1))) return word;
      if (index > 0 && MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.replace(/^(\p{L})/u, (letter) => letter.toUpperCase()).replace(/-(\p{L})/gu, (_, letter: string) => `-${letter.toUpperCase()}`);
    })
    .join(" ");
}
