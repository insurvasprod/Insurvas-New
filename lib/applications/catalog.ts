import "server-only";

import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import { bandFallback } from "@/lib/quotes/math";
import { pickQuotationTemplate, quotationFieldsOf, type QuotationField } from "@/lib/quotes/quotationTemplate";
import { preferTenantCopies } from "@/lib/salesSettings/carriers";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import { quoteValidDays } from "@/lib/salesSettings/templateDefinition";
import { db, isMissingSchema, rows } from "./db";
import type { PaymentMethod } from "./constants";

/**
 * What the Quote step offers (LA-3.4/3.5/3.6): the carriers this agency holds a contract with, their
 * products and limits, and whether each is appointed in the client's state. Commission figures stay
 * on the server's quote rows — this catalogue carries none.
 */
export type CatalogProduct = {
  id: string;
  carrierId: string;
  name: string;
  productCode: string;
  tiers: string[];
  issueAgeMin: number | null;
  issueAgeMax: number | null;
  faceMinCents: number | null;
  faceMaxCents: number | null;
  band: { min: number; max: number } | null;
  acceptedPaymentMethods: PaymentMethod[];
  termLengths: number[];
  healthClasses: string[];
};
/** `validDays`: how long a quote typed on this template stands (Settings › Quotation, 14 / 30 / 60). */
export type CatalogTemplate = { id: string; version: number; ageBasis: "nearest" | "last"; validDays: number; fields: QuotationField[] };
/**
 * `quotationTemplate` on a carrier is the template a quote for THAT carrier is typed on (LA-3.4): the
 * carrier's own published quotation template when the agency or the platform has one, else the general
 * one (the same as `QuoteCatalog.quotationTemplate`).
 */
export type CatalogCarrier = { id: string; name: string; appointed: { ok: boolean; reason: string | null }; products: CatalogProduct[]; quotationTemplate: CatalogTemplate | null };
export type QuoteCatalog = { carriers: CatalogCarrier[]; quotationTemplate: CatalogTemplate | null };

type ProductRow = { id: string; carrier_id: string; name: string; product_code: string; tiers: string[] | null; issue_age_min: number | null; issue_age_max: number | null; face_min_cents: number | null; face_max_cents: number | null; premium_per_1000_band_min: number | null; premium_per_1000_band_max: number | null; accepted_payment_methods: PaymentMethod[] | null; term_lengths: number[] | null; health_classes: string[] | null; tenant_id: string | null; copied_from_id?: string | null };
const PRODUCT_COLUMNS = "id, carrier_id, name, product_code, tiers, issue_age_min, issue_age_max, face_min_cents, face_max_cents, premium_per_1000_band_min, premium_per_1000_band_max, accepted_payment_methods, term_lengths, health_classes, tenant_id, is_active";

/** The products on offer. `copied_from_id` arrives with its own migration; until then every row is an original. */
async function readProducts(tenantId: string, carrierIds: string[]): Promise<ProductRow[]> {
  const query = (columns: string) => db().from("carrier_products").select(columns).in("carrier_id", carrierIds).eq("is_active", true).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  let res = await query(`${PRODUCT_COLUMNS}, copied_from_id`);
  if (res.error && isMissingSchema(res.error)) res = await query(PRODUCT_COLUMNS);
  return res.error ? [] : rows<ProductRow>(res.data);
}

export async function quoteCatalog(tenantId: string, clientState: string | null, productLine: string | null): Promise<QuoteCatalog> {
  const client = db();
  const contracts = await client.from("tenant_carriers").select("carrier_id, is_active").eq("tenant_id", tenantId).eq("is_active", true);
  if (contracts.error && !isMissingSchema(contracts.error)) throw new Error(contracts.error.message);
  const carrierIds = [...new Set(rows<{ carrier_id: string }>(contracts.data).map((c) => c.carrier_id))];
  if (!carrierIds.length) return { carriers: [], quotationTemplate: null };
  const today = new Date().toISOString().slice(0, 10);
  const [carriers, products, appointments, template, settings] = await Promise.all([
    client.from("carriers").select("id, name").in("id", carrierIds).order("name"),
    readProducts(tenantId, carrierIds),
    client.from("appointments").select("carrier_id, state, status, effective_from, terminated_at, expires_at").eq("tenant_id", tenantId).in("carrier_id", carrierIds),
    // The general templates and every carrier's own (LA-3.4 · quotation templates per carrier).
    // pickQuotationTemplate keeps only the general ones and the carrier's own.
    client.from("sales_templates").select("id, version, definition, tenant_id, carrier_id, product_code").eq("kind", "quotation").eq("status", "published").in("product_code", [productLine ?? "final_expense", "final_expense"]).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("version", { ascending: false }),
    client.from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const apps = rows<{ carrier_id: string; state: string; status: "pending" | "active" | "terminated"; effective_from: string; terminated_at: string | null; expires_at: string | null }>(appointments.data);
  // A platform product the agency copied (LA-3.6) is offered as its copy, never twice.
  const productRows = preferTenantCopies(products);
  // The case's own product's template first (Term Life's for a term case), then the carrier's own over
  // the general one, then the agency's own over the platform's, then the newest version.
  type TemplateRow = { id: string; version: number; definition: Parameters<typeof quotationFieldsOf>[0] & { age_basis?: "nearest" | "last" }; tenant_id: string | null; carrier_id: string | null; product_code: string };
  const templateRows = isMissingSchema(template.error) || template.error ? [] : rows<TemplateRow>(template.data);
  const view = (t: TemplateRow | null): CatalogTemplate | null => (t ? { id: t.id, version: t.version, ageBasis: t.definition?.age_basis ?? "nearest", validDays: quoteValidDays(t.definition), fields: quotationFieldsOf(t.definition) } : null);
  const general = view(pickQuotationTemplate(templateRows, { productCode: productLine, carrierId: null, tenantId }));
  // A product with no band of its own is judged by the agency's (LA-3.17), except term (LA-3.25).
  const agencyBand = resolveSalesSettings(settings.error ? null : settings.data?.settings).per1000Band;

  return {
    carriers: rows<{ id: string; name: string }>(carriers.data).map((c) => {
      let appointed: CatalogCarrier["appointed"];
      if (!clientState) appointed = { ok: false, reason: "No state on file to check the appointment against." };
      else {
        const inState = apps.filter((a) => a.carrier_id === c.id && a.state === clientState);
        const live = inState.find((a) => appointmentIsActiveAt(a, today));
        appointed = live ? { ok: true, reason: null } : { ok: false, reason: inState.some((a) => a.status === "pending") ? `The ${c.name} appointment in ${clientState} is still pending.` : `No active ${c.name} appointment in ${clientState}.` };
      }
      return {
        id: c.id, name: c.name, appointed,
        products: productRows.filter((p) => p.carrier_id === c.id).map((p) => ({
          id: p.id, carrierId: p.carrier_id, name: p.name, productCode: p.product_code, tiers: p.tiers ?? [], issueAgeMin: p.issue_age_min, issueAgeMax: p.issue_age_max,
          faceMinCents: p.face_min_cents, faceMaxCents: p.face_max_cents,
          band: p.premium_per_1000_band_min != null && p.premium_per_1000_band_max != null
            ? { min: Number(p.premium_per_1000_band_min), max: Number(p.premium_per_1000_band_max) }
            : bandFallback(p.product_code) === null ? null : agencyBand,
          acceptedPaymentMethods: p.accepted_payment_methods ?? [], termLengths: p.term_lengths ?? [], healthClasses: p.health_classes ?? [],
        })),
        quotationTemplate: view(pickQuotationTemplate(templateRows, { productCode: productLine, carrierId: c.id, tenantId })) ?? general,
      };
    }),
    quotationTemplate: general,
  };
}
