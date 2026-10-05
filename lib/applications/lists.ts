import "server-only";

import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { PRODUCT_LABEL, type ApplicationOutcome, type ApplicationStatus, type InsuredRole } from "./constants";
import { quoteOutcome, type ApplicationRow, type QuoteRow } from "./listRules";

/**
 * LA-3 list reads (LA-3.5 Quotes, LA-3.15 Applications / Missing reference). Every query names the
 * tenant — the service client bypasses RLS. No sensitive value is read, masked or otherwise.
 */

type Attempt = {
  id: string; case_id: string; lead_id: string; insured_role: InsuredRole; attempt_no: number; carrier_id: string | null; product_code: string | null;
  carrier_product_id: string | null; quote_id: string | null; status: ApplicationStatus; outcome: ApplicationOutcome | null; updated_at: string; submitted_at: string | null; created_at: string;
};
type Submission = { application_id: string; carrier_reference: string | null; policy_number: string | null; qa_verdict: { verdict?: ApplicationRow["qaVerdict"]; blocking?: unknown[]; warnings?: unknown[] } | null; submitted_at: string };

const NONE = ["00000000-0000-0000-0000-000000000000"];
const CHUNK = 150;

/** Optional reads: absent schema reads as empty. */
export async function optional<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error && isMissingSchema(error)) return [];
  if (error) throw new ApplicationError("APPLICATION_UNAVAILABLE", error.message ?? "Could not load the list", 500);
  return rows<T>(data);
}

/** `.in()` over many ids, in chunks the URL can carry. */
export async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const parts: T[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) parts.push(await optional<T>(read(unique.slice(i, i + CHUNK))));
  return parts.flat();
}

export function leadName(values: Record<string, unknown> | null | undefined) {
  const v = values ?? {};
  const full = typeof v.full_name === "string" ? v.full_name.trim() : "";
  if (full) return full;
  return [v.first_name, v.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim() || "Unnamed client";
}

/**
 * Names for a set of attempts: the lead's name for the primary insured, the spouse's own name (from
 * their application values) for a spouse, falling back to "<lead> (spouse)". Also each lead's state.
 */
export async function insuredNames(tenantId: string, attempts: { id: string; lead_id: string; insured_role: InsuredRole }[]) {
  const client = db();
  const [leads, spouseValues] = await Promise.all([
    inChunks<{ id: string; values: Record<string, unknown> | null }>(attempts.map((a) => a.lead_id), (chunk) => client.from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", chunk)),
    inChunks<{ application_id: string; field_key: string; value: unknown }>(attempts.filter((a) => a.insured_role === "spouse").map((a) => a.id), (chunk) =>
      client.from("tenant_application_values").select("application_id, field_key, value").eq("tenant_id", tenantId).in("application_id", chunk).in("field_key", ["insured.first_name", "insured.last_name"])),
  ]);
  const leadBy = new Map(leads.map((l) => [l.id, l.values ?? {}]));
  const spouse = new Map<string, { first?: string; last?: string }>();
  for (const v of spouseValues) {
    const entry = spouse.get(v.application_id) ?? {};
    if (typeof v.value === "string" && v.value.trim()) entry[v.field_key === "insured.first_name" ? "first" : "last"] = v.value.trim();
    spouse.set(v.application_id, entry);
  }
  const nameFor = (a: { id: string; lead_id: string; insured_role: InsuredRole }) => {
    const base = leadName(leadBy.get(a.lead_id));
    if (a.insured_role !== "spouse") return base;
    const s = spouse.get(a.id);
    const own = [s?.first, s?.last].filter(Boolean).join(" ");
    return own || `${base} (spouse)`;
  };
  const stateFor = (leadId: string) => { const st = leadBy.get(leadId)?.state; return typeof st === "string" && st.trim() ? st.trim().toUpperCase() : null; };
  return { nameFor, stateFor, leadName: (leadId: string) => leadName(leadBy.get(leadId)) };
}

async function carrierAndProductNames(carrierIds: (string | null)[], productIds: (string | null)[]) {
  const client = db();
  const [carriers, products] = await Promise.all([
    inChunks<{ id: string; name: string }>(carrierIds.filter((x): x is string => Boolean(x)), (chunk) => client.from("carriers").select("id, name").in("id", chunk)),
    inChunks<{ id: string; name: string }>(productIds.filter((x): x is string => Boolean(x)), (chunk) => client.from("carrier_products").select("id, name").in("id", chunk)),
  ]);
  return { carrier: new Map(carriers.map((c) => [c.id, c.name])), product: new Map(products.map((p) => [p.id, p.name])) };
}

/** Latest submission per application. */
async function latestSubmissions(tenantId: string, applicationIds: string[]) {
  const subs = await inChunks<Submission>(applicationIds, (chunk) =>
    db().from("tenant_application_submissions").select("application_id, carrier_reference, policy_number, qa_verdict, submitted_at").eq("tenant_id", tenantId).in("application_id", chunk));
  const latest = new Map<string, Submission>();
  for (const s of subs) { const cur = latest.get(s.application_id); if (!cur || s.submitted_at > cur.submitted_at) latest.set(s.application_id, s); }
  return latest;
}

// ── Applications (LA-3.15) ──────────────────────────────────────────────────

export async function listApplicationRows(tenantId: string): Promise<ApplicationRow[]> {
  const client = db();
  const q = await client.from("tenant_applications")
    .select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, carrier_product_id, quote_id, status, outcome, updated_at, submitted_at, created_at")
    .eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(2000);
  if (isMissingSchema(q.error)) throw new SchemaPendingError("The application record");
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  const list = rows<Attempt>(q.data);
  if (!list.length) return [];
  const [names, labels, quotes, subs] = await Promise.all([
    insuredNames(tenantId, list),
    carrierAndProductNames(list.map((a) => a.carrier_id), list.map((a) => a.carrier_product_id)),
    inChunks<{ id: string; monthly_premium_cents: number }>(list.map((a) => a.quote_id).filter((x): x is string => Boolean(x)), (chunk) => client.from("tenant_quotes").select("id, monthly_premium_cents").eq("tenant_id", tenantId).in("id", chunk)),
    latestSubmissions(tenantId, list.map((a) => a.id)),
  ]);
  const premium = new Map(quotes.map((x) => [x.id, x.monthly_premium_cents]));
  return list.map((a) => {
    const sub = subs.get(a.id);
    const verdict = sub?.qa_verdict ?? null;
    return {
      caseId: a.case_id, applicationId: a.id, leadId: a.lead_id, clientName: names.nameFor(a), insuredRole: a.insured_role, state: names.stateFor(a.lead_id),
      carrierName: a.carrier_id ? labels.carrier.get(a.carrier_id) ?? null : null,
      productLabel: (a.carrier_product_id && labels.product.get(a.carrier_product_id)) || (a.product_code ? PRODUCT_LABEL[a.product_code] ?? a.product_code : null),
      attemptNo: a.attempt_no, status: a.status, outcome: a.outcome,
      monthlyPremiumCents: a.quote_id ? premium.get(a.quote_id) ?? null : null,
      qaVerdict: verdict?.verdict ?? null,
      qaBlocking: Array.isArray(verdict?.blocking) ? verdict.blocking.length : null,
      qaWarnings: Array.isArray(verdict?.warnings) ? verdict.warnings.length : null,
      reference: sub?.carrier_reference ?? null, policyNumber: sub?.policy_number ?? null,
      updatedAt: a.updated_at, submittedAt: a.submitted_at ?? sub?.submitted_at ?? null,
    };
  });
}

// ── Quotes (LA-3.5) ─────────────────────────────────────────────────────────

type Quote = {
  id: string; case_id: string; lead_id: string; insured_role: InsuredRole; application_id: string | null; carrier_id: string; carrier_product_id: string | null;
  product_code: string; tier: string | null; face_amount_cents: number; monthly_premium_cents: number; warnings: { code?: string; message?: string }[] | null;
  status: "draft" | "presented" | "selected" | "discarded"; created_at: string;
};

/** Every quote the tenant has saved, discarded ones included, newest first. No commission, ever. */
export async function listQuoteRows(tenantId: string): Promise<QuoteRow[]> {
  const client = db();
  const q = await client.from("tenant_quotes")
    .select("id, case_id, lead_id, insured_role, application_id, carrier_id, carrier_product_id, product_code, tier, face_amount_cents, monthly_premium_cents, warnings, status, created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000);
  if (isMissingSchema(q.error)) throw new SchemaPendingError("Quotes");
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  const list = rows<Quote>(q.data);
  if (!list.length) return [];

  // Attempts on these cases: the spouse's name, and whether a selected quote has been superseded.
  const attempts = await inChunks<Attempt>(list.map((x) => x.case_id), (chunk) =>
    client.from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, carrier_product_id, quote_id, status, outcome, updated_at, submitted_at, created_at").eq("tenant_id", tenantId).in("case_id", chunk));
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const [names, labels] = await Promise.all([
    insuredNames(tenantId, [
      ...attempts,
      // A quote on a case with no attempt yet still needs its client's name.
      ...list.filter((x) => !attempts.some((a) => a.case_id === x.case_id)).map((x) => ({ id: NONE[0], lead_id: x.lead_id, insured_role: "primary" as const })),
    ]),
    carrierAndProductNames(list.map((x) => x.carrier_id), list.map((x) => x.carrier_product_id)),
  ]);
  const insuredAttempt = (x: Quote) => attempts.filter((a) => a.case_id === x.case_id && a.insured_role === x.insured_role).sort((a, b) => b.attempt_no - a.attempt_no)[0];

  return list.map((x) => {
    const own = x.application_id ? byId.get(x.application_id) : undefined;
    const latest = insuredAttempt(x);
    const nameSource = own ?? latest ?? { id: NONE[0], lead_id: x.lead_id, insured_role: x.insured_role };
    const followed = own ? attempts.some((a) => a.case_id === own.case_id && a.insured_role === own.insured_role && a.attempt_no > own.attempt_no) : false;
    const per1000 = (x.warnings ?? []).find((w) => w?.code === "QUOTE_PER1000_BAND");
    return {
      id: x.id, caseId: x.case_id, applicationId: x.application_id, clientName: names.nameFor(nameSource), insuredRole: x.insured_role, state: names.stateFor(x.lead_id),
      carrierName: labels.carrier.get(x.carrier_id) ?? "Carrier",
      productLabel: (x.carrier_product_id && labels.product.get(x.carrier_product_id)) || PRODUCT_LABEL[x.product_code] || x.product_code,
      productCode: x.product_code, tier: x.tier, faceAmountCents: x.face_amount_cents, monthlyPremiumCents: x.monthly_premium_cents,
      outcome: quoteOutcome(x.status, own ? { status: own.status, outcome: own.outcome, followedByNewAttempt: followed } : null),
      per1000Warning: per1000?.message ?? (per1000 ? "Per $1,000 is outside the expected band." : null),
      createdAt: x.created_at,
    };
  });
}
