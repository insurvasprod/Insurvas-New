import "server-only";

import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";
import { RULE_TYPES } from "@/lib/ingestion/carrierRules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { CARRIER_COLUMNS } from "./adminService";
import type { CarrierRow } from "./constants";
import type { SetupInputs } from "./setup";

/**
 * Catalog › Carriers and the carrier record (admin round 1, docs/design/admin-r1/catalog.html screens 7–8): the
 * reads behind each carrier's set-up dots and its record page. Every read is the platform's own data (tenant_id is
 * null, or the platform carrier row) or a count; nothing here returns an agency's rows. Each facet degrades on its
 * own: a failed read is null, which the page shows as unknown — never as missing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- several of these tables are not in the generated types
const db = () => getSupabaseServiceClient() as any;
type Loose = Record<string, unknown>;
type Read = { data: Loose[] | null; error: { message: string; code?: string } | null };

const rowsOf = (read: Read | null): Loose[] | null => (read && !read.error ? read.data ?? [] : null);
const str = (value: unknown) => (typeof value === "string" ? value : null);

export type CarrierFacts = { portalOrigin: string | null; referencePattern: string | null; billingDescriptor: string | null };
export type CarrierRecord = CarrierRow & CarrierFacts;

/** The platform carrier by its code, with its three portal facts; null when there is none. */
export async function getPlatformCarrierByCode(code: string): Promise<CarrierRecord | null> {
  const { data, error } = await db().from("carriers").select(`${CARRIER_COLUMNS}, portal_origin, reference_pattern, billing_descriptor`).eq("code", code).is("organization_id", null).limit(1);
  if (error) throw new Error("Could not load the carrier");
  const row = ((data ?? []) as Loose[])[0];
  if (!row) return null;
  return { ...(row as unknown as CarrierRow), portalOrigin: str(row.portal_origin), referencePattern: str(row.reference_pattern), billingDescriptor: str(row.billing_descriptor) };
}

/** Everything the set-up dots need, for every platform carrier at once. */
export async function readSetupInputs(adminId: string): Promise<SetupInputs> {
  const safe = <T,>(promise: PromiseLike<T>) => Promise.resolve(promise).catch(() => null);
  const [facts, rules, assignments, layoutMaps, queue, mapped, fields, guide, servicing, reports] = await Promise.all([
    safe(db().from("carriers").select("id, portal_origin, reference_pattern, billing_descriptor").is("organization_id", null)) as Promise<Read | null>,
    safe(loadCarrierRules({ plane: "platform", adminId })),
    safe(db().from("carrier_layout_assignment").select("carrier_id, file_type, layout_key").is("tenant_id", null)) as Promise<Read | null>,
    safe(db().from("carrier_layout_map").select("layout_key, version, status").is("tenant_id", null)) as Promise<Read | null>,
    safe(db().from("unmapped_status_queue").select("carrier_id, file_type, carrier_status_raw, row_count").is("resolved_at", null).limit(5000)) as Promise<Read | null>,
    safe(db().from("carrier_status_map").select("carrier_id").not("approved_at", "is", null).limit(5000)) as Promise<Read | null>,
    safe(db().from("carrier_field_map").select("carrier_id, status").is("tenant_id", null).limit(2000)) as Promise<Read | null>,
    safe(db().from("carrier_portal_guidance").select("carrier_id")) as Promise<Read | null>,
    safe(db().from("carrier_servicing_guide").select("carrier_id, request_type")) as Promise<Read | null>,
    safe(db().from("carrier_fact_reports").select("carrier_id").eq("status", "open").limit(2000)) as Promise<Read | null>,
  ]);

  const out: SetupInputs = { facts: null, rules: null, layouts: null, status: null, fields: null, guide: null, servicing: null, reports: null };

  const factRows = rowsOf(facts);
  if (factRows) out.facts = new Map(factRows.map((r) => [String(r.id), { portalOrigin: str(r.portal_origin), referencePattern: str(r.reference_pattern), billingDescriptor: str(r.billing_descriptor) }]));

  if (rules && rules.available) {
    out.rules = new Map(rules.carriers.map((row) => {
      const set = RULE_TYPES.filter((type) => row.rules[type] && row.rules[type]!.windowDays !== null).length;
      const unverified = RULE_TYPES.filter((type) => row.rules[type] && row.rules[type]!.windowDays !== null && !row.rules[type]!.verified).length;
      return [row.carrierId, { set, unverified }];
    }));
  }

  const assignmentRows = rowsOf(assignments);
  const mapRows = rowsOf(layoutMaps);
  if (assignmentRows && mapRows) {
    const live = new Map<string, number>();
    for (const m of mapRows) if (m.status === "published") live.set(String(m.layout_key), Math.max(live.get(String(m.layout_key)) ?? 0, Number(m.version)));
    const layouts = new Map<string, { assigned: { fileType: string; layoutKey: string; liveVersion: number | null }[] }>();
    for (const a of assignmentRows) {
      const entry = layouts.get(String(a.carrier_id)) ?? { assigned: [] };
      entry.assigned.push({ fileType: String(a.file_type), layoutKey: String(a.layout_key), liveVersion: live.get(String(a.layout_key)) ?? null });
      layouts.set(String(a.carrier_id), entry);
    }
    out.layouts = layouts;
  }

  const queueRows = rowsOf(queue);
  const mappedRows = rowsOf(mapped);
  if (queueRows && mappedRows) {
    const status = new Map<string, { approved: number; waiting: number; rowsHeld: number }>();
    const bump = (id: string) => status.get(id) ?? { approved: 0, waiting: 0, rowsHeld: 0 };
    // One waiting word per carrier, file type and word, however many agencies hold rows of it.
    const words = new Set<string>();
    for (const q of queueRows) {
      const id = String(q.carrier_id);
      const entry = bump(id);
      const key = `${id}\u0000${q.file_type}\u0000${q.carrier_status_raw}`;
      if (!words.has(key)) { words.add(key); entry.waiting += 1; }
      entry.rowsHeld += Number(q.row_count ?? 0);
      status.set(id, entry);
    }
    for (const m of mappedRows) { const id = String(m.carrier_id); const entry = bump(id); entry.approved += 1; status.set(id, entry); }
    out.status = status;
  }

  const fieldRows = rowsOf(fields);
  if (fieldRows) {
    const byCarrier = new Map<string, { published: number; open: number }>();
    for (const f of fieldRows) {
      const id = String(f.carrier_id);
      const entry = byCarrier.get(id) ?? { published: 0, open: 0 };
      if (f.status === "published") entry.published += 1;
      else if (f.status === "draft" || f.status === "in_review" || f.status === "needs_review") entry.open += 1;
      byCarrier.set(id, entry);
    }
    out.fields = byCarrier;
  }

  const guideRows = rowsOf(guide);
  if (guideRows) out.guide = new Set(guideRows.map((r) => String(r.carrier_id)));

  const servicingRows = rowsOf(servicing);
  if (servicingRows) {
    const types = new Map<string, Set<string>>();
    for (const s of servicingRows) { const id = String(s.carrier_id); const set = types.get(id) ?? new Set<string>(); set.add(String(s.request_type)); types.set(id, set); }
    out.servicing = new Map([...types].map(([id, set]) => [id, set.size]));
  }

  const reportRows = rowsOf(reports);
  if (reportRows) {
    const open = new Map<string, number>();
    for (const r of reportRows) open.set(String(r.carrier_id), (open.get(String(r.carrier_id)) ?? 0) + 1);
    out.reports = open;
  }
  return out;
}

/* ── the record's own tabs ──────────────────────────────────────────────────────────────────── */

export type RecordLayout = { fileType: string; layoutKey: string; layoutName: string | null; liveVersion: number | null; openVersion: number | null };
export type RecordStatusWord = { fileType: string; raw: string; rows: number; agencies: number; firstSeenAt: string | null };
export type RecordFieldMap = { id: string; productLabel: string; version: number; status: string; updatedAt: string | null };

/** The carrier's file layouts, waiting status words, mapped words and field maps; each null when its read failed. */
export async function readCarrierFacets(carrierId: string): Promise<{
  layouts: RecordLayout[] | null;
  waitingWords: RecordStatusWord[] | null;
  mappedWords: number | null;
  fieldMaps: RecordFieldMap[] | null;
}> {
  const safe = <T,>(promise: PromiseLike<T>) => Promise.resolve(promise).catch(() => null);
  const [assignments, queue, mapped, maps] = await Promise.all([
    safe(db().from("carrier_layout_assignment").select("file_type, layout_key").is("tenant_id", null).eq("carrier_id", carrierId)) as Promise<Read | null>,
    safe(db().from("unmapped_status_queue").select("file_type, carrier_status_raw, row_count, tenant_id, first_seen_at").eq("carrier_id", carrierId).is("resolved_at", null).limit(2000)) as Promise<Read | null>,
    safe(db().from("carrier_status_map").select("id", { count: "exact", head: true }).eq("carrier_id", carrierId).not("approved_at", "is", null)) as Promise<(Read & { count: number | null }) | null>,
    safe(db().from("carrier_field_map").select("id, carrier_product_id, version, status, updated_at").is("tenant_id", null).eq("carrier_id", carrierId).order("updated_at", { ascending: false }).limit(200)) as Promise<Read | null>,
  ]);

  let layouts: RecordLayout[] | null = null;
  const assignmentRows = rowsOf(assignments);
  if (assignmentRows) {
    const keys = [...new Set(assignmentRows.map((a) => String(a.layout_key)))];
    const versions = keys.length ? ((await safe(db().from("carrier_layout_map").select("layout_key, name, version, status").is("tenant_id", null).in("layout_key", keys))) as Read | null) : { data: [], error: null };
    const versionRows = rowsOf(versions);
    if (versionRows) {
      layouts = assignmentRows.map((a) => {
        const mine = versionRows.filter((v) => v.layout_key === a.layout_key);
        const live = mine.filter((v) => v.status === "published").map((v) => Number(v.version));
        const open = mine.filter((v) => v.status === "draft" || v.status === "in_review").map((v) => Number(v.version));
        const latest = [...mine].sort((x, y) => Number(y.version) - Number(x.version))[0];
        return { fileType: String(a.file_type), layoutKey: String(a.layout_key), layoutName: str(latest?.name), liveVersion: live.length ? Math.max(...live) : null, openVersion: open.length ? Math.max(...open) : null };
      });
    }
  }

  let waitingWords: RecordStatusWord[] | null = null;
  const queueRows = rowsOf(queue);
  if (queueRows) {
    const grouped = new Map<string, RecordStatusWord & { tenants: Set<string> }>();
    for (const q of queueRows) {
      const key = `${q.file_type}\u0000${q.carrier_status_raw}`;
      const entry = grouped.get(key) ?? { fileType: String(q.file_type), raw: String(q.carrier_status_raw ?? ""), rows: 0, agencies: 0, firstSeenAt: str(q.first_seen_at), tenants: new Set<string>() };
      entry.rows += Number(q.row_count ?? 0);
      if (q.tenant_id) entry.tenants.add(String(q.tenant_id));
      if (q.first_seen_at && (!entry.firstSeenAt || String(q.first_seen_at) < entry.firstSeenAt)) entry.firstSeenAt = String(q.first_seen_at);
      grouped.set(key, entry);
    }
    waitingWords = [...grouped.values()].map(({ tenants, ...word }) => ({ ...word, agencies: tenants.size })).sort((a, b) => b.rows - a.rows);
  }

  let fieldMaps: RecordFieldMap[] | null = null;
  const mapRows = rowsOf(maps);
  if (mapRows) {
    const productIds = [...new Set(mapRows.map((m) => str(m.carrier_product_id)).filter((id): id is string => Boolean(id)))];
    const products = productIds.length ? ((await safe(db().from("carrier_products").select("id, name").in("id", productIds))) as Read | null) : { data: [], error: null };
    const names = new Map((rowsOf(products) ?? []).map((p) => [String(p.id), String(p.name)]));
    fieldMaps = mapRows.map((m) => ({ id: String(m.id), productLabel: (m.carrier_product_id ? names.get(String(m.carrier_product_id)) : undefined) || "All products", version: Number(m.version), status: String(m.status), updatedAt: str(m.updated_at) }));
  }

  return { layouts, waitingWords, mappedWords: mapped && !mapped.error ? mapped.count ?? 0 : null, fieldMaps };
}

/** Policies on the books with this carrier, across every agency (a count, no rows). Null when it could not be read. */
export async function countCarrierPolicies(carrierId: string): Promise<number | null> {
  const read = await Promise.resolve(db().from("policy_current").select("carrier_id", { count: "exact", head: true }).eq("carrier_id", carrierId)).catch(() => null);
  return read && !read.error ? read.count ?? 0 : null;
}

export type HistoryEntry = { id: string; at: string; action: string; label: string; actor: string; reason: string | null; detail: string | null };

/**
 * The carrier's history from the audit log, every facet together: rows written against the carrier itself (edits,
 * deactivation, guidance, servicing, settings) and against its rules and fact reports. Newest first, the last 100.
 */
export async function readCarrierHistory(carrierId: string): Promise<HistoryEntry[] | null> {
  const [rules, reports] = await Promise.all([
    Promise.resolve(db().from("carrier_retention_rule").select("id").is("tenant_id", null).eq("carrier_id", carrierId).order("created_at", { ascending: false }).limit(100)).catch(() => null) as Promise<Read | null>,
    Promise.resolve(db().from("carrier_fact_reports").select("id").eq("carrier_id", carrierId).order("created_at", { ascending: false }).limit(100)).catch(() => null) as Promise<Read | null>,
  ]);
  const related = [...(rowsOf(rules) ?? []), ...(rowsOf(reports) ?? [])].map((row) => String(row.id));
  const ids = [...new Set([carrierId, ...related])].slice(0, 160);
  const read = (await Promise.resolve(db().from("audit_log").select("id, ts, actor_type, actor_id, action, target_type, reason, metadata").in("target_id", ids).order("ts", { ascending: false }).limit(100)).catch(() => null)) as Read | null;
  const rows = rowsOf(read);
  if (!rows) return null;
  const adminIds = [...new Set(rows.filter((r) => r.actor_type === "admin" && r.actor_id).map((r) => String(r.actor_id)))];
  const admins = adminIds.length ? ((await Promise.resolve(db().from("admin_users").select("id, name, email").in("id", adminIds)).catch(() => null)) as Read | null) : null;
  const names = new Map((rowsOf(admins) ?? []).map((a) => [String(a.id), String(a.name || a.email || "Staff")]));
  return rows.map((r) => {
    const action = String(r.action);
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      at: String(r.ts),
      action,
      label: AUDIT_ACTION_LABELS[action as AuditAction] ?? action,
      actor: r.actor_type === "admin" ? names.get(String(r.actor_id)) ?? "Staff" : r.actor_type === "tenant" ? "An agency" : "Insurvas",
      reason: str(r.reason),
      detail: historyDetail(metadata),
    };
  });
}

const FACT_WORD: Record<string, string> = { portal_origin: "Portal address", reference_pattern: "Policy number pattern", billing_descriptor: "Bank descriptor", name: "Name", sort_order: "Sort order" };

/** The before → after of an edit, when the row carries one, in words. */
function historyDetail(metadata: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (FACT_WORD[key] && value && typeof value === "object" && "after" in (value as Record<string, unknown>)) {
      const change = value as { before?: unknown; after?: unknown };
      parts.push(`${FACT_WORD[key]}: ${change.before ? String(change.before) : "not set"} → ${change.after ? String(change.after) : "not set"}`);
    }
  }
  const changes = metadata.changes as Record<string, unknown> | undefined;
  if (changes && typeof changes === "object") for (const [key, value] of Object.entries(changes)) parts.push(`${FACT_WORD[key] ?? key}: ${String(value)}`);
  if (typeof metadata.ruleType === "string") parts.push(String(metadata.ruleType).replace(/_/g, " "));
  if (typeof metadata.requestType === "string") parts.push(String(metadata.requestType).replace(/_/g, " "));
  return parts.length ? parts.join(" · ") : null;
}
