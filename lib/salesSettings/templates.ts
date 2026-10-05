import "server-only";

import type { Actor } from "@/lib/applications/http";
import { ApplicationError, SchemaPendingError, db, isMissingSchema, rows, type DbError } from "@/lib/applications/db";
import type { StoredDefinition } from "@/lib/applications/templates";

import { auditSalesSetting } from "./audit";
import { listedCarrierIds, namedCarriers, preferTenantCopies, productLines } from "./carriers";
import { definitionProblem, definitionSchemaFor, type SalesTemplateKind, type SalesTemplateStatus } from "./templateSchemas";
import type { TemplateRowView, TemplatesPayload } from "./views";

/**
 * LA-3.1 / 3.4 / 3.7 / 3.17 · Settings › Sales templates (`sales_templates`, 20260926100100).
 *
 * A template's lineage is (tenant, kind, product line, carrier); its rows are its versions. Drafts are
 * edited in place. A published or retired row never changes (the table's trigger refuses it), so
 * editing one writes version N + 1 as a draft; interviews and quotes already taken keep the version
 * they recorded. Publishing retires nothing unless asked. Platform rows (tenant_id null) are read
 * only: "Copy to my agency" clones one into a tenant draft and leaves it untouched.
 */

const COLUMNS = "id, tenant_id, kind, product_code, carrier_id, name, version, status, definition, created_by, created_at, updated_at, published_at";

type Row = {
  id: string; tenant_id: string | null; kind: SalesTemplateKind; product_code: string; carrier_id: string | null; name: string; version: number;
  status: SalesTemplateStatus; definition: StoredDefinition; created_by: string | null; created_at: string; updated_at: string; published_at: string | null;
};

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  const message = error?.message ?? "";
  if (/SALES_TEMPLATE_PUBLISHED_IMMUTABLE/.test(message)) throw new ApplicationError("SALES_TEMPLATE_PUBLISHED_IMMUTABLE", "A published template cannot be changed. Edit it to make a new version.", 409);
  if (error?.code === "23505") throw new ApplicationError("SALES_TEMPLATE_CONFLICT", "Someone saved a version of this template at the same moment. Refresh and try again.", 409);
  if (error?.code === "23503") throw new ApplicationError("SALES_TEMPLATE_REFERENCE", "That carrier or product line no longer exists.", 400);
  throw new ApplicationError("SALES_TEMPLATE_UNAVAILABLE", `${what}: ${message || "unknown error"}`, 500);
}

/** A query narrowed to one template's versions in this tenant (db() is the loose service handle). */
function lineage(q: ReturnType<typeof db>, row: { kind: string; product_code: string; carrier_id: string | null }, tenantId: string) {
  const scoped = q.eq("tenant_id", tenantId).eq("kind", row.kind).eq("product_code", row.product_code);
  return row.carrier_id ? scoped.eq("carrier_id", row.carrier_id) : scoped.is("carrier_id", null);
}

async function nextVersion(tenantId: string, key: { kind: string; product_code: string; carrier_id: string | null }) {
  const res = await lineage(db().from("sales_templates").select("version"), key, tenantId).order("version", { ascending: false }).limit(1);
  if (res.error) fail(res.error, "Sales templates");
  return (rows<{ version: number }>(res.data)[0]?.version ?? 0) + 1;
}

/** The row, if it is the agency's own or a platform default. Another tenant's row does not exist. */
async function readRow(tenantId: string, id: string): Promise<Row> {
  const res = await db().from("sales_templates").select(COLUMNS).eq("id", id).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).maybeSingle();
  if (res.error) fail(res.error, "Sales templates");
  if (!res.data) throw new ApplicationError("SALES_TEMPLATE_NOT_FOUND", "That template could not be found.", 404);
  return res.data as Row;
}

async function ownRow(tenantId: string, id: string): Promise<Row> {
  const row = await readRow(tenantId, id);
  if (row.tenant_id === null) throw new ApplicationError("SALES_TEMPLATE_PLATFORM", "This is an Insurvas default. Copy it to your agency to change it.", 403);
  return row;
}

function assertDefinition(kind: SalesTemplateKind, definition: unknown) {
  const problem = definitionProblem(kind, definition);
  if (problem) throw new ApplicationError("SALES_TEMPLATE_INVALID", problem, 400);
}

/**
 * The definition as it validated: trimmed. Storing the raw input let a choice typed as "Diabetes "
 * pass (the schema compares trimmed values) while its follow-up's `equals` never matched again.
 */
function validDefinition(kind: SalesTemplateKind, definition: Record<string, unknown>): Record<string, unknown> {
  assertDefinition(kind, definition);
  return definitionSchemaFor(kind).parse(definition) as Record<string, unknown>;
}

async function assertTargets(productCode: string, carrierId: string | null) {
  const client = db();
  const [product, carrier] = await Promise.all([
    client.from("products").select("code").eq("code", productCode).maybeSingle(),
    carrierId ? client.from("carriers").select("id").eq("id", carrierId).is("organization_id", null).maybeSingle() : Promise.resolve({ data: { id: null }, error: null }),
  ]);
  if (product.error) fail(product.error, "Product lines");
  if (!product.data) throw new ApplicationError("PRODUCT_LINE_NOT_FOUND", "That product line does not exist.", 400);
  if (carrier.error) fail(carrier.error, "Carriers");
  if (!carrier.data) throw new ApplicationError("CARRIER_NOT_FOUND", "That carrier is not in the Insurvas library.", 400);
}

function toView(r: Row, names: { products: Map<string, string>; carriers: Map<string, string>; users: Map<string, string> }): TemplateRowView {
  return {
    id: r.id, tenantOwned: r.tenant_id !== null, kind: r.kind, productCode: r.product_code, productName: names.products.get(r.product_code) ?? r.product_code,
    carrierId: r.carrier_id, carrierName: r.carrier_id ? names.carriers.get(r.carrier_id) ?? "Carrier" : null, name: r.name, version: r.version, status: r.status,
    definition: r.definition ?? {}, publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at,
    editedBy: r.created_by ? names.users.get(r.created_by) ?? null : null,
  };
}

async function namesFor(list: Row[]) {
  const carrierIds = [...new Set(list.map((r) => r.carrier_id).filter((x): x is string => Boolean(x)))];
  const userIds = [...new Set(list.map((r) => r.created_by).filter((x): x is string => Boolean(x)))];
  const client = db();
  const [lines, carriers, users] = await Promise.all([
    productLines(),
    carrierIds.length ? client.from("carriers").select("id, name").in("id", carrierIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? client.from("users").select("id, name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  return {
    lines,
    products: new Map(lines.map((p) => [p.code, p.name])),
    carriers: new Map(rows<{ id: string; name: string }>(carriers.data).map((c) => [c.id, c.name])),
    users: new Map(rows<{ id: string; name: string | null }>(users.data).map((u) => [u.id, u.name ?? "A colleague"])),
  };
}

export async function listSalesTemplates(tenantId: string, kind: SalesTemplateKind): Promise<Omit<TemplatesPayload, "canEdit">> {
  const client = db();
  const res = await client.from("sales_templates").select(COLUMNS).eq("kind", kind).or(`tenant_id.eq.${tenantId},and(tenant_id.is.null,status.eq.published)`).order("product_code").order("version", { ascending: false });
  if (res.error) fail(res.error, "Sales templates");
  const list = rows<Row>(res.data);
  const carrierIds = await listedCarrierIds(tenantId);
  const productQuery = (columns: string) => client.from("carrier_products").select(columns).in("carrier_id", carrierIds).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).eq("is_active", true).order("name");
  const [names, carriers, first] = await Promise.all([
    namesFor(list),
    namedCarriers(carrierIds),
    carrierIds.length ? productQuery("id, tenant_id, carrier_id, product_code, name, copied_from_id") : Promise.resolve({ data: [], error: null }),
  ]);
  // copied_from_id arrives with 20260926102410; before it, read without it (nothing is a copy yet).
  const products = first.error && isMissingSchema(first.error) ? await productQuery("id, tenant_id, carrier_id, product_code, name") : first;
  const productRows = products.error && isMissingSchema(products.error) ? [] : rows<{ id: string; tenant_id: string | null; carrier_id: string; product_code: string; name: string; copied_from_id?: string | null }>(products.data);
  return {
    templates: list.map((r) => toView(r, names)),
    carriers,
    carrierProducts: preferTenantCopies(productRows).map((p) => ({ carrierId: p.carrier_id, productCode: p.product_code, name: p.name })),
    productLines: names.lines,
  };
}

async function viewOf(row: Row) {
  return toView(row, await namesFor([row]));
}

export async function createSalesTemplate(actor: Actor, input: { kind: SalesTemplateKind; product_code: string; carrier_id: string | null; name: string; definition: Record<string, unknown> }) {
  const definition = validDefinition(input.kind, input.definition);
  await assertTargets(input.product_code, input.carrier_id);
  const version = await nextVersion(actor.tenantId, input);
  if (version > 1) throw new ApplicationError("SALES_TEMPLATE_EXISTS", "Your agency already has this template for that product line and carrier. Edit it, or duplicate it for another carrier.", 409);
  const ins = await db().from("sales_templates").insert({
    tenant_id: actor.tenantId, kind: input.kind, product_code: input.product_code, carrier_id: input.carrier_id, name: input.name,
    version, status: "draft", definition, created_by: actor.userId,
  }).select(COLUMNS).single();
  if (ins.error) fail(ins.error, "Sales templates");
  const row = ins.data as Row;
  await auditSalesSetting(actor, "tenant.sales_template_created", { type: "sales_template", id: row.id }, { before: null, after: { name: row.name, version, definition: row.definition } }, { kind: row.kind, productCode: row.product_code, carrierId: row.carrier_id });
  return viewOf(row);
}

/**
 * Save an edit. A draft changes in place; a published or retired version stays as it was and the
 * edit becomes version N + 1, a draft. Only one draft is open per template at a time.
 */
export async function saveSalesTemplate(actor: Actor, id: string, input: { name?: string; definition: Record<string, unknown> }) {
  const row = await ownRow(actor.tenantId, id);
  const definition = validDefinition(row.kind, input.definition);
  const name = input.name ?? row.name;
  const client = db();

  if (row.status === "draft") {
    const upd = await client.from("sales_templates").update({ name, definition }).eq("id", row.id).eq("tenant_id", actor.tenantId).eq("status", "draft").select(COLUMNS).maybeSingle();
    if (upd.error) fail(upd.error, "Sales templates");
    if (!upd.data) throw new ApplicationError("SALES_TEMPLATE_PUBLISHED_IMMUTABLE", "This version was published while you were editing. Refresh and edit it again to make a new version.", 409);
    await auditSalesSetting(actor, "tenant.sales_template_updated", { type: "sales_template", id: row.id }, { before: { name: row.name, definition: row.definition }, after: { name, definition } }, { kind: row.kind, version: row.version });
    return { template: await viewOf(upd.data as Row), created: false };
  }

  const open = await lineage(client.from("sales_templates").select("id, version"), row, actor.tenantId).eq("status", "draft").limit(1);
  if (open.error) fail(open.error, "Sales templates");
  const draft = rows<{ id: string; version: number }>(open.data)[0];
  if (draft) throw new ApplicationError("SALES_TEMPLATE_DRAFT_OPEN", `Version ${draft.version} is already a draft of this template. Edit that one instead.`, 409);

  const version = await nextVersion(actor.tenantId, row);
  const ins = await client.from("sales_templates").insert({
    tenant_id: actor.tenantId, kind: row.kind, product_code: row.product_code, carrier_id: row.carrier_id, name, version, status: "draft", definition, created_by: actor.userId,
  }).select(COLUMNS).single();
  if (ins.error) fail(ins.error, "Sales templates");
  const created = ins.data as Row;
  await auditSalesSetting(actor, "tenant.sales_template_version_created", { type: "sales_template", id: created.id },
    { before: { name: row.name, version: row.version, definition: row.definition }, after: { name, version, definition } },
    { kind: row.kind, fromTemplateId: row.id });
  return { template: await viewOf(created), created: true };
}

/**
 * Publish a draft. The versions it replaces are retired with it, always: a second live version was
 * never loaded (the newest wins) but came back silently the day the newer one was retired, when the
 * owner expected the platform fallback. Work already started keeps the version it began on either
 * way. The route still accepts `retire_previous` from older clients; it no longer changes anything.
 */
export async function publishSalesTemplate(actor: Actor, id: string) {
  const row = await ownRow(actor.tenantId, id);
  if (row.status !== "draft") throw new ApplicationError("SALES_TEMPLATE_NOT_DRAFT", `Version ${row.version} is already ${row.status}.`, 409);
  assertDefinition(row.kind, row.definition);
  const client = db();
  const now = new Date().toISOString();
  const upd = await client.from("sales_templates").update({ status: "published", published_at: now }).eq("id", row.id).eq("tenant_id", actor.tenantId).eq("status", "draft").select(COLUMNS).maybeSingle();
  if (upd.error) fail(upd.error, "Sales templates");
  if (!upd.data) throw new ApplicationError("SALES_TEMPLATE_NOT_DRAFT", "Someone published this version a moment ago. Refresh to see it.", 409);
  const ret = await lineage(client.from("sales_templates").update({ status: "retired" }), row, actor.tenantId).eq("status", "published").lt("version", row.version).select("id, version");
  if (ret.error) fail(ret.error, "Sales templates");
  const retired = rows<{ id: string; version: number }>(ret.data);
  await auditSalesSetting(actor, "tenant.sales_template_published", { type: "sales_template", id: row.id }, { before: { status: "draft" }, after: { status: "published", published_at: now } },
    { kind: row.kind, version: row.version, retiredVersions: retired.map((r) => r.version) });
  return viewOf(upd.data as Row);
}

export async function retireSalesTemplate(actor: Actor, id: string) {
  const row = await ownRow(actor.tenantId, id);
  if (row.status !== "published") throw new ApplicationError("SALES_TEMPLATE_NOT_PUBLISHED", row.status === "draft" ? "A draft is not in use. Leave it or publish it." : "This version is already retired.", 409);
  const upd = await db().from("sales_templates").update({ status: "retired" }).eq("id", row.id).eq("tenant_id", actor.tenantId).eq("status", "published").select(COLUMNS).maybeSingle();
  if (upd.error) fail(upd.error, "Sales templates");
  if (!upd.data) throw new ApplicationError("SALES_TEMPLATE_NOT_PUBLISHED", "This version changed a moment ago. Refresh to see it.", 409);
  await auditSalesSetting(actor, "tenant.sales_template_retired", { type: "sales_template", id: row.id }, { before: { status: "published" }, after: { status: "retired" } }, { kind: row.kind, version: row.version });
  return viewOf(upd.data as Row);
}

/**
 * "Copy to my agency" (a platform default → a tenant draft, same product and carrier) or
 * "Duplicate" (the agency's own template → a draft for another product line or carrier). The source
 * row is never changed.
 */
export async function copySalesTemplate(actor: Actor, id: string, input: { product_code?: string; carrier_id?: string | null; name?: string }) {
  const source = await readRow(actor.tenantId, id);
  const target = { kind: source.kind, product_code: input.product_code ?? source.product_code, carrier_id: input.carrier_id === undefined ? source.carrier_id : input.carrier_id };
  const sameLineage = target.product_code === source.product_code && target.carrier_id === source.carrier_id;
  if (source.tenant_id !== null && sameLineage) {
    throw new ApplicationError("SALES_TEMPLATE_SAME_LINEAGE", "A duplicate needs a different product line or carrier. To change this template, edit it.", 400);
  }
  if (!sameLineage) await assertTargets(target.product_code, target.carrier_id);
  const open = await lineage(db().from("sales_templates").select("id, version"), target, actor.tenantId).eq("status", "draft").limit(1);
  if (open.error) fail(open.error, "Sales templates");
  const draft = rows<{ id: string; version: number }>(open.data)[0];
  if (draft) throw new ApplicationError("SALES_TEMPLATE_DRAFT_OPEN", `Your agency already has a draft for this product and carrier (version ${draft.version}). Edit that one instead.`, 409);
  const version = await nextVersion(actor.tenantId, target);
  const name = input.name ?? source.name;
  const ins = await db().from("sales_templates").insert({
    tenant_id: actor.tenantId, ...target, name, version, status: "draft", definition: source.definition, created_by: actor.userId,
  }).select(COLUMNS).single();
  if (ins.error) fail(ins.error, "Sales templates");
  const row = ins.data as Row;
  await auditSalesSetting(actor, "tenant.sales_template_copied", { type: "sales_template", id: row.id },
    { before: null, after: { name, version, productCode: target.product_code, carrierId: target.carrier_id } },
    { kind: source.kind, fromTemplateId: source.id, fromVersion: source.version, fromPlatform: source.tenant_id === null });
  return viewOf(row);
}
