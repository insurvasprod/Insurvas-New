import "server-only";

import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError, type DbError } from "@/lib/applications/db";
import { CANONICAL_GROUPS, isSensitiveKey, PAYMENT_FIELD_KEYS } from "@/lib/applications/constants";
import { effectiveCarrierFacts } from "@/lib/salesSettings/carriers";
import type { CarrierFacts } from "@/lib/salesSettings/views";
import { auditExtension } from "./audit";
import { EDITABLE_FIELD_MAP_STATUSES, FILLABLE_FIELD_MAP_STATUSES, type FieldMapInputKind, type FieldMapStatus } from "./constants";
import type { MapInput } from "./payload";
import type { SaveMapInput } from "./schemas";
import { httpsOrigin } from "./token";
import type { FieldMapCarrierOption, FieldMapEntryView, FieldMapView } from "./types";
import type { ExtensionContext } from "./grants";

/**
 * LA-3.13 field maps: storage, review and fill — no AI. Two planes edit them:
 *
 *   · an agency (owner) edits its own maps (tenant_id = the agency); platform maps are read-only to it
 *     and "New version" on one copies it into the agency;
 *   · staff (the admin console, carriers access) edit platform maps (tenant_id null).
 *
 * The database is the guard: publishing with an unverified SSN / bank / card entry and any change to
 * a published map are refused by triggers, and their messages are surfaced as they are.
 * `proposal_source` is always 'manual' here — 'ai' is decision 4's seam and nothing writes it.
 */

/** `request` is needed for writes (the audit row carries its IP and user agent); a page's read has none. */
export type MapScope =
  | { plane: "tenant"; tenantId: string; userId: string; request?: Request }
  | { plane: "admin"; adminId: string; request?: Request };

type MapRow = {
  id: string; tenant_id: string | null; carrier_id: string; carrier_product_id: string | null; version: number; status: FieldMapStatus; origin: string | null;
  created_by: string | null; approved_by: string | null; approved_at: string | null; proposal_source: "manual" | "ai"; created_at: string; updated_at: string;
};
type StepRow = { id: string; map_id: string; page_key: string; url_pattern: string; sort_order: number };
type EntryRow = {
  id: string; step_id: string; field_key: string; selector: string; selector_fallback: string | null; input_kind: FieldMapInputKind; value_transform: string | null;
  option_map: Record<string, string> | null; confidence: number | string | null; verified: boolean; verified_by: string | null;
};

const MAP_COLUMNS = "id, tenant_id, carrier_id, carrier_product_id, version, status, origin, created_by, approved_by, approved_at, proposal_source, created_at, updated_at";
const ENTRY_COLUMNS = "id, step_id, field_key, selector, selector_fallback, input_kind, value_transform, option_map, confidence, verified, verified_by";
const KNOWN_KEYS = new Set<string>([...CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => f.key)), ...PAYMENT_FIELD_KEYS]);

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  const message = error?.message ?? "";
  // The triggers' own words, without their code prefix.
  const trigger = /(CARRIER_FIELD_MAP_[A-Z_]+):\s*(.+)$/.exec(message);
  if (trigger) {
    const text = trigger[2].charAt(0).toUpperCase() + trigger[2].slice(1);
    throw new ApplicationError(trigger[1], text.endsWith(".") ? text : `${text}.`, 409);
  }
  if (error?.code === "23505") throw new ApplicationError("FIELD_MAP_CONFLICT", "Someone else changed this map at the same moment. Refresh and try again.", 409);
  throw new ApplicationError("FIELD_MAP_UNAVAILABLE", `${what}: ${message || "unknown error"}`, 500);
}

const scopeTenant = (scope: MapScope) => (scope.plane === "tenant" ? scope.tenantId : null);

/**
 * Staff are admin_users; users-typed approver columns cannot hold them. 20260926102510 adds
 * approved_by_admin / verified_by_admin — until it is applied, staff verification is refused here.
 */
function adminCannotApprove(): never {
  throw new ApplicationError(
    "FIELD_MAP_STAFF_APPROVER_PENDING",
    "Staff can't verify or publish platform maps yet: the staff-approver migration (20260926102510) has not been applied.",
    409,
  );
}

/**
 * Admin plane: who (staff) verified each entry. Read apart from ENTRY_COLUMNS so the agency plane
 * never names a column that may not exist yet. `required` refuses with the pending message when the
 * column is missing; otherwise a missing column reads as "no staff verifications".
 */
async function staffVerifiers(entryIds: string[], opts: { required: boolean }): Promise<Map<string, string | null> | null> {
  const probe = entryIds.length ? entryIds : ["00000000-0000-0000-0000-000000000000"];
  const q = await db().from("carrier_field_map_entry").select("id, verified_by_admin").in("id", probe);
  if (q.error) {
    if (isMissingSchema(q.error)) return opts.required ? adminCannotApprove() : null;
    fail(q.error, "Carrier field maps");
  }
  return new Map(rows<{ id: string; verified_by_admin: string | null }>(q.data).map((r) => [r.id, r.verified_by_admin]));
}

// ── reads ──────────────────────────────────────────────────────────────────

async function mapRow(scope: MapScope, id: string, opts: { write?: boolean } = {}): Promise<MapRow> {
  const q = await db().from("carrier_field_map").select(MAP_COLUMNS).eq("id", id).maybeSingle();
  if (q.error) fail(q.error, "Carrier field maps");
  const row = q.data as MapRow | null;
  const tenant = scopeTenant(scope);
  const visible = row && (scope.plane === "admin" ? row.tenant_id === null : row.tenant_id === null || row.tenant_id === tenant);
  if (!row || !visible) throw new ApplicationError("FIELD_MAP_NOT_FOUND", "That field map could not be found.", 404);
  if (opts.write && row.tenant_id !== tenant) throw new ApplicationError("FIELD_MAP_PLATFORM", "This is an Insurvas platform map. Start a new version to make your own copy.", 403);
  return row;
}

async function stepsAndEntries(mapIds: string[]) {
  if (!mapIds.length) return { steps: [] as StepRow[], entries: [] as EntryRow[] };
  const steps = await db().from("carrier_field_map_step").select("id, map_id, page_key, url_pattern, sort_order").in("map_id", mapIds).order("sort_order");
  if (steps.error) fail(steps.error, "Carrier field maps");
  const stepRows = rows<StepRow>(steps.data);
  if (!stepRows.length) return { steps: stepRows, entries: [] as EntryRow[] };
  const entries = await db().from("carrier_field_map_entry").select(ENTRY_COLUMNS).in("step_id", stepRows.map((s) => s.id));
  if (entries.error) fail(entries.error, "Carrier field maps");
  return { steps: stepRows, entries: rows<EntryRow>(entries.data) };
}

async function toViews(scope: MapScope, maps: MapRow[]): Promise<FieldMapView[]> {
  if (!maps.length) return [];
  const client = db();
  const ids = maps.map((m) => m.id);
  const carrierIds = [...new Set(maps.map((m) => m.carrier_id))];
  const productIds = [...new Set(maps.map((m) => m.carrier_product_id).filter((x): x is string => Boolean(x)))];
  let misses = client.from("carrier_field_map_events").select("id, map_id, field_key, detail, at").eq("kind", "map_miss").in("map_id", ids).order("at", { ascending: false }).limit(500);
  if (scope.plane === "tenant") misses = misses.eq("tenant_id", scope.tenantId);
  const [{ steps, entries }, carriers, products, missQ] = await Promise.all([
    stepsAndEntries(ids),
    client.from("carriers").select("id, name").in("id", carrierIds),
    productIds.length ? client.from("carrier_products").select("id, name").in("id", productIds) : Promise.resolve({ data: [], error: null }),
    misses,
  ]);
  const carrierBy = new Map(rows<{ id: string; name: string }>(carriers.data).map((c) => [c.id, c.name]));
  const productBy = new Map(rows<{ id: string; name: string }>(products.data).map((p) => [p.id, p.name]));
  const missRows = missQ.error ? [] : rows<{ id: string; map_id: string; field_key: string | null; detail: { url?: string } | null; at: string }>(missQ.data);
  const stepBy = new Map(steps.map((s) => [s.id, s]));
  return maps.map((m) => {
    const mySteps = steps.filter((s) => s.map_id === m.id);
    const myEntries: FieldMapEntryView[] = entries.filter((e) => stepBy.get(e.step_id)?.map_id === m.id).map((e) => ({
      id: e.id, pageKey: stepBy.get(e.step_id)!.page_key, fieldKey: e.field_key, selector: e.selector, selectorFallback: e.selector_fallback,
      inputKind: e.input_kind, transform: e.value_transform, optionMap: e.option_map, confidence: e.confidence === null ? null : Number(e.confidence), verified: e.verified,
    }));
    return {
      id: m.id, carrierId: m.carrier_id, carrierName: carrierBy.get(m.carrier_id) ?? "Carrier", productId: m.carrier_product_id,
      productLabel: (m.carrier_product_id && productBy.get(m.carrier_product_id)) || "All products", version: m.version, status: m.status, origin: m.origin ?? "",
      platform: m.tenant_id === null, proposalSource: m.proposal_source,
      steps: mySteps.map((s) => ({ pageKey: s.page_key, urlPattern: s.url_pattern, sortOrder: s.sort_order })),
      entries: myEntries,
      misses: missRows.filter((x) => x.map_id === m.id && x.field_key).map((x) => ({ id: x.id, fieldKey: x.field_key!, url: x.detail?.url ?? m.origin ?? "", at: x.at })),
      updatedAt: m.updated_at, approvedAt: m.approved_at,
    };
  });
}

/** Tenant plane: the agency's own maps and the platform's. Admin plane: platform maps only. */
export async function listMaps(scope: MapScope): Promise<FieldMapView[]> {
  let q = db().from("carrier_field_map").select(MAP_COLUMNS).order("updated_at", { ascending: false }).limit(500);
  q = scope.plane === "admin" ? q.is("tenant_id", null) : q.or(`tenant_id.is.null,tenant_id.eq.${scope.tenantId}`);
  const { data, error } = await q;
  if (error) fail(error, "Carrier field maps");
  return toViews(scope, rows<MapRow>(data));
}

export async function getMap(scope: MapScope, id: string): Promise<FieldMapView> {
  const row = await mapRow(scope, id);
  return (await toViews(scope, [row]))[0];
}

/** Carriers (and their products) a new map can be for. */
export async function carrierOptions(scope: MapScope): Promise<FieldMapCarrierOption[]> {
  const client = db();
  let carrierIds: string[] | null = null;
  if (scope.plane === "tenant") {
    const contracted = await client.from("tenant_carriers").select("carrier_id").eq("tenant_id", scope.tenantId);
    if (contracted.error && !isMissingSchema(contracted.error)) fail(contracted.error, "Carriers");
    carrierIds = [...new Set(rows<{ carrier_id: string }>(contracted.data).map((c) => c.carrier_id))];
    if (!carrierIds.length) return [];
  }
  let cq = client.from("carriers").select("id, name, portal_origin").eq("is_active", true).order("name");
  cq = carrierIds ? cq.in("id", carrierIds) : cq.is("organization_id", null);
  const carriers = await cq;
  if (carriers.error) fail(carriers.error, "Carriers");
  const list = rows<{ id: string; name: string; portal_origin: string | null }>(carriers.data);
  if (!list.length) return [];
  let pq = client.from("carrier_products").select("id, name, carrier_id, tenant_id").in("carrier_id", list.map((c) => c.id)).eq("is_active", true).order("name");
  pq = scope.plane === "admin" ? pq.is("tenant_id", null) : pq.or(`tenant_id.is.null,tenant_id.eq.${scope.tenantId}`);
  // A tenant map is drawn against the agency's own portal origin where it set one (LA-3.17).
  const [products, facts] = await Promise.all([
    pq,
    scope.plane === "tenant" ? effectiveCarrierFacts(scope.tenantId, list.map((c) => c.id)).catch(() => new Map<string, CarrierFacts>()) : Promise.resolve(new Map<string, CarrierFacts>()),
  ]);
  const productRows = products.error ? [] : rows<{ id: string; name: string; carrier_id: string }>(products.data);
  return list.map((c) => ({ id: c.id, name: c.name, portalOrigin: httpsOrigin(facts.get(c.id)?.portalOrigin ?? null) ?? httpsOrigin(c.portal_origin), products: productRows.filter((p) => p.carrier_id === c.id).map((p) => ({ id: p.id, name: p.name })) }));
}

async function nextVersion(tenantId: string | null, carrierId: string, productId: string | null) {
  let q = db().from("carrier_field_map").select("version").eq("carrier_id", carrierId).order("version", { ascending: false }).limit(1);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  q = productId ? q.eq("carrier_product_id", productId) : q.is("carrier_product_id", null);
  const { data, error } = await q;
  if (error) fail(error, "Carrier field maps");
  return (rows<{ version: number }>(data)[0]?.version ?? 0) + 1;
}

async function auditMap(scope: MapScope, action: "field_map.created" | "field_map.updated" | "field_map.published", mapId: string, metadata: Record<string, unknown>) {
  if (!scope.request) throw new Error("A field-map write needs its request for the audit row.");
  await auditExtension({
    actorType: scope.plane, actorId: scope.plane === "tenant" ? scope.userId : scope.adminId, action, targetType: "carrier_field_map", targetId: mapId,
    metadata: { ...metadata, plane: scope.plane }, request: scope.request,
  });
}

// ── writes ─────────────────────────────────────────────────────────────────

export async function createMap(scope: MapScope, input: { carrierId: string; productId: string | null; origin: string }) {
  const origin = httpsOrigin(input.origin);
  if (!origin) throw new ApplicationError("ORIGIN_INVALID", "Enter the carrier portal address, starting https://.");
  const options = await carrierOptions(scope);
  const carrier = options.find((c) => c.id === input.carrierId);
  if (!carrier) throw new ApplicationError("CARRIER_NOT_FOUND", scope.plane === "tenant" ? "Add this carrier to your agency first." : "That carrier could not be found.", 404);
  if (input.productId && !carrier.products.some((p) => p.id === input.productId)) throw new ApplicationError("PRODUCT_NOT_FOUND", "That product is not one of this carrier's.", 404);
  const tenantId = scopeTenant(scope);
  const version = await nextVersion(tenantId, input.carrierId, input.productId);
  const inserted = await db().from("carrier_field_map").insert({
    tenant_id: tenantId, carrier_id: input.carrierId, carrier_product_id: input.productId, version, status: "draft", origin,
    created_by: scope.plane === "tenant" ? scope.userId : null, proposal_source: "manual",
  }).select("id").single();
  if (inserted.error) fail(inserted.error, "Carrier field maps");
  await auditMap(scope, "field_map.created", inserted.data.id, { carrierId: input.carrierId, productId: input.productId, version, origin });
  return getMap(scope, inserted.data.id);
}

/** Saves a draft's pages and entries (upsert + prune, never delete-then-insert). */
export async function saveMap(scope: MapScope, id: string, input: SaveMapInput) {
  const map = await mapRow(scope, id, { write: true });
  if (!EDITABLE_FIELD_MAP_STATUSES.includes(map.status)) throw new ApplicationError("CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE", `Map v${map.version} has been published and can't be changed. Start a new version to fix a field.`, 409);

  const seen = new Set<string>();
  for (const e of input.entries) {
    if (!KNOWN_KEYS.has(e.field_key)) throw new ApplicationError("FIELD_UNKNOWN", `There is no application field called ${e.field_key}.`);
    if (seen.has(`${e.page_key}|${e.field_key}`)) throw new ApplicationError("FIELD_DUPLICATE", `${e.field_key} is mapped twice on the ${e.page_key} page.`);
    seen.add(`${e.page_key}|${e.field_key}`);
  }
  const empty = input.entries.filter((e) => !e.selector.trim()).length;
  if (empty) throw new ApplicationError("SELECTOR_EMPTY", `Give every field a selector before saving — ${empty} ${empty === 1 ? "is" : "are"} empty.`);

  const client = db();
  const { steps: oldSteps, entries: oldEntries } = await stepsAndEntries([map.id]);
  const oldStepByKey = new Map(oldSteps.map((s) => [s.page_key, s]));
  const pageKeys = [...new Set([...(input.steps ?? []).map((s) => s.page_key), ...input.entries.map((e) => e.page_key)])];
  const stepInput = new Map((input.steps ?? []).map((s) => [s.page_key, s]));
  const stepPayload = pageKeys.map((key, i) => {
    const given = stepInput.get(key);
    const old = oldStepByKey.get(key);
    // A page with no address yet matches every page of the portal; its misses are not reported
    // (the extension cannot tell "not on this page" from "not found" without one).
    return { map_id: map.id, page_key: key, url_pattern: given?.url_pattern ?? old?.url_pattern ?? "*", sort_order: given?.sort_order ?? old?.sort_order ?? i };
  });
  if (stepPayload.length) {
    const up = await client.from("carrier_field_map_step").upsert(stepPayload, { onConflict: "map_id,page_key" }).select("id, page_key");
    if (up.error) fail(up.error, "Could not save the map's pages");
  }
  const stepsNow = await client.from("carrier_field_map_step").select("id, map_id, page_key, url_pattern, sort_order").eq("map_id", map.id);
  if (stepsNow.error) fail(stepsNow.error, "Carrier field maps");
  const stepIdByKey = new Map(rows<StepRow>(stepsNow.data).map((s) => [s.page_key, s.id]));

  const oldByKey = new Map(oldEntries.map((e) => [`${oldSteps.find((s) => s.id === e.step_id)?.page_key}|${e.field_key}`, e]));
  // Staff verify into verified_by_admin (20260926102510). Only looked up when something is verified,
  // so a staff draft without verifications still saves before that migration is applied.
  const staff = scope.plane === "admin" && input.entries.some((e) => e.verified) ? await staffVerifiers(oldEntries.map((e) => e.id), { required: true }) : null;
  const entryPayload = input.entries.map((e) => {
    const old = oldByKey.get(`${e.page_key}|${e.field_key}`);
    const same = old && old.selector === e.selector && (old.selector_fallback ?? null) === (e.selector_fallback || null) && old.input_kind === e.input_kind
      && (old.value_transform ?? null) === (e.value_transform || null) && JSON.stringify(old.option_map ?? null) === JSON.stringify(e.option_map ?? null);
    // Verification is a claim about this exact selector: it survives a save only if nothing changed.
    const shared = {
      step_id: stepIdByKey.get(e.page_key)!, field_key: e.field_key, selector: e.selector.trim(), selector_fallback: e.selector_fallback?.trim() || null,
      input_kind: e.input_kind, value_transform: e.value_transform && e.value_transform !== "none" ? e.value_transform : null, option_map: e.option_map ?? null,
      confidence: same ? old?.confidence ?? null : null,
    };
    if (scope.plane === "admin") {
      const keptStaff = same && old?.verified ? staff?.get(old.id) ?? null : null;
      const staffBy = e.verified ? keptStaff ?? scope.adminId : null;
      return { ...shared, verified: Boolean(staffBy), verified_by: null, ...(staff ? { verified_by_admin: staffBy } : {}) };
    }
    const kept = same && old?.verified && old.verified_by ? old.verified_by : null;
    const verifiedBy = e.verified ? kept ?? scope.userId : null;
    return { ...shared, verified: e.verified && Boolean(verifiedBy), verified_by: verifiedBy };
  });
  if (entryPayload.length) {
    const up = await client.from("carrier_field_map_entry").upsert(entryPayload, { onConflict: "step_id,field_key" });
    if (up.error) fail(up.error, "Could not save the map's fields");
  }
  const keep = new Set(entryPayload.map((e) => `${e.step_id}|${e.field_key}`));
  const drop = oldEntries.filter((e) => !keep.has(`${e.step_id}|${e.field_key}`)).map((e) => e.id);
  if (drop.length) {
    const del = await client.from("carrier_field_map_entry").delete().in("id", drop);
    if (del.error) fail(del.error, "Could not remove a field from the map");
  }
  const dropSteps = rows<StepRow>(stepsNow.data).filter((s) => !pageKeys.includes(s.page_key)).map((s) => s.id);
  if (dropSteps.length) {
    const del = await client.from("carrier_field_map_step").delete().in("id", dropSteps);
    if (del.error) fail(del.error, "Could not remove a page from the map");
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status) patch.status = input.status;
  if (input.origin) {
    const origin = httpsOrigin(input.origin);
    if (!origin) throw new ApplicationError("ORIGIN_INVALID", "Enter the carrier portal address, starting https://.");
    patch.origin = origin;
  }
  const upd = await client.from("carrier_field_map").update(patch).eq("id", map.id);
  if (upd.error) fail(upd.error, "Could not save the map");
  await auditMap(scope, "field_map.updated", map.id, { version: map.version, entries: entryPayload.length, verified: entryPayload.filter((e) => e.verified).length, removed: drop.length });
  return getMap(scope, map.id);
}

export async function publishMap(scope: MapScope, id: string) {
  const map = await mapRow(scope, id, { write: true });
  if (!EDITABLE_FIELD_MAP_STATUSES.includes(map.status)) throw new ApplicationError("CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE", `Map v${map.version} is already ${map.status.replace("_", " ")}.`, 409);
  const { entries } = await stepsAndEntries([map.id]);
  if (!entries.length) throw new ApplicationError("FIELD_MAP_EMPTY", "Add at least one field before publishing.", 409);

  const client = db();
  const now = new Date().toISOString();
  // Staff approve into approved_by_admin (20260926102510); an agency owner into approved_by.
  const approval = scope.plane === "admin" ? { approved_by_admin: scope.adminId } : { approved_by: scope.userId };
  const onPlane = <Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(q: Q) => (scope.plane === "tenant" ? q.eq("tenant_id", scope.tenantId) : q.is("tenant_id", null));
  // The publish guard trigger is the check; its message ("Verify insured.ssn before publishing.") is surfaced.
  const upd = await onPlane(client.from("carrier_field_map").update({ status: "published", ...approval, approved_at: now }).eq("id", map.id));
  if (upd.error && scope.plane === "admin" && isMissingSchema(upd.error)) adminCannotApprove();
  if (upd.error) fail(upd.error, "Could not publish the map");

  // The version it replaces stops being used for fills.
  let older = onPlane(client.from("carrier_field_map").update({ status: "retired" }).eq("carrier_id", map.carrier_id).in("status", [...FILLABLE_FIELD_MAP_STATUSES]).lt("version", map.version));
  older = map.carrier_product_id ? older.eq("carrier_product_id", map.carrier_product_id) : older.is("carrier_product_id", null);
  const retired = await older.select("id");
  if (retired.error) fail(retired.error, "Could not retire the previous version");
  await auditMap(scope, "field_map.published", map.id, { version: map.version, retired: rows<{ id: string }>(retired.data).map((r) => r.id), entries: entries.length });
  return getMap(scope, map.id);
}

/**
 * Version N + 1 as a draft, copied from a published (or retired, or flagged) map. Selectors carry
 * over; every sensitive entry must be verified again. From a platform map, the copy is the agency's.
 */
export async function newVersion(scope: MapScope, id: string) {
  const source = await mapRow(scope, id);
  if (EDITABLE_FIELD_MAP_STATUSES.includes(source.status)) throw new ApplicationError("FIELD_MAP_STILL_DRAFT", "This version is still a draft — edit it directly.", 409);
  const tenantId = scopeTenant(scope);
  const version = await nextVersion(tenantId, source.carrier_id, source.carrier_product_id);
  const client = db();
  const inserted = await client.from("carrier_field_map").insert({
    tenant_id: tenantId, carrier_id: source.carrier_id, carrier_product_id: source.carrier_product_id, version, status: "draft", origin: source.origin,
    created_by: scope.plane === "tenant" ? scope.userId : null, proposal_source: "manual",
  }).select("id").single();
  if (inserted.error) fail(inserted.error, "Could not start a new version");
  const newId = inserted.data.id as string;

  const { steps, entries } = await stepsAndEntries([source.id]);
  if (steps.length) {
    const stepsIn = await client.from("carrier_field_map_step").insert(steps.map((s) => ({ map_id: newId, page_key: s.page_key, url_pattern: s.url_pattern, sort_order: s.sort_order }))).select("id, page_key");
    if (stepsIn.error) fail(stepsIn.error, "Could not copy the map's pages");
    const idByKey = new Map(rows<{ id: string; page_key: string }>(stepsIn.data).map((s) => [s.page_key, s.id]));
    const keyByOld = new Map(steps.map((s) => [s.id, s.page_key]));
    // Staff verifications of a platform map carry into its next platform version (never into an agency's copy).
    const staff = scope.plane === "admin" ? await staffVerifiers(entries.map((e) => e.id), { required: false }) : null;
    const copied = entries.map((e) => {
      // Sensitive entries are re-verified on every version; others keep a verification by a person
      // of this plane (a platform verification does not carry into an agency's copy).
      const base = {
        step_id: idByKey.get(keyByOld.get(e.step_id)!)!, field_key: e.field_key, selector: e.selector, selector_fallback: e.selector_fallback, input_kind: e.input_kind,
        value_transform: e.value_transform, option_map: e.option_map, confidence: e.confidence,
      };
      if (scope.plane === "admin") {
        const by = !isSensitiveKey(e.field_key) && e.verified && source.tenant_id === null ? staff?.get(e.id) ?? null : null;
        return { ...base, verified: Boolean(by), verified_by: null, ...(staff ? { verified_by_admin: by } : {}) };
      }
      const keepVerified = !isSensitiveKey(e.field_key) && e.verified && Boolean(e.verified_by) && source.tenant_id === tenantId;
      return { ...base, verified: keepVerified, verified_by: keepVerified ? e.verified_by : null };
    });
    if (copied.length) {
      const entriesIn = await client.from("carrier_field_map_entry").insert(copied);
      if (entriesIn.error) fail(entriesIn.error, "Could not copy the map's fields");
    }
  }
  await auditMap(scope, "field_map.created", newId, { fromMapId: source.id, fromVersion: source.version, version, copiedFromPlatform: source.tenant_id === null && tenantId !== null });
  return getMap(scope, newId);
}

// ── fill time (bearer) ─────────────────────────────────────────────────────

/**
 * The approved map a fill uses for this application: the agency's own before the platform's, the
 * product's before the carrier-wide one, the highest version first. A map pinned to another origin
 * is not a candidate.
 */
export async function fillableMapFor(tenantId: string, carrierId: string, productId: string | null, origin: string): Promise<MapInput | null> {
  const { data, error } = await db().from("carrier_field_map").select(MAP_COLUMNS).eq("carrier_id", carrierId).in("status", [...FILLABLE_FIELD_MAP_STATUSES]).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  if (error && isMissingSchema(error)) return null;
  if (error) fail(error, "Carrier field maps");
  const candidates = rows<MapRow>(data)
    .filter((m) => !m.carrier_product_id || m.carrier_product_id === productId)
    .filter((m) => !m.origin || m.origin === origin)
    .sort((a, b) => Number(b.tenant_id === tenantId) - Number(a.tenant_id === tenantId)
      || Number(Boolean(b.carrier_product_id)) - Number(Boolean(a.carrier_product_id))
      || b.version - a.version);
  const map = candidates[0];
  if (!map) return null;
  const { steps, entries } = await stepsAndEntries([map.id]);
  return {
    id: map.id, version: map.version, status: map.status,
    steps: steps.map((s) => ({ id: s.id, page_key: s.page_key, url_pattern: s.url_pattern, sort_order: s.sort_order })),
    entries: entries.map((e) => ({ id: e.id, step_id: e.step_id, field_key: e.field_key, selector: e.selector, selector_fallback: e.selector_fallback, input_kind: e.input_kind, value_transform: e.value_transform, option_map: e.option_map })),
  };
}

/** Origin + path of a carrier page, when it is on the grant's origin. Queries can carry PII. */
function safeUrl(url: string | undefined, origin: string) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin === origin ? `${u.origin}${u.pathname}`.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/**
 * A fill found fields the map says are there missing. Each one is a `map_miss` event, the fill rate
 * is a `fill_rate` event, and a published map with a miss is flagged `needs_review` (the trigger
 * allows exactly that move on a frozen map).
 */
export async function recordMapMiss(ctx: ExtensionContext, input: { mapId: string; pageKey?: string; url?: string; misses: { field_key: string; reason: string }[]; filled?: number; total?: number }) {
  if (!ctx.application.carrier_id) throw new ApplicationError("FIELD_MAP_NOT_FOUND", "That field map is not the one for this application.", 409);
  const map = await fillableMapFor(ctx.tenantId, ctx.application.carrier_id, ctx.application.carrier_product_id, ctx.origin);
  if (!map || map.id !== input.mapId) throw new ApplicationError("FIELD_MAP_NOT_FOUND", "That field map is not the one for this application.", 409);
  const stepId = input.pageKey ? map.steps.find((s) => s.page_key === input.pageKey)?.id ?? null : null;
  const url = safeUrl(input.url, ctx.origin);
  const known = new Set(map.entries.map((e) => e.field_key));
  const misses = input.misses.filter((m) => known.has(m.field_key));
  const events: Record<string, unknown>[] = misses.map((m) => ({
    tenant_id: ctx.tenantId, map_id: map.id, step_id: stepId, application_id: ctx.application.id, kind: "map_miss", field_key: m.field_key,
    detail: { reason: m.reason, ...(url ? { url } : {}), grant_id: ctx.grant.id },
  }));
  if (typeof input.filled === "number" && typeof input.total === "number" && input.filled <= input.total) {
    events.push({ tenant_id: ctx.tenantId, map_id: map.id, step_id: stepId, application_id: ctx.application.id, kind: "fill_rate", fields_filled: input.filled, fields_total: input.total, detail: { ...(url ? { url } : {}), grant_id: ctx.grant.id } });
  }
  if (events.length) {
    const ins = await db().from("carrier_field_map_events").insert(events);
    if (ins.error) fail(ins.error, "Could not record the missed fields");
  }
  let flagged = false;
  if (misses.length && map.status === "published") {
    const upd = await db().from("carrier_field_map").update({ status: "needs_review" }).eq("id", map.id).eq("status", "published");
    if (upd.error) fail(upd.error, "Could not flag the map for review");
    flagged = true;
  }
  return { recorded: misses.length, flagged };
}
