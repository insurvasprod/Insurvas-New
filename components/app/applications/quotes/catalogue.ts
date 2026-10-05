// The carrier products the Quote step can quote against (LA-3.4, 3.5, 3.6), in one shape for both
// modes: the live catalogue from GET /api/app/applications/cases/{caseId}/catalog, and the DESIGN
// SAMPLE below for ?preview=sample. Client-safe: no imports beyond constants.
//
// The live catalogue carries no commission figures — payout is computed on the server's quote rows
// and arrives on each QuoteView. The sample carries its own contract levels so the preview can
// estimate one locally.

import type { PaymentMethod } from "@/lib/applications/constants";
import { PRODUCT_LABEL, TIER_LABEL } from "@/lib/applications/constants";

export type AgeBasis = "nearest" | "last";

export type CarrierProduct = {
  /** carrier_products.id (live); null for the sample. */
  id: string | null;
  carrierId: string;
  carrierName: string;
  productLabel: string;
  productCode: string;
  tiers: string[];
  ageBasis: AgeBasis;
  issueAgeMin: number | null;
  issueAgeMax: number | null;
  faceMinCents: number | null;
  faceMaxCents: number | null;
  /** Expected monthly premium per $1,000, dollars; null uses the default band. */
  band: { min: number; max: number } | null;
  riders: string[];
  acceptedPaymentMethods: PaymentMethod[];
  termLengths: number[];
  healthClasses: string[];
  /** Live: the server's appointment check for the client's state. Sample: judged from `unappointedStates`. */
  appointed: { ok: boolean; reason: string | null } | null;
  /** Sample only: states this agent holds no appointment in. */
  unappointedStates: string[];
  /** Sample only: year-one rate at this agent's contract level (10500 = 105%) and the advance terms. */
  samplePayout: { rateBp: number; advancePctBp: number; advanceMonths: number } | null;
};

/** One field of the quotation template (LA-3.4), in the template's order. */
export type QuotationField = { key: string; label: string; type: string; required: boolean; options: string[] };

/** `validDays`: how long a quote typed on it stands before the carrier must be asked again (default 30). */
export type QuotationTemplate = { id: string; version: number; ageBasis: AgeBasis; validDays?: number; fields?: QuotationField[] };

export type QuoteCatalogue = {
  carriers: { id: string; name: string }[];
  products: CarrierProduct[];
  quotationTemplate: QuotationTemplate | null;
  /** A carrier's own published template (LA-3.4), where it has one; others use quotationTemplate. */
  carrierTemplates?: Record<string, QuotationTemplate>;
};

/**
 * The platform "Final Expense — generic" quotation template's fields (20260926100100), used when the
 * catalogue does not carry the template's own field list. Same keys, same order.
 */
export const DEFAULT_QUOTATION_FIELDS: QuotationField[] = [
  { key: "dob", label: "Date of birth", type: "date", required: true, options: [] },
  { key: "gender", label: "Gender", type: "single_select", required: true, options: ["Male", "Female"] },
  { key: "state", label: "State", type: "single_select", required: true, options: [] },
  { key: "tobacco", label: "Tobacco or nicotine in the last 12 months", type: "boolean", required: true, options: [] },
  { key: "face_amount", label: "Face amount", type: "currency", required: true, options: [] },
  { key: "tier", label: "Tier", type: "single_select", required: true, options: ["level", "graded", "modified", "gi"] },
  { key: "riders", label: "Riders", type: "multi_select", required: false, options: ["Accidental death", "Child rider", "Grandchild rider", "Terminal illness", "Waiver of premium"] },
];

/** The template a quote for this carrier is typed on: its own, else the product line's general one. */
export const templateFor = (catalogue: QuoteCatalogue, carrierId?: string | null): QuotationTemplate | null =>
  (carrierId ? catalogue.carrierTemplates?.[carrierId] : undefined) ?? catalogue.quotationTemplate;

export const quotationFields = (catalogue: QuoteCatalogue, carrierId?: string | null) => {
  const tpl = templateFor(catalogue, carrierId);
  return tpl?.fields?.length ? tpl.fields : DEFAULT_QUOTATION_FIELDS;
};

/** Term life rates on term length and health class, and quotes monthly and annual (LA-3.25). */
export const isTermProduct = (p: Pick<CarrierProduct, "productCode"> | undefined | null) => p?.productCode === "term_life";

// ── the live response (mirrors lib/applications/catalog.ts, which is server-only) ─────────────

export type LiveCatalogProduct = {
  id: string; carrierId: string; name: string; productCode: string; tiers: string[];
  issueAgeMin: number | null; issueAgeMax: number | null; faceMinCents: number | null; faceMaxCents: number | null;
  band: { min: number; max: number } | null; acceptedPaymentMethods: PaymentMethod[]; termLengths: number[]; healthClasses: string[];
};
export type LiveCatalogCarrier = { id: string; name: string; appointed: { ok: boolean; reason: string | null }; products: LiveCatalogProduct[]; quotationTemplate?: QuotationTemplate | null };
export type LiveCatalog = { carriers: LiveCatalogCarrier[]; quotationTemplate: QuotationTemplate | null };

/** Industry-standard term inputs, offered when a carrier's term product isn't set up yet. */
const GENERIC_TERM_LENGTHS = [10, 15, 20, 25, 30];
const GENERIC_HEALTH_CLASSES = ["Preferred plus", "Preferred", "Standard plus", "Standard"];

/**
 * A contracted carrier with no product rows set up yet is still quotable on the case's own product
 * line: the premium comes from the carrier's tool either way. It carries no limits, so issue-age,
 * face and band checks fall back to the defaults until the agency adds the product in Settings.
 */
function unconfiguredProduct(c: LiveCatalogCarrier, productLine: string, ageBasis: AgeBasis): CarrierProduct {
  const term = productLine === "term_life";
  return {
    id: null, carrierId: c.id, carrierName: c.name, productLabel: PRODUCT_LABEL[productLine] ?? productLine, productCode: productLine,
    tiers: term ? ["level"] : ["level", "graded", "modified", "gi"], ageBasis,
    issueAgeMin: null, issueAgeMax: null, faceMinCents: null, faceMaxCents: null, band: null, riders: [], acceptedPaymentMethods: [],
    termLengths: term ? GENERIC_TERM_LENGTHS : [], healthClasses: term ? GENERIC_HEALTH_CLASSES : [],
    appointed: c.appointed, unappointedStates: [], samplePayout: null,
  };
}

function normaliseTemplate(tpl: QuotationTemplate | null | undefined): QuotationTemplate | null {
  if (!tpl) return null;
  const fields = Array.isArray(tpl.fields) ? tpl.fields.filter((f) => f && typeof f.key === "string" && typeof f.label === "string") : undefined;
  return { id: tpl.id, version: tpl.version, ageBasis: tpl.ageBasis ?? "nearest", ...(typeof tpl.validDays === "number" && tpl.validDays > 0 ? { validDays: tpl.validDays } : {}), ...(fields?.length ? { fields: fields.map((f) => ({ ...f, required: Boolean(f.required), options: Array.isArray(f.options) ? f.options.map(String) : [] })) } : {}) };
}

export function catalogueFromLive(data: LiveCatalog, productLine?: string | null): QuoteCatalogue {
  const general = normaliseTemplate(data.quotationTemplate);
  const carrierTemplates: Record<string, QuotationTemplate> = {};
  for (const c of data.carriers) { const own = normaliseTemplate(c.quotationTemplate); if (own && own.id !== general?.id) carrierTemplates[c.id] = own; }
  // Each product rates on its carrier's template's age basis.
  const basisOf = (carrierId: string): AgeBasis => (carrierTemplates[carrierId] ?? general)?.ageBasis ?? "nearest";
  const line = productLine || "final_expense";
  const products = data.carriers.flatMap((c) => c.products.length ? c.products.map((p): CarrierProduct => ({
    id: p.id, carrierId: c.id, carrierName: c.name, productLabel: p.name, productCode: p.productCode,
    tiers: p.tiers.length ? p.tiers : ["level"], ageBasis: basisOf(c.id),
    issueAgeMin: p.issueAgeMin, issueAgeMax: p.issueAgeMax, faceMinCents: p.faceMinCents, faceMaxCents: p.faceMaxCents,
    band: p.band, riders: [], acceptedPaymentMethods: p.acceptedPaymentMethods, termLengths: p.termLengths, healthClasses: p.healthClasses,
    appointed: c.appointed, unappointedStates: [], samplePayout: null,
  })) : [unconfiguredProduct(c, line, basisOf(c.id))]);
  const withProducts = new Set(products.map((p) => p.carrierId));
  return {
    carriers: data.carriers.filter((c) => withProducts.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    products,
    quotationTemplate: general,
    carrierTemplates,
  };
}

// ── DESIGN SAMPLE ────────────────────────────────────────────────────────────────────────────

const ALL_METHODS: PaymentMethod[] = ["ach", "direct_express", "debit_card", "credit_card", "direct_bill"];

type SampleRow = Pick<CarrierProduct, "carrierId" | "carrierName" | "productLabel" | "tiers" | "ageBasis" | "issueAgeMin" | "issueAgeMax" | "faceMinCents" | "faceMaxCents" | "riders" | "acceptedPaymentMethods" | "unappointedStates">
  & { rateBp: number; advancePctBp: number; advanceMonths: number };

const SAMPLE_ROWS: SampleRow[] = [
  { carrierId: "car-mutual", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tiers: ["level", "graded"], ageBasis: "last", issueAgeMin: 45, issueAgeMax: 85, faceMinCents: 200_000, faceMaxCents: 5_000_000, riders: ["Accidental death", "Accelerated death benefit"], acceptedPaymentMethods: ALL_METHODS, unappointedStates: [], rateBp: 10_500, advancePctBp: 10_000, advanceMonths: 9 },
  { carrierId: "car-aetna", carrierName: "Aetna", productLabel: "Protection Series", tiers: ["level", "graded", "modified"], ageBasis: "nearest", issueAgeMin: 45, issueAgeMax: 89, faceMinCents: 200_000, faceMaxCents: 5_000_000, riders: ["Accidental death"], acceptedPaymentMethods: ["ach", "direct_express", "debit_card", "direct_bill"], unappointedStates: [], rateBp: 10_000, advancePctBp: 10_000, advanceMonths: 9 },
  { carrierId: "car-americo", carrierName: "Americo", productLabel: "Eagle Premier", tiers: ["level", "graded", "modified"], ageBasis: "nearest", issueAgeMin: 40, issueAgeMax: 85, faceMinCents: 250_000, faceMaxCents: 4_000_000, riders: ["Accidental death", "Child rider"], acceptedPaymentMethods: ALL_METHODS, unappointedStates: ["TX"], rateBp: 11_500, advancePctBp: 10_000, advanceMonths: 9 },
  { carrierId: "car-foresters", carrierName: "Foresters", productLabel: "PlanRight", tiers: ["level", "graded", "modified"], ageBasis: "nearest", issueAgeMin: 50, issueAgeMax: 85, faceMinCents: 500_000, faceMaxCents: 3_500_000, riders: ["Accidental death"], acceptedPaymentMethods: ["ach", "direct_express", "debit_card"], unappointedStates: [], rateBp: 11_000, advancePctBp: 10_000, advanceMonths: 9 },
  { carrierId: "car-transamerica", carrierName: "Transamerica", productLabel: "Immediate Solution", tiers: ["level", "graded"], ageBasis: "nearest", issueAgeMin: 45, issueAgeMax: 85, faceMinCents: 100_000, faceMaxCents: 5_000_000, riders: ["Accidental death", "Child rider"], acceptedPaymentMethods: ALL_METHODS, unappointedStates: [], rateBp: 10_000, advancePctBp: 7_500, advanceMonths: 9 },
  { carrierId: "car-corebridge", carrierName: "Corebridge", productLabel: "Guaranteed Issue Whole Life", tiers: ["gi"], ageBasis: "nearest", issueAgeMin: 50, issueAgeMax: 80, faceMinCents: 500_000, faceMaxCents: 2_500_000, riders: [], acceptedPaymentMethods: ["ach", "debit_card", "credit_card", "direct_bill"], unappointedStates: [], rateBp: 9_000, advancePctBp: 10_000, advanceMonths: 9 },
];

const SAMPLE_PRODUCTS: CarrierProduct[] = [
  ...SAMPLE_ROWS.map(({ rateBp, advancePctBp, advanceMonths, ...p }): CarrierProduct => ({
    ...p,
    id: null,
    productCode: "final_expense",
    band: null,
    termLengths: [],
    healthClasses: [],
    appointed: null,
    samplePayout: { rateBp, advancePctBp, advanceMonths },
  })),
  // One term product, so the preview shows the term inputs (LA-3.25).
  {
    id: null, carrierId: "car-banner", carrierName: "Banner Life", productLabel: "OPTerm", productCode: "term_life", tiers: ["level"], ageBasis: "nearest",
    issueAgeMin: 20, issueAgeMax: 75, faceMinCents: 10_000_000, faceMaxCents: 1_000_000_000, band: { min: 0.02, max: 3 }, riders: [],
    acceptedPaymentMethods: ["ach", "debit_card", "credit_card"], termLengths: [10, 15, 20, 25, 30], healthClasses: ["Preferred plus", "Preferred", "Standard plus", "Standard"],
    appointed: null, unappointedStates: [], samplePayout: { rateBp: 9_000, advancePctBp: 7_500, advanceMonths: 9 },
  },
];

function carriersOf(products: CarrierProduct[]) {
  const seen = new Map<string, string>();
  for (const p of products) if (!seen.has(p.carrierId)) seen.set(p.carrierId, p.carrierName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

export const SAMPLE_CATALOGUE: QuoteCatalogue = { carriers: carriersOf(SAMPLE_PRODUCTS), products: SAMPLE_PRODUCTS, quotationTemplate: null };

/** The product a quote or attempt names; the carrier's first product when the label doesn't match. */
export function productIn(catalogue: QuoteCatalogue, carrierId: string | null | undefined, productLabel?: string | null) {
  if (!carrierId) return undefined;
  const mine = catalogue.products.filter((p) => p.carrierId === carrierId);
  return mine.find((p) => p.productLabel === productLabel) ?? mine[0];
}

/** Whether the agent is appointed to sell this product in the client's state. */
export function appointmentFor(product: CarrierProduct, state: string) {
  if (product.appointed) return product.appointed;
  return state && product.unappointedStates.includes(state)
    ? { ok: false, reason: `No active ${product.carrierName} appointment in ${state}.` }
    : { ok: true, reason: null };
}

export const tierLabel = (tier: string | null | undefined) => (tier ? TIER_LABEL[tier] ?? tier : "—");

/** "105%" from 10500, "92.5%" from 9250. */
export function contractLevel(bp: number) {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}
