// Settings › Products, round 8 (owner 2026-11-12, board settings-r8/products-and-ai P1–P4): what a product
// needs before an agent can quote it on a call, in the order the call uses it. "Sold" is not "ready": a
// product can be switched on with no carrier offering it, no health questions and no quote inputs, so agents
// found out on a live call. Pure and client-safe; the facts come from GET /api/app/products/readiness.

/** The four things, in call order: the form makes the lead, then carriers, the Interview, the Quote step. */
export const NEED_KEYS = ["form", "carriers", "health", "quote"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

/** What the server found for one product. `null` means nothing is set up. */
export type ProductFacts = {
  code: string;
  /** The agency's application (lead intake) form for the product. */
  form: { name: string; appliedAt: string | null } | null;
  /** The agency's switched-on carriers that offer the product, by name. */
  carriers: string[];
  /** A published health-question set made for this product (the agency's own or the Insurvas one). */
  health: { name: string; questions: number; knockouts: number; own: boolean } | null;
  /** A published quote-input template made for this product. */
  quote: { name: string; own: boolean } | null;
};

export type ReadinessPayload = {
  products: ProductFacts[];
  /** The agency's plan, by name, for the "Not in your plan" status line. */
  planName: string | null;
  /** Locked product code → the plans that add it, cheapest first. */
  addedBy: Record<string, string[]>;
};

export type NeedState = "done" | "missing" | "na";

export type Need = {
  key: NeedKey;
  state: NeedState;
  /** The short words in the table ("Form", "4 carriers", "Health questions", "Quote inputs"). */
  short: string;
  /** The sheet's title for the step. */
  title: string;
  /** The sheet's one line under it. */
  detail: string;
  /** The Settings page that sets it up. */
  href: string;
  /** The link's words ("Health questions"). */
  page: string;
  /** What a missing one is called in a sentence ("needs quote inputs"). */
  missingWords: string;
};

export const NEED_HREF: Record<NeedKey, string> = {
  form: "/app/settings#form-templates",
  carriers: "/app/settings#carriers",
  health: "/app/settings#sales-process/health-questions",
  quote: "/app/settings#sales-process/quote-inputs",
};

const PAGE: Record<NeedKey, string> = { form: "Application forms", carriers: "Carriers", health: "Health questions", quote: "Quote inputs" };
const TITLE: Record<NeedKey, string> = { form: "Application form", carriers: "Carriers that offer it", health: "Health questions", quote: "Quote inputs" };
const MISSING_WORDS: Record<NeedKey, string> = { form: "a form", carriers: "a carrier", health: "health questions", quote: "quote inputs" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "North American, Allianz" · "North American, Allianz and 3 more". */
export function namesText(names: readonly string[], shown = 2): string {
  if (names.length <= shown) return names.join(names.length === 2 ? " and " : ", ");
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

function dateText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The four needs of one product. Health questions are not asked for a retirement product (an annuity has no
 * underwriting interview), so there they are "n/a" and never hold the product back.
 */
export function needsFor(category: string, facts: ProductFacts | undefined): Need[] {
  const base = (key: NeedKey) => ({ key, title: TITLE[key], href: NEED_HREF[key], page: PAGE[key], missingWords: MISSING_WORDS[key] });
  const form: Need = facts?.form
    ? { ...base("form"), state: "done", short: "Form", detail: [facts.form.name, dateText(facts.form.appliedAt) ? `set up ${dateText(facts.form.appliedAt)}` : null, "makes the lead"].filter(Boolean).join(" · ") }
    : { ...base("form"), state: "missing", short: "Form", detail: "Not set up. Partners and agents can't create a lead for it." };
  const count = facts?.carriers.length ?? 0;
  const carriers: Need = count
    ? { ...base("carriers"), state: "done", short: plural(count, "carrier"), detail: `${count} · ${namesText(facts!.carriers, 3)}` }
    : { ...base("carriers"), state: "missing", short: "A carrier", detail: "None of your carriers offers it. Agents have no one to quote." };
  const health: Need = category === "retirement"
    ? { ...base("health"), state: "na", short: "Health questions", detail: "Not asked for this kind of product." }
    : facts?.health
      ? { ...base("health"), state: "done", short: "Health questions", detail: [facts.health.name, plural(facts.health.questions, "question"), facts.health.knockouts ? `${facts.health.knockouts} knock a carrier out` : null, facts.health.own ? null : "the Insurvas set"].filter(Boolean).join(" · ") }
      : { ...base("health"), state: "missing", short: "Health questions", detail: "None made for it. Calls fall back to the Final Expense questions." };
  const quote: Need = facts?.quote
    ? { ...base("quote"), state: "done", short: "Quote inputs", detail: [facts.quote.name, facts.quote.own ? null : "the Insurvas inputs"].filter(Boolean).join(" · ") }
    : { ...base("quote"), state: "missing", short: "Quote inputs", detail: "Not set up. Agents can't run a quote, so applications stop at the Quote step." };
  return [form, carriers, health, quote];
}

export type Readiness = { tone: "good" | "warning" | "neutral"; label: string; missing: Need[] };

/** The row's one chip: Ready, Needs N things, or Not sold. A product not sold is never "not ready". */
export function readinessOf(sold: boolean, needs: readonly Need[]): Readiness {
  const missing = needs.filter((need) => need.state === "missing");
  if (!sold) return { tone: "neutral", label: "Not sold", missing };
  if (!missing.length) return { tone: "good", label: "Ready", missing };
  return { tone: "warning", label: `Needs ${plural(missing.length, "thing")}`, missing };
}

/** "Agency Plus" · "Agency Plus or Enterprise" · null when no plan on sale adds it. */
export function addedByText(plans: readonly string[] | undefined): string | null {
  if (!plans?.length) return null;
  return plans.length === 1 ? plans[0] : `${plans.slice(0, -1).join(", ")} or ${plans[plans.length - 1]}`;
}

export type ProductFilter = "all" | "sold" | "setup" | "off";

type FilterRow = { name: string; sold: boolean; ready: Readiness | null };

/** The list's filter and search, as the table applies them. */
export function matchesFilter(row: FilterRow, filter: ProductFilter, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q && !row.name.toLowerCase().includes(q)) return false;
  if (filter === "sold") return row.sold;
  if (filter === "off") return !row.sold;
  if (filter === "setup") return row.sold && Boolean(row.ready?.missing.length);
  return true;
}
