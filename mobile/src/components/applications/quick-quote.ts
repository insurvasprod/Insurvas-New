import { face, tierLabel } from "./logic";

/**
 * Board E1 · Quick quote, the rules apart from the screen. The carriers are the agency's own, as the
 * web's Quote step offers them (GET /api/app/quoting/catalog — lib/applications/catalog.ts
 * quoteCatalog: switched on in Settings › Carriers, appointment checked for the state, each product's
 * tiers, issue ages and face limits). Insurvas holds no premium rate tables, so no premium is shown or
 * ranked here: a carrier is listed with what the agency's own set-up says about this client.
 */
export type QuickProduct = {
  id: string; carrierId: string; name: string; productCode: string; tiers: string[];
  issueAgeMin: number | null; issueAgeMax: number | null; faceMinCents: number | null; faceMaxCents: number | null;
};
export type QuickCarrier = { id: string; name: string; appointed: { ok: boolean; reason: string | null }; products: QuickProduct[] };
export type QuickCatalog = { carriers: QuickCarrier[] };

/** The three final expense tiers the board's switch offers, in its words. */
export const QUICK_TIERS: { key: string; label: string }[] = [
  { key: "level", label: "Level" },
  { key: "graded", label: "Graded" },
  { key: "gi", label: "Guaranteed" },
];
/** A contracted carrier with no product set up yet is quotable on every tier (the web's unconfiguredProduct). */
const ALL_TIERS = ["level", "graded", "modified", "gi"];

export type QuickRow = {
  carrierId: string; carrierName: string; productId: string | null; productLabel: string; productCode: string; tier: string;
  /** What keeps this carrier from writing it, in the agency's own set-up's words; null when nothing does. */
  problem: string | null;
};

export type QuickInput = { age: number | null; faceCents: number | null; tier: string; productCode?: string };

function problemOf(c: QuickCarrier, p: QuickProduct | null, input: QuickInput): string | null {
  if (!c.appointed.ok) return c.appointed.reason ?? "Not appointed in this state";
  if (!p) return null;
  if (input.age !== null && p.issueAgeMin !== null && input.age < p.issueAgeMin) return `Issues from age ${p.issueAgeMin}`;
  if (input.age !== null && p.issueAgeMax !== null && input.age > p.issueAgeMax) return `Issues to age ${p.issueAgeMax}`;
  if (input.faceCents !== null && p.faceMinCents !== null && input.faceCents < p.faceMinCents) return `From ${face(p.faceMinCents)}`;
  if (input.faceCents !== null && p.faceMaxCents !== null && input.faceCents > p.faceMaxCents) return `Up to ${face(p.faceMaxCents)}`;
  return null;
}

/**
 * Each carrier that offers the tier on the product line: its first matching product (or the carrier
 * alone when none is set up). The ones that can write this client come first, then by name.
 */
export function quickQuoteRows(catalog: QuickCatalog | null, input: QuickInput): QuickRow[] {
  if (!catalog) return [];
  const line = input.productCode ?? "final_expense";
  const out: QuickRow[] = [];
  for (const c of catalog.carriers) {
    const products = c.products.filter((p) => p.productCode === line);
    if (c.products.length && !products.length) continue;
    const product = products.find((p) => (p.tiers.length ? p.tiers : ["level"]).includes(input.tier)) ?? null;
    if (products.length && !product) continue;
    if (!products.length && !ALL_TIERS.includes(input.tier)) continue;
    out.push({
      carrierId: c.id, carrierName: c.name, productId: product?.id ?? null, productLabel: product?.name ?? "", productCode: line, tier: input.tier,
      problem: problemOf(c, product, input),
    });
  }
  return out.sort((a, b) => Number(Boolean(a.problem)) - Number(Boolean(b.problem)) || a.carrierName.localeCompare(b.carrierName));
}

/** "Senior Choice · Level", then what stands in the way when something does. */
export function quickMeta(r: QuickRow): string {
  return [r.productLabel || null, tierLabel(r.tier), r.problem].filter(Boolean).join(" · ");
}

/** "68" → 68; anything else (blank, 0, 131) is no age. */
export function ageOf(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n > 0 && n < 131 ? n : null;
}
