/**
 * Sample answers for the Partners pages in the preview (/design/partners, settings redesign
 * 2026-10-29). Keys may hold ":id" for a path segment. Writes change the in-memory sample only;
 * nothing reaches a real API.
 */
type Answer = { status: number; body: unknown };
type State = "loaded" | "empty" | "error" | "readonly";
const ok = (body: unknown, status = 200): Answer => ({ status, body });
const ago = (days: number) => new Date(Date.parse("2026-10-28T16:00:00Z") - days * 86_400_000).toISOString();

type Term = { id: string; partner_id: string; payout_model: "per_transfer" | "per_sale" | "revenue_share"; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string; created_at: string };
const term = (partner_id: string, payout_model: Term["payout_model"], rate_cents: number | null, rate_pct_bp: number | null = null): Term => ({ id: `t-${partner_id}`, partner_id, payout_model, rate_cents, rate_pct_bp, effective_from: "2026-09-01", created_at: ago(60) });

type Partner = {
  id: string; name: string; partner_type: "publisher" | "marketing" | "affiliate"; status: "draft" | "active" | "paused" | "offboarded"; country: string;
  contact_name: string | null; contact_email: string | null; timezone: string; notes: string | null; terms: Term[]; active_term: Term | null;
  lead_volume_this_month: number; last_submission: string | null; active_user_count: number; offboarded_at?: string | null;
  transfers_this_month: number; completed_this_month: number; dropped_this_month: number; approved_products: string[];
};

const partner = (id: string, name: string, partner_type: Partner["partner_type"], status: Partner["status"], extra: Partial<Partner> = {}): Partner => {
  const t = extra.active_term === undefined ? term(id, "per_transfer", 3500) : extra.active_term;
  return {
    id, name, partner_type, status, country: "US", contact_name: null, contact_email: null, timezone: "America/Chicago", notes: null,
    terms: t ? [t] : [], active_term: t, lead_volume_this_month: 0, last_submission: null, active_user_count: 0,
    transfers_this_month: 0, completed_this_month: 0, dropped_this_month: 0, approved_products: [], ...extra,
  };
};

let partners: Partner[] = [
  partner("p-apex", "Apex Call Center", "publisher", "active", { contact_name: "Dana Reyes", contact_email: "dana@apexcalls.example", lead_volume_this_month: 214, last_submission: ago(0.1), active_user_count: 6, transfers_this_month: 182, completed_this_month: 41, dropped_this_month: 9, approved_products: ["final_expense", "medicare_advantage"] }),
  partner("p-northline", "Northline Media", "marketing", "active", { contact_name: "Chris Hall", contact_email: "chris@northline.example", timezone: "America/New_York", lead_volume_this_month: 96, last_submission: ago(1), active_user_count: 2, active_term: term("p-northline", "per_sale", 12500), approved_products: ["final_expense"] }),
  partner("p-bluepeak", "Bluepeak Leads", "affiliate", "paused", { contact_name: "Sam Ortiz", contact_email: "sam@bluepeak.example", lead_volume_this_month: 12, last_submission: ago(9), active_user_count: 1, active_term: term("p-bluepeak", "revenue_share", null, 1500) }),
  partner("p-harbor", "Harbor Leads", "publisher", "draft", { active_term: null }),
];

const products = [
  { code: "final_expense", name: "Final Expense", category: "life", is_enabled: true, sort_order: 1 },
  { code: "term_life", name: "Term Life", category: "life", is_enabled: true, sort_order: 2 },
  { code: "medicare_advantage", name: "Medicare Advantage", category: "health", is_enabled: true, sort_order: 3 },
];

const users = (id: string) => (id === "p-apex" ? [
  { id: "u1", user_id: "pu-dana", name: "Dana Reyes", email: "dana@apexcalls.example", role: "partner_admin", status: "active", accepted_at: ago(50), partner_admin_user_id: null },
  { id: "u2", user_id: "pu-mike", name: "Mike Chen", email: "mike@apexcalls.example", role: "partner_user", status: "active", accepted_at: ago(30), partner_admin_user_id: "pu-dana" },
  { id: "u3", user_id: "pu-ivy", name: "Ivy Brooks", email: "ivy@apexcalls.example", role: "partner_user", status: "active", accepted_at: null, invite_expires_at: ago(-4), partner_admin_user_id: "pu-dana" },
] : []);

const usage = () => {
  const active = (type: string) => partners.filter((p) => p.partner_type === type && p.status === "active").length;
  return { publishers: active("publisher"), marketing: active("marketing"), affiliates: active("affiliate"), partnerUsers: partners.filter((p) => p.status === "active").reduce((sum, p) => sum + p.active_user_count, 0) };
};

export const PARTNER_HANDLERS: Record<string, (state: State, body: unknown, params: Record<string, string>) => Answer> = {
  "GET /api/app/partners": (state) => (state === "error"
    ? ok({ error: "Could not load partners. (Sample error.)" }, 500)
    : ok({ partners: state === "empty" ? [] : partners, directoryUsers: [], readOnly: state === "readonly", limits: { max_publishers: 5, max_marketing_partners: 3, max_affiliates: 3, max_buffer_seats: 2, max_partner_users: 25 }, usage: usage() })),
  "POST /api/app/partners": (_state, body) => {
    const draft = body as Partial<Partner>;
    const created = partner(`p-${partners.length + 1}`, String(draft.name ?? "New partner"), (draft.partner_type ?? "publisher") as Partner["partner_type"], "draft", { ...draft, active_term: null } as Partial<Partner>);
    partners = [...partners, created];
    return ok({ partner: created, activationRefused: null }, 201);
  },
  "PATCH /api/app/partners/:id": (_state, body, params) => {
    partners = partners.map((p) => (p.id === params.id ? { ...p, ...(body as Partial<Partner>) } : p));
    return ok({ partner: partners.find((p) => p.id === params.id) });
  },
  "GET /api/app/products": () => ok({ products }),
  "GET /api/app/partners/:id/products": (_state, _body, params) => {
    const p = partners.find((row) => row.id === params.id);
    return ok({ products: products.map((product) => ({ ...product, approved: Boolean(p?.approved_products.includes(product.code)) })) });
  },
  "GET /api/app/partners/:id/users": (_state, _body, params) => ok({ users: users(params.id) }),
  "GET /api/app/partners/:id/market-access": () => ok({ profile: null, eligible: [{ carrier_id: "car-mutual", carrier_name: "Mutual of Omaha", state: "TX" }, { carrier_id: "car-aetna", carrier_name: "Aetna", state: "TX" }], source: "tenant_appointments" }),
};
