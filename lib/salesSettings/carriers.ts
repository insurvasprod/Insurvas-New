import "server-only";

import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import type { Actor } from "@/lib/applications/http";
import { ApplicationError, SchemaPendingError, db, isMissingSchema, rows, type DbError } from "@/lib/applications/db";
import type { PaymentMethod } from "@/lib/applications/constants";

import { auditSalesSetting } from "./audit";
import type { ProductBody } from "./carrierSchemas";
import { portalAccountsFor } from "./portals";
import type { CarrierFacts, CarrierProductView, CarriersPayload, FieldMapChip, NamedCarrier, ProductLine, SalesCarrierView } from "./views";

/**
 * LA-3.6 / 3.17 / 3.22 / 3.25 · Settings › Sales › Carriers and products.
 *
 * Platform carriers (`carriers.organization_id is null`) and platform products (`carrier_products.
 * tenant_id is null`) are shared by every tenant and are never written from here. The agency's own
 * portal origin, reference pattern and billing descriptor live in `tenant_carrier_settings`
 * (20260926102400); its own products are tenant rows of `carrier_products`, a copy naming the
 * platform row it replaces in `copied_from_id` (20260926102410).
 */

type CarrierRow = { id: string; name: string; portal_origin: string | null; reference_pattern: string | null; billing_descriptor: string | null };
type SettingsRow = { carrier_id: string; portal_origin: string | null; reference_pattern: string | null; billing_descriptor: string | null };
type ProductRow = {
  id: string; tenant_id: string | null; carrier_id: string; product_code: string; name: string; tiers: string[] | null;
  issue_age_min: number | null; issue_age_max: number | null; face_min_cents: number | null; face_max_cents: number | null;
  premium_per_1000_band_min: number | string | null; premium_per_1000_band_max: number | string | null;
  accepted_payment_methods: PaymentMethod[] | null; is_active: boolean; term_lengths: number[] | null; health_classes: string[] | null;
  exam_required_above_face_cents: number | null; convertible: boolean | null; conversion_deadline_rule: string | null;
  renewal_type: "annual_renewable" | "level" | null; copied_from_id?: string | null;
};

const PRODUCT_COLUMNS = "id, tenant_id, carrier_id, product_code, name, tiers, issue_age_min, issue_age_max, face_min_cents, face_max_cents, premium_per_1000_band_min, premium_per_1000_band_max, accepted_payment_methods, is_active, term_lengths, health_classes, exam_required_above_face_cents, convertible, conversion_deadline_rule, renewal_type";

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  const message = error?.message ?? "";
  if (error?.code === "23505") throw new ApplicationError("CARRIER_SETTINGS_CONFLICT", "That already exists — refresh to see it.", 409);
  if (error?.code === "23514") throw new ApplicationError("CARRIER_SETTINGS_INVALID", "One of the values is outside what this setting allows.", 400);
  if (/TENANT_CARRIER_NOT_PLATFORM/.test(message)) throw new ApplicationError("CARRIER_NOT_FOUND", "That carrier is not in the Insurvas library.", 404);
  if (/CARRIER_PRODUCT_COPY_SOURCE/.test(message)) throw new ApplicationError("PRODUCT_COPY_SOURCE", "Only a platform product of this carrier can be copied.", 400);
  throw new ApplicationError("CARRIER_SETTINGS_UNAVAILABLE", `${what}: ${message || "unknown error"}`, 500);
}

/** A table that is not live yet reads as empty; any other failure is real. */
async function optional<T>(query: PromiseLike<{ data: unknown; error: DbError }>): Promise<T[]> {
  const { data, error } = await query;
  if (error && !isMissingSchema(error)) throw new ApplicationError("CARRIER_SETTINGS_UNAVAILABLE", error.message ?? "Could not read carrier settings", 500);
  return rows<T>(data);
}

const facts = (r: { portal_origin: string | null; reference_pattern: string | null; billing_descriptor: string | null } | null | undefined): CarrierFacts => ({
  portalOrigin: r?.portal_origin ?? null,
  referencePattern: r?.reference_pattern ?? null,
  billingDescriptor: r?.billing_descriptor ?? null,
});

export function mergeFacts(platform: CarrierFacts, override: CarrierFacts | null): CarrierFacts {
  return {
    portalOrigin: override?.portalOrigin ?? platform.portalOrigin,
    referencePattern: override?.referencePattern ?? platform.referencePattern,
    billingDescriptor: override?.billingDescriptor ?? platform.billingDescriptor,
  };
}

/**
 * The carrier facts every LA-3 feature should read: the agency's value where it set one, else the
 * platform library's. For the application readers (lib/applications/service.ts, the extension's
 * grants and maps, the submission reference check and the welcome pack).
 */
export async function effectiveCarrierFacts(tenantId: string, carrierIds: string[]): Promise<Map<string, CarrierFacts>> {
  const out = new Map<string, CarrierFacts>();
  if (!carrierIds.length) return out;
  const client = db();
  const [carriers, settings] = await Promise.all([
    optional<CarrierRow>(client.from("carriers").select("id, name, portal_origin, reference_pattern, billing_descriptor").in("id", carrierIds)),
    optional<SettingsRow>(client.from("tenant_carrier_settings").select("carrier_id, portal_origin, reference_pattern, billing_descriptor").eq("tenant_id", tenantId).in("carrier_id", carrierIds)),
  ]);
  const own = new Map(settings.map((s) => [s.carrier_id, facts(s)]));
  for (const c of carriers) out.set(c.id, mergeFacts(facts(c), own.get(c.id) ?? null));
  return out;
}

/** Platform rows the agency has copied are replaced by its copy; everything else passes through. */
export function preferTenantCopies<T extends { id: string; tenant_id: string | null; copied_from_id?: string | null }>(list: T[]): T[] {
  const replaced = new Set(list.map((p) => p.copied_from_id).filter((x): x is string => Boolean(x)));
  return list.filter((p) => p.tenant_id !== null || !replaced.has(p.id));
}

/** The carriers on the agency's list: contracted, added here, with an own product, or with a portal account. */
export async function listedCarrierIds(tenantId: string): Promise<string[]> {
  const client = db();
  const [contracts, settings, products, portals] = await Promise.all([
    optional<{ carrier_id: string }>(client.from("tenant_carriers").select("carrier_id").eq("tenant_id", tenantId)),
    optional<{ carrier_id: string }>(client.from("tenant_carrier_settings").select("carrier_id").eq("tenant_id", tenantId)),
    optional<{ carrier_id: string }>(client.from("carrier_products").select("carrier_id").eq("tenant_id", tenantId)),
    optional<{ carrier_id: string }>(client.from("tenant_carrier_portal_accounts").select("carrier_id").eq("tenant_id", tenantId)),
  ]);
  return [...new Set([...contracts, ...settings, ...products, ...portals].map((r) => r.carrier_id))];
}

export async function productLines(): Promise<ProductLine[]> {
  const res = await db().from("products").select("code, name, sort_order").eq("is_active", true).order("sort_order").order("name");
  if (res.error) fail(res.error, "Product lines");
  return rows<{ code: string; name: string }>(res.data).map((p) => ({ code: p.code, name: p.name }));
}

export async function namedCarriers(ids: string[]): Promise<NamedCarrier[]> {
  if (!ids.length) return [];
  const res = await db().from("carriers").select("id, name").in("id", ids).is("organization_id", null).order("name");
  if (res.error) fail(res.error, "Carriers");
  return rows<NamedCarrier>(res.data);
}

async function readProducts(tenantId: string, carrierIds: string[]): Promise<ProductRow[]> {
  if (!carrierIds.length) return [];
  const client = db();
  const withCopies = await client.from("carrier_products").select(`${PRODUCT_COLUMNS}, copied_from_id`).in("carrier_id", carrierIds).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("name");
  if (!withCopies.error) return rows<ProductRow>(withCopies.data);
  if (!isMissingSchema(withCopies.error)) fail(withCopies.error, "Carrier products");
  // 20260926102410 not applied yet: no copies exist, so nothing is replaced.
  const plain = await client.from("carrier_products").select(PRODUCT_COLUMNS).in("carrier_id", carrierIds).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("name");
  if (plain.error) fail(plain.error, "Carrier products");
  return rows<ProductRow>(plain.data);
}

const band = (v: number | string | null) => (v === null || v === undefined ? null : Number(v).toFixed(2));

export function productView(p: ProductRow): CarrierProductView {
  return {
    id: p.id, carrierId: p.carrier_id, tenantOwned: p.tenant_id !== null, copiedFromId: p.copied_from_id ?? null, productCode: p.product_code, name: p.name,
    tiers: p.tiers ?? [], issueAgeMin: p.issue_age_min, issueAgeMax: p.issue_age_max, faceMinCents: p.face_min_cents === null ? null : Number(p.face_min_cents),
    faceMaxCents: p.face_max_cents === null ? null : Number(p.face_max_cents), bandMin: band(p.premium_per_1000_band_min), bandMax: band(p.premium_per_1000_band_max),
    acceptedPaymentMethods: p.accepted_payment_methods ?? [], isActive: p.is_active, termLengths: p.term_lengths, healthClasses: p.health_classes,
    examAboveFaceCents: p.exam_required_above_face_cents === null ? null : Number(p.exam_required_above_face_cents), convertible: p.convertible,
    conversionDeadlineRule: p.conversion_deadline_rule, renewalType: p.renewal_type,
  };
}

function mapChip(list: { tenant_id: string | null; version: number; status: string }[]): FieldMapChip {
  const own = list.filter((m) => m.tenant_id !== null);
  const pool = own.length ? own : list;
  const newest = (s: string[]) => pool.filter((m) => s.includes(m.status)).sort((a, b) => b.version - a.version)[0];
  const review = newest(["needs_review"]);
  if (review) return { status: "needs_review", version: review.version };
  const live = newest(["published"]);
  if (live) return { status: "published", version: live.version };
  const draft = newest(["draft", "in_review"]);
  if (draft) return { status: "draft", version: draft.version };
  return { status: "none", version: null };
}

export async function getCarriersView(tenantId: string): Promise<Omit<CarriersPayload, "canEdit">> {
  const client = db();
  const ids = await listedCarrierIds(tenantId);
  const [platformList, lines] = await Promise.all([
    client.from("carriers").select("id, name").is("organization_id", null).eq("is_active", true).order("name"),
    productLines(),
  ]);
  if (platformList.error) fail(platformList.error, "Carriers");
  const addable = rows<NamedCarrier>(platformList.data).filter((c) => !ids.includes(c.id));
  if (!ids.length) return { carriers: [], addable, productLines: lines };

  const today = new Date().toISOString().slice(0, 10);
  const carriersRes = await client.from("carriers").select("id, name, portal_origin, reference_pattern, billing_descriptor").in("id", ids).is("organization_id", null).order("name");
  if (carriersRes.error) fail(carriersRes.error, "Carrier settings");
  const [settings, products, appointments, maps, fieldSets, portals] = await Promise.all([
    optional<SettingsRow>(client.from("tenant_carrier_settings").select("carrier_id, portal_origin, reference_pattern, billing_descriptor").eq("tenant_id", tenantId).in("carrier_id", ids)),
    readProducts(tenantId, ids),
    optional<{ carrier_id: string; state: string; status: "pending" | "active" | "terminated"; effective_from: string; terminated_at: string | null; expires_at: string | null }>(
      client.from("appointments").select("carrier_id, state, status, effective_from, terminated_at, expires_at").eq("tenant_id", tenantId).in("carrier_id", ids)),
    optional<{ carrier_id: string; tenant_id: string | null; version: number; status: string }>(
      client.from("carrier_field_map").select("carrier_id, tenant_id, version, status").in("carrier_id", ids).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)),
    optional<{ carrier_id: string; status: string }>(
      client.from("sales_templates").select("carrier_id, status").eq("tenant_id", tenantId).eq("kind", "application_field_set").in("carrier_id", ids)),
    portalAccountsFor(tenantId, ids),
  ]);

  const own = new Map(settings.map((s) => [s.carrier_id, facts(s)]));
  const visibleProducts = preferTenantCopies(products);
  const portalBy = new Map(portals.map((p) => [p.carrierId, p]));

  const carriers: SalesCarrierView[] = rows<CarrierRow>(carriersRes.data).map((c) => {
    const platform = facts(c);
    const override = own.get(c.id) ?? null;
    const appts = appointments.filter((a) => a.carrier_id === c.id);
    const sets = fieldSets.filter((f) => f.carrier_id === c.id);
    return {
      id: c.id,
      name: c.name,
      platform,
      override,
      effective: mergeFacts(platform, override),
      appointment: {
        activeStates: [...new Set(appts.filter((a) => appointmentIsActiveAt(a, today)).map((a) => a.state))].sort(),
        pendingStates: [...new Set(appts.filter((a) => a.status === "pending").map((a) => a.state))].sort(),
      },
      products: visibleProducts.filter((p) => p.carrier_id === c.id).map(productView),
      fieldSet: sets.some((s) => s.status === "published") ? "tenant" : sets.some((s) => s.status === "draft") ? "tenant_draft" : "platform",
      fieldMap: mapChip(maps.filter((m) => m.carrier_id === c.id)),
      portal: portalBy.get(c.id) ?? null,
    };
  });
  return { carriers, addable, productLines: lines };
}

async function platformCarrier(carrierId: string): Promise<CarrierRow> {
  const res = await db().from("carriers").select("id, name, portal_origin, reference_pattern, billing_descriptor").eq("id", carrierId).is("organization_id", null).maybeSingle();
  if (res.error) fail(res.error, "Carrier settings");
  if (!res.data) throw new ApplicationError("CARRIER_NOT_FOUND", "That carrier is not in the Insurvas library.", 404);
  return res.data as CarrierRow;
}

type FactsInput = { portal_origin: string | null; reference_pattern: string | null; billing_descriptor: string | null };

/** "Add a carrier": put a platform carrier on the agency's list, optionally with its own facts. */
export async function addCarrier(actor: Actor, input: FactsInput & { carrier_id: string }) {
  const carrier = await platformCarrier(input.carrier_id);
  const existing = await db().from("tenant_carrier_settings").select("carrier_id").eq("tenant_id", actor.tenantId).eq("carrier_id", carrier.id).maybeSingle();
  if (existing.error) fail(existing.error, "Carrier settings");
  if (existing.data) throw new ApplicationError("CARRIER_ALREADY_LISTED", `${carrier.name} is already on your list.`, 409);
  const after = { portal_origin: input.portal_origin, reference_pattern: input.reference_pattern, billing_descriptor: input.billing_descriptor };
  const ins = await db().from("tenant_carrier_settings").insert({ tenant_id: actor.tenantId, carrier_id: carrier.id, ...after, updated_by: actor.userId });
  if (ins.error) fail(ins.error, "Carrier settings");
  await auditSalesSetting(actor, "tenant.carrier_settings_saved", { type: "carrier", id: carrier.id }, { before: null, after }, { carrierName: carrier.name, added: true });
  return { carrierId: carrier.id };
}

/** The agency's portal origin, reference pattern and descriptor for a platform carrier. Null = the platform's. */
export async function saveCarrierFacts(actor: Actor, carrierId: string, input: FactsInput) {
  const carrier = await platformCarrier(carrierId);
  const client = db();
  const prev = await client.from("tenant_carrier_settings").select("portal_origin, reference_pattern, billing_descriptor").eq("tenant_id", actor.tenantId).eq("carrier_id", carrier.id).maybeSingle();
  if (prev.error) fail(prev.error, "Carrier settings");
  const before = prev.data ? { portal_origin: prev.data.portal_origin, reference_pattern: prev.data.reference_pattern, billing_descriptor: prev.data.billing_descriptor } : null;
  const after = { portal_origin: input.portal_origin, reference_pattern: input.reference_pattern, billing_descriptor: input.billing_descriptor };
  if (before && JSON.stringify(before) === JSON.stringify(after)) return { changed: false };
  const write = before
    ? await client.from("tenant_carrier_settings").update({ ...after, updated_by: actor.userId }).eq("tenant_id", actor.tenantId).eq("carrier_id", carrier.id)
    : await client.from("tenant_carrier_settings").insert({ tenant_id: actor.tenantId, carrier_id: carrier.id, ...after, updated_by: actor.userId });
  if (write.error) fail(write.error, "Carrier settings");
  await auditSalesSetting(actor, "tenant.carrier_settings_saved", { type: "carrier", id: carrier.id }, { before, after }, { carrierName: carrier.name });
  return { changed: true };
}

// ── products ───────────────────────────────────────────────────────────────

function productColumns(p: ProductBody) {
  return {
    product_code: p.product_code, name: p.name, tiers: p.tiers, issue_age_min: p.issue_age_min, issue_age_max: p.issue_age_max,
    face_min_cents: p.face_min_cents, face_max_cents: p.face_max_cents, premium_per_1000_band_min: p.band_min, premium_per_1000_band_max: p.band_max,
    accepted_payment_methods: p.accepted_payment_methods, is_active: p.is_active, term_lengths: p.term_lengths, health_classes: p.health_classes,
    exam_required_above_face_cents: p.exam_required_above_face_cents, convertible: p.convertible, conversion_deadline_rule: p.conversion_deadline_rule, renewal_type: p.renewal_type,
  };
}

/** A stored product's editable columns, as they are (no id, tenant or copy link). */
function productColumnsOf(p: ProductRow) {
  return {
    product_code: p.product_code, name: p.name, tiers: p.tiers ?? [], issue_age_min: p.issue_age_min, issue_age_max: p.issue_age_max,
    face_min_cents: p.face_min_cents, face_max_cents: p.face_max_cents, premium_per_1000_band_min: p.premium_per_1000_band_min, premium_per_1000_band_max: p.premium_per_1000_band_max,
    accepted_payment_methods: p.accepted_payment_methods ?? [], is_active: p.is_active, term_lengths: p.term_lengths, health_classes: p.health_classes,
    exam_required_above_face_cents: p.exam_required_above_face_cents, convertible: p.convertible, conversion_deadline_rule: p.conversion_deadline_rule, renewal_type: p.renewal_type,
  };
}

async function assertProductLine(code: string) {
  const res = await db().from("products").select("code").eq("code", code).maybeSingle();
  if (res.error) fail(res.error, "Product lines");
  if (!res.data) throw new ApplicationError("PRODUCT_LINE_NOT_FOUND", "That product line does not exist.", 400);
}

async function productRow(tenantId: string, id: string): Promise<ProductRow> {
  const res = await db().from("carrier_products").select(PRODUCT_COLUMNS).eq("id", id).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).maybeSingle();
  if (res.error) fail(res.error, "Carrier products");
  if (!res.data) throw new ApplicationError("PRODUCT_NOT_FOUND", "That product could not be found.", 404);
  return res.data as ProductRow;
}

export async function createProduct(actor: Actor, input: ProductBody & { carrier_id: string }) {
  const carrier = await platformCarrier(input.carrier_id);
  await assertProductLine(input.product_code);
  const after = productColumns(input);
  const ins = await db().from("carrier_products").insert({ tenant_id: actor.tenantId, carrier_id: carrier.id, ...after }).select(PRODUCT_COLUMNS).single();
  if (ins.error) fail(ins.error, "Carrier products");
  await auditSalesSetting(actor, "tenant.carrier_product_created", { type: "carrier_product", id: ins.data.id }, { before: null, after }, { carrierId: carrier.id, carrierName: carrier.name });
  return productView(ins.data as ProductRow);
}

export async function updateProduct(actor: Actor, id: string, input: ProductBody) {
  const row = await productRow(actor.tenantId, id);
  if (row.tenant_id === null) throw new ApplicationError("PLATFORM_PRODUCT_READ_ONLY", "This is an Insurvas library product. Copy it to your agency to change it.", 403);
  if (input.product_code !== row.product_code) await assertProductLine(input.product_code);
  const before = { ...productColumnsOf(row), premium_per_1000_band_min: band(row.premium_per_1000_band_min), premium_per_1000_band_max: band(row.premium_per_1000_band_max) };
  const after = productColumns(input);
  const upd = await db().from("carrier_products").update(after).eq("id", id).eq("tenant_id", actor.tenantId).select(PRODUCT_COLUMNS).single();
  if (upd.error) fail(upd.error, "Carrier products");
  await auditSalesSetting(actor, "tenant.carrier_product_updated", { type: "carrier_product", id }, { before, after }, { carrierId: row.carrier_id });
  return productView(upd.data as ProductRow);
}

/** "Copy to my agency" for a platform product: a tenant row naming the row it replaces. The source is untouched. */
export async function copyProduct(actor: Actor, id: string) {
  const row = await productRow(actor.tenantId, id);
  if (row.tenant_id !== null) throw new ApplicationError("PRODUCT_ALREADY_OWN", "This product is already your agency's.", 409);
  const sourceId = row.id;
  const columns = { carrier_id: row.carrier_id, ...productColumnsOf(row) };
  const ins = await db().from("carrier_products").insert({ ...columns, tenant_id: actor.tenantId, copied_from_id: sourceId }).select(`${PRODUCT_COLUMNS}, copied_from_id`).single();
  if (ins.error) fail(ins.error, "Carrier products");
  await auditSalesSetting(actor, "tenant.carrier_product_copied", { type: "carrier_product", id: ins.data.id }, { before: null, after: columns }, { copiedFromId: sourceId, carrierId: row.carrier_id });
  return productView(ins.data as ProductRow);
}
