/**
 * Sample API answers for the Settings preview (settings-shell plan, R1). The real panels render from
 * these on /design/settings, so a redesign is seen in every state without an account. Each entry is
 * keyed "METHOD /api/path"; a GET answers with the sample, a write answers after a short delay with
 * what the GET would now say. Nothing here reaches a real API.
 *
 * Add a section's fixtures with the task that redesigns it. `PREVIEW_SECTIONS` lists the sections
 * whose real panel renders here; the others keep the placeholder card.
 */
import type { AgencyProfileResponse } from "@/lib/agencyProfile/types";

export type PreviewState = "loaded" | "empty" | "error" | "readonly";
export const PREVIEW_STATES: PreviewState[] = ["loaded", "empty", "error", "readonly"];

type Answer = { status: number; body: unknown };
type Handler = (state: PreviewState, body: unknown) => Answer;

const ok = (body: unknown): Answer => ({ status: 200, body });
const failed = (what: string): Answer => ({ status: 500, body: { error: `Could not load ${what}. (Sample error.)` } });

/* ── Business identity ─────────────────────────────────────────────────────────────────────── */

const agencyProfile = (empty: boolean): AgencyProfileResponse => ({
  schemaReady: true,
  niprConfigured: false,
  profile: {
    legalName: empty ? "" : "Unlimited Insurance LLC",
    dba: empty ? null : "Power Policies",
    npn: empty ? null : "12312312",
    npnVerifiedAt: null,
    npnCheckStatus: null,
    npnCheckedAt: null,
    entityType: empty ? null : "llc",
    taxIdType: empty ? null : "ein",
    hasTaxId: !empty,
    taxIdLast4: empty ? null : "4821",
    taxIdReadable: true,
    addressLine1: empty ? null : "1200 Main St",
    addressLine2: empty ? null : "Suite 400",
    city: empty ? null : "Dallas",
    state: empty ? null : "TX",
    postalCode: empty ? null : "75201",
    country: "US",
    principalAddress: empty ? null : "1200 Main St, Suite 400, Dallas, TX 75201",
    phone: empty ? null : "(214) 555-0148",
    email: empty ? null : "ops@powerpolicies.com",
    website: empty ? null : "powerpolicies.com",
    logoUrl: null,
    timezone: "America/Chicago",
    updatedAt: "2026-10-27T15:04:00Z",
  },
});

/* ── Products ──────────────────────────────────────────────────────────────────────────────── */

/** `sold` is always `inPlan && enabled`, as the server derives it; the sample keeps to that. */
type ProductRow = { code: string; name: string; category: string; inPlan: boolean; enabled: boolean; sold: boolean; partners: string[]; formReady: boolean; carriers: number };

let products: ProductRow[] = [
  { code: "final_expense", name: "Final Expense", category: "life", inPlan: true, enabled: true, sold: true, partners: ["Apex Call Center", "Northline Media"], formReady: true, carriers: 4 },
  { code: "term_life", name: "Term Life", category: "life", inPlan: true, enabled: true, sold: true, partners: ["Apex Call Center"], formReady: true, carriers: 3 },
  { code: "whole_life", name: "Whole Life", category: "life", inPlan: true, enabled: false, sold: false, partners: [], formReady: true, carriers: 2 },
  { code: "iul", name: "Indexed Universal Life", category: "life", inPlan: true, enabled: false, sold: false, partners: [], formReady: false, carriers: 1 },
  { code: "medicare_advantage", name: "Medicare Advantage", category: "health", inPlan: true, enabled: true, sold: true, partners: ["Apex Call Center", "Northline Media", "Bluepeak", "Harbor Leads"], formReady: true, carriers: 2 },
  { code: "medicare_supplement", name: "Medicare Supplement", category: "health", inPlan: false, enabled: false, sold: false, partners: [], formReady: true, carriers: 0 },
  { code: "aca", name: "ACA Marketplace", category: "health", inPlan: false, enabled: false, sold: false, partners: [], formReady: false, carriers: 0 },
  { code: "annuity", name: "Fixed Annuity", category: "retirement", inPlan: true, enabled: false, sold: false, partners: [], formReady: true, carriers: 1 },
];

/* ── The table ─────────────────────────────────────────────────────────────────────────────── */

const HANDLERS: Record<string, Handler> = {
  "GET /api/app/agency-profile": (state) => (state === "error" ? failed("the business identity") : ok(agencyProfile(state === "empty"))),
  // Saves answer with the profile as it now stands (the form keeps its own draft).
  "PUT /api/app/agency-profile": (state) => ok({ profile: agencyProfile(state === "empty").profile }),
  "PATCH /api/app/agency-profile": (state) => ok({ profile: agencyProfile(state === "empty").profile }),
  "GET /api/app/settings/products": (state) => (state === "error" ? failed("your products") : ok({ products: state === "empty" ? [] : products })),
  "PATCH /api/app/settings/products": (_state, body) => {
    const change = body as { product_code?: string; sold?: boolean } | null;
    // As the server does: sold = in the plan and switched on (lib/products/settingsView.ts).
    products = products.map((row) => (row.code === change?.product_code ? { ...row, enabled: Boolean(change?.sold), sold: row.inPlan && Boolean(change?.sold) } : row));
    return ok({ products });
  },
};

/** Sections whose real panel renders in the preview (their fixtures are above). */
export const PREVIEW_SECTIONS = new Set(["business-identity", "products"]);

/** The sample answer for a request, or null when the preview has none (the request then goes out as usual). */
export function previewAnswer(method: string, path: string, state: PreviewState, body: unknown): Answer | null {
  const handler = HANDLERS[`${method.toUpperCase()} ${path}`];
  return handler ? handler(state, body) : null;
}
