import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { TemplateField } from "@/lib/templates/constants";
import { getAgentTemplate, latestLeadOwners, readByLeadIds, visibleLeadIds } from "@/lib/agentTemplates/service";
import { keepVisible, type ProducerScope } from "@/lib/agency/visibility";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { csvContactLine, csvHeaderLine } from "./csv";
import { planForMatches } from "./matchPolicy";
import { addressHash, addressSearch, nameSearch, normalizeContactInput, normalizeText } from "./normalization";
import type { ContactDirectory, ContactInput, ContactRow, DirectoryRow, DuplicateMatch, DuplicateStats, FieldSchemaRow, ContactWorkspace, RecentMerge, ReviewQueue } from "./types";

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

type DbError = { code?: string; message?: string } | null | undefined;
// The objects added by 20260924326000/326100 are not in the shared generated types; typed locally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = () => getSupabaseServiceClient() as any;

const MISSING_SCHEMA = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);
/** The column, table or function this code needs has not been created yet (migration not applied). */
export function isMissingSchema(error: DbError) {
  return Boolean(error && (MISSING_SCHEMA.has(error.code ?? "") || /schema cache/i.test(error.message ?? "")));
}

/** A write that needs a migration that has not been applied. Routes answer 503 with this text. */
export class SchemaNotReadyError extends Error {
  constructor() { super("This setting needs a database update that has not been applied yet."); }
}
/** Someone else already answered this, or the rule refuses it. Routes answer 409 with the message. */
export class ContactConflictError extends Error {}

const CONTACT_COLUMNS = "id, tenant_id, household_id, first_name, last_name, dob, primary_phone, state, custom_fields, merged_into_id, created_at, updated_at";
type ContactBase = Omit<ContactRow, "phones" | "emails" | "address_line1" | "city" | "postal_code">;

export async function fieldSchemaForTenant(tenantId: string, userId?: string): Promise<FieldSchemaRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("field_schema").select("id, tenant_id, entity, field_key, label, type, options, is_required, sort_order, created_at, updated_at").eq("tenant_id", tenantId).order("sort_order").order("field_key");
  if (error) throw new Error(`Could not load contact field schema: ${error.message}`);
  const rows = (data ?? []) as unknown as FieldSchemaRow[];
  if (rows.some((row) => row.entity === "contact") || !userId) return rows;

  // SA-4.7 is the source of the initial lead-field vocabulary. We expose it as the initial
  // contact vocabulary until the agent saves a customized field schema of their own.
  let template;
  try { template = await getAgentTemplate(tenantId, userId); } catch { return rows; }
  const createdAt = new Date(0).toISOString();
  const templateFields = template.template.fields.map((field: TemplateField, index) => ({ id: `template:${template.tenant_template_id}:${field.field_key}`, tenant_id: tenantId, entity: "contact" as const, field_key: field.field_key, label: field.label, type: field.type, options: field.options, is_required: field.is_required, sort_order: index, created_at: createdAt, updated_at: createdAt }));
  return [...templateFields, ...rows.filter((row) => row.entity !== "contact")];
}

async function validateCustomFields(tenantId: string, fields: Record<string, unknown>, userId?: string, preloaded?: FieldSchemaRow[]) {
  const schema = preloaded ?? await fieldSchemaForTenant(tenantId, userId);
  const allowed = new Map(schema.filter((row) => row.entity === "contact").map((row) => [row.field_key, row]));
  for (const [key, value] of Object.entries(fields)) {
    const definition = allowed.get(key);
    if (!definition) throw new Error(`Custom field ${key} is not defined`);
    if (definition.type === "number" || definition.type === "currency") {
      if (typeof value !== "number" || !Number.isFinite(value) || (definition.type === "currency" && !Number.isInteger(value))) throw new Error(`${definition.label} must be a valid number`);
    } else if (definition.type === "boolean" && typeof value !== "boolean") throw new Error(`${definition.label} must be true or false`);
    else if (definition.type === "multi_select" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !definition.options.includes(item)))) throw new Error(`${definition.label} contains an invalid option`);
    else if (definition.type === "single_select" && (typeof value !== "string" || !definition.options.includes(value))) throw new Error(`${definition.label} must use one of the listed options`);
    else if (definition.type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error(`${definition.label} must use YYYY-MM-DD`);
    else if (definition.type === "phone" && (typeof value !== "string" || !/^[0-9 ()+.-]{7,40}$/.test(value))) throw new Error(`${definition.label} must be a valid phone number`);
    else if (typeof value !== "string") throw new Error(`${definition.label} has an invalid value`);
  }
  for (const definition of allowed.values()) if (definition.is_required && (fields[definition.field_key] === undefined || fields[definition.field_key] === "")) throw new Error(`${definition.label} is required`);
}

function normalizedPayload(input: ContactInput) {
  const value = normalizeContactInput(input);
  return { value, p_dob: value.dob || null, p_phone: value.primary_phone || null, p_name_search: nameSearch(value), p_address_hash: addressHash(value), p_address_search: addressSearch(value) || null };
}

export async function findDuplicates(tenantId: string, input: ContactInput): Promise<DuplicateMatch[]> {
  const { p_dob, p_phone, p_name_search, p_address_hash, p_address_search } = normalizedPayload(input);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("find_contact_duplicates", { p_tenant_id: tenantId, p_name_search, p_dob, p_phone, p_address_search, p_address_hash, p_limit: 20 });
  if (error) throw new Error(`Could not find duplicates: ${error.message}`);
  const scored = ((data ?? []) as unknown as Array<DuplicateMatch & { custom_fields: Json }>).map((row) => ({ ...row, score: Number(row.score), confidence: row.confidence as DuplicateMatch["confidence"], custom_fields: asObject(row.custom_fields), matched_on: Array.isArray(row.matched_on) ? row.matched_on : [] }));
  // Until 20260924326100 is applied, the live function can return a contact that was merged away
  // (its alternate-phone rows survive the merge). Such a match can only fail to merge, so it is
  // dropped here as well as in SQL.
  let matches = scored;
  if (scored.length) {
    const { data: active, error: activeError } = await supabase.from("contacts").select("id").eq("tenant_id", tenantId).is("merged_into_id", null).in("id", scored.map((row) => row.contact_id));
    if (activeError) throw new Error(`Could not check duplicate candidates: ${activeError.message}`);
    const activeIds = new Set((active ?? []).map((row) => row.id));
    matches = scored.filter((row) => activeIds.has(row.contact_id));
  }
  // Compatibility bridge for the shared project while the latest secondary-phone SQL migration
  // is awaiting DDL authority. The older live function can score an alternate phone as a match
  // but omit the evidence label; hydrate that label from the tenant-scoped phone table.
  if (p_phone && matches.length) {
    const { data: phoneMatches, error: phoneError } = await supabase
      .from("contact_phones")
      .select("contact_id")
      .eq("tenant_id", tenantId)
      .eq("phone", p_phone)
      .in("contact_id", matches.map((row) => row.contact_id));
    if (phoneError) throw new Error(`Could not verify alternate phone matches: ${phoneError.message}`);
    const phoneIds = new Set((phoneMatches ?? []).map((row) => row.contact_id));
    return matches.map((row) => phoneIds.has(row.contact_id) && !row.matched_on.includes("phone") ? { ...row, matched_on: [...row.matched_on, "phone"] } : row);
  }
  return matches;
}

/** Households, phones and emails for up to ~200 contacts, in the order given. */
async function hydrate(tenantId: string, contacts: ContactBase[]): Promise<Array<ContactRow & { household_state: string | null }>> {
  if (!contacts.length) return [];
  const supabase = getSupabaseServiceClient();
  const ids = contacts.map((row) => row.id);
  const householdIds = [...new Set(contacts.map((row) => row.household_id).filter(Boolean))] as string[];
  // LA-4.9: which of these were built from a carrier file and not yet confirmed (none before 20261008180000).
  const provisionalRead = await (supabase as unknown as { from: (t: string) => any }).from("contacts").select("id").eq("tenant_id", tenantId).eq("provisional", true).in("id", ids); // eslint-disable-line @typescript-eslint/no-explicit-any
  const provisional = new Set<string>(provisionalRead.error ? [] : ((provisionalRead.data ?? []) as Array<{ id: string }>).map((row) => row.id));
  const [households, phones, emails] = await Promise.all([
    householdIds.length ? supabase.from("households").select("id, address_line1, city, state, postal_code").eq("tenant_id", tenantId).in("id", householdIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("contact_phones").select("contact_id, phone, type, is_primary").eq("tenant_id", tenantId).in("contact_id", ids).order("is_primary", { ascending: false }),
    supabase.from("contact_emails").select("contact_id, email, is_primary").eq("tenant_id", tenantId).in("contact_id", ids).order("is_primary", { ascending: false }),
  ]);
  const errorMessage = [households.error, phones.error, emails.error].find(Boolean)?.message;
  if (errorMessage) throw new Error(`Could not load contact details: ${errorMessage}`);
  const householdMap = new Map(((households.data ?? []) as Array<{ id: string; address_line1: string | null; city: string | null; state: string | null; postal_code: string | null }>).map((row) => [row.id, row]));
  const phoneMap = new Map<string, ContactRow["phones"]>();
  for (const row of phones.data ?? []) phoneMap.set(row.contact_id, [...(phoneMap.get(row.contact_id) ?? []), { phone: row.phone, type: row.type as ContactRow["phones"][number]["type"], is_primary: row.is_primary }]);
  const emailMap = new Map<string, ContactRow["emails"]>();
  for (const row of emails.data ?? []) emailMap.set(row.contact_id, [...(emailMap.get(row.contact_id) ?? []), { email: row.email, is_primary: row.is_primary }]);
  return contacts.map((row) => {
    const household = householdMap.get(row.household_id ?? "");
    return { ...row, provisional: provisional.has(row.id), custom_fields: asObject(row.custom_fields), phones: phoneMap.get(row.id) ?? [], emails: emailMap.get(row.id) ?? [], address_line1: household?.address_line1 || null, city: household?.city || null, postal_code: household?.postal_code || null, household_state: household?.state || null };
  });
}

async function loadContact(tenantId: string, id: string): Promise<ContactRow> {
  const { data: contact, error } = await getSupabaseServiceClient().from("contacts").select(CONTACT_COLUMNS).eq("tenant_id", tenantId).eq("id", id).single();
  if (error || !contact) throw new Error(error?.message ?? "Contact not found");
  const [row] = await hydrate(tenantId, [contact as unknown as ContactBase]);
  return row;
}

function householdLabel(row: { household_id: string | null; last_name: string; city: string | null; household_state: string | null; state: string | null }) {
  if (!row.household_id) return null;
  const place = [row.city, row.household_state || row.state].filter(Boolean).join(" ");
  return [row.last_name, place].filter(Boolean).join(", ") || null;
}

/* ── AG-0.5 · producer visibility ────────────────────────────────────────── */

/**
 * A contact has no producer column of its own: it is visible to a narrowed agency session when one of
 * its leads (agent_leads.contact_id) is — and a lead is its latest work item's owner's (decision D1). A
 * contact with no lead is unattributed and visible to the all-seeing roles only.
 *
 * The contacts a scope may see, each with how many of its VISIBLE leads point at it (the directory's
 * lead count, which must not count another producer's leads).
 */
async function visibleContactLeadCounts(tenantId: string, scope: readonly string[]): Promise<Map<string, number>> {
  const leadIds = await visibleLeadIds(tenantId, scope);
  const rows = await readByLeadIds<{ id: string; contact_id: string | null }>(leadIds, (chunk) => loose().from("agent_leads").select("id, contact_id").eq("tenant_id", tenantId).in("id", chunk).not("contact_id", "is", null), "contacts");
  const counts = new Map<string, number>();
  for (const row of rows) if (row.contact_id) counts.set(row.contact_id, (counts.get(row.contact_id) ?? 0) + 1);
  return counts;
}

/** Which of these contacts a scope may see — all of them for a null scope, with no read. */
export async function visibleAmongContacts(tenantId: string, scope: ProducerScope, contactIds: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(contactIds)];
  if (scope === null) return new Set(unique);
  if (!unique.length || !scope.length) return new Set();
  // Along agent_leads_contact_idx (tenant_id, contact_id), then each lead's latest owner.
  const leads = await readByLeadIds<{ id: string; contact_id: string }>(unique, (chunk) => loose().from("agent_leads").select("id, contact_id").eq("tenant_id", tenantId).in("contact_id", chunk), "contacts");
  const owners = leads.length ? await latestLeadOwners(tenantId, leads.map((lead) => lead.id)) : new Map<string, string | null>();
  return new Set(keepVisible(scope, leads, (lead) => owners.get(lead.id)).map((lead) => lead.contact_id));
}

/* ── directory ───────────────────────────────────────────────────────────── */

/**
 * `scope` (AG-0.5, from scopeFor(auth.context)): null — the default — pages the whole directory as before.
 * A narrowed agency session pages only the contacts it may see (visibleContactLeadCounts), with the total
 * and each lead count taken over that set, so neither a row nor a number is another producer's.
 */
export async function getContactDirectory(tenantId: string, options: { q?: string; page?: number; pageSize?: number } = {}, scope: ProducerScope = null): Promise<ContactDirectory> {
  const query = (options.q ?? "").trim().slice(0, 120);
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 25)));
  const page = Math.max(0, Math.floor(options.page ?? 0));
  const nameQuery = normalizeText(query) || null;
  const digitsOnly = query.replace(/\D/g, "");
  const digits = digitsOnly.length >= 3 ? digitsOnly : null;
  if (scope !== null) return scopedDirectory(tenantId, scope, { query, nameQuery, digits, page, pageSize });

  const rpc = await loose().rpc("contact_directory_page", {
    p_tenant_id: tenantId,
    p_query: query ? query.replace(/[\\%_]/g, (character) => `\\${character}`) : null,
    p_name_query: nameQuery,
    p_digits: digits,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (!rpc.error) {
    const rows = (rpc.data ?? []) as Array<{ contact_id: string; lead_count: number | string; open_review: boolean; total_count: number | string; household_state: string | null; created_at: string }>;
    if (!rows.length && page > 0) return getContactDirectory(tenantId, { ...options, page: 0 });
    const base = await getSupabaseServiceClient().from("contacts").select(CONTACT_COLUMNS).eq("tenant_id", tenantId).in("id", rows.map((row) => row.contact_id));
    if (base.error) throw new Error(`Could not load contacts: ${base.error.message}`);
    const byId = new Map(((base.data ?? []) as unknown as ContactBase[]).map((row) => [row.id, row]));
    const ordered = rows.map((row) => byId.get(row.contact_id)).filter(Boolean) as ContactBase[];
    const hydrated = await hydrate(tenantId, ordered);
    const extra = new Map(rows.map((row) => [row.contact_id, row]));
    return {
      rows: hydrated.map((row): DirectoryRow => ({ ...row, household_label: householdLabel(row), lead_count: Number(extra.get(row.id)?.lead_count ?? 0), open_review: Boolean(extra.get(row.id)?.open_review) })),
      total: Number(rows[0]?.total_count ?? 0),
      page,
      pageSize,
      query,
    };
  }
  if (!isMissingSchema(rpc.error)) throw new Error(`Could not load contacts: ${rpc.error.message}`);

  // Before 20260924326100: the same page from PostgREST, searching names and phones only.
  let select = getSupabaseServiceClient().from("contacts").select(CONTACT_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId).is("merged_into_id", null);
  if (query) {
    const ors = [nameQuery ? `name_search.ilike.*${nameQuery}*` : null, digits ? `primary_phone.ilike.*${digits}*` : null].filter(Boolean);
    if (!ors.length) return { rows: [], total: 0, page: 0, pageSize, query };
    select = select.or(ors.join(","));
  }
  const fallback = await select.order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
  if (fallback.error) throw new Error(`Could not load contacts: ${fallback.error.message}`);
  if (!(fallback.data ?? []).length && page > 0) return getContactDirectory(tenantId, { ...options, page: 0 });
  const hydrated = await hydrate(tenantId, (fallback.data ?? []) as unknown as ContactBase[]);
  return { rows: hydrated.map((row): DirectoryRow => ({ ...row, household_label: householdLabel(row), lead_count: null, open_review: null })), total: fallback.count ?? hydrated.length, page, pageSize, query };
}

/**
 * The directory of a narrowed session. contact_directory_page cannot be told which contacts to keep, so
 * the visible set is read (by id, in chunks), searched the way the PostgREST fallback searches — names and
 * phones — and paged here; the total is the size of the visible matching set.
 */
async function scopedDirectory(tenantId: string, scope: readonly string[], q: { query: string; nameQuery: string | null; digits: string | null; page: number; pageSize: number }): Promise<ContactDirectory> {
  const { query, nameQuery, digits, pageSize } = q;
  if (query && !nameQuery && !digits) return { rows: [], total: 0, page: 0, pageSize, query };
  const counts = await visibleContactLeadCounts(tenantId, scope);
  const contacts = await readByLeadIds<ContactBase & { name_search: string | null }>([...counts.keys()], (chunk) => loose().from("contacts").select(`${CONTACT_COLUMNS}, name_search`).eq("tenant_id", tenantId).is("merged_into_id", null).in("id", chunk), "contacts");
  const name = nameQuery?.toLowerCase() ?? null;
  const matching = contacts
    .filter((row) => !query || (name !== null && (row.name_search ?? "").toLowerCase().includes(name)) || (digits !== null && (row.primary_phone ?? "").replace(/\D/g, "").includes(digits)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const page = q.page * pageSize < matching.length ? q.page : 0;
  const slice = matching.slice(page * pageSize, page * pageSize + pageSize).map((row) => {
    const base: Partial<typeof row> = { ...row };
    delete base.name_search;
    return base as ContactBase;
  });
  const hydrated = await hydrate(tenantId, slice);
  // open_review is the duplicate-review queue's, which a narrowed session does not work (its routes refuse).
  return { rows: hydrated.map((row): DirectoryRow => ({ ...row, household_label: householdLabel(row), lead_count: counts.get(row.id) ?? 0, open_review: null })), total: matching.length, page, pageSize, query };
}

/* ── stats ───────────────────────────────────────────────────────────────── */

/** The instant the current calendar month began in `zone`. */
function monthStartIn(zone: string, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  const guess = Date.UTC(Number(parts.year), Number(parts.month) - 1, 1);
  const offset = (at: number) => {
    const local = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second)) - at;
  };
  return new Date(guess - offset(guess - offset(guess))).toISOString();
}

export async function getDuplicateStats(tenantId: string): Promise<DuplicateStats> {
  const zone = await getWorkspaceTimezone(tenantId);
  const rpc = await loose().rpc("contact_duplicate_stats", { p_tenant_id: tenantId, p_timezone: zone });
  if (!rpc.error) {
    const row = ((rpc.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
    return {
      contacts: Number(row.active_contacts ?? 0),
      households: Number(row.household_count ?? 0),
      pending: Number(row.pending_reviews ?? 0),
      oldestPendingAt: typeof row.oldest_pending_at === "string" ? row.oldest_pending_at : null,
      mergedThisMonth: Number(row.merged_this_month ?? 0),
      undoneThisMonth: Number(row.undone_this_month ?? 0),
      undoableThisMonth: Number(row.undoable_this_month ?? 0),
      timezone: typeof row.month_timezone === "string" ? row.month_timezone : zone ?? "UTC",
      flaggedContacts: Number(row.flagged_contacts ?? 0),
    };
  }
  if (!isMissingSchema(rpc.error)) throw new Error(`Could not load duplicate-check totals: ${rpc.error.message}`);

  // Before 20260924326100: the counts PostgREST can give. Households and "can be undone" need the
  // RPC and are left unknown rather than guessed.
  const timezone = zone ?? "UTC";
  const start = monthStartIn(timezone);
  const supabase = getSupabaseServiceClient();
  const [contacts, merged, undone, pending] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("merged_into_id", null),
    supabase.from("merge_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("merged_at", start),
    supabase.from("merge_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("merged_at", start).not("reversed_at", "is", null),
    loose().from("contact_duplicate_reviews").select("created_at", { count: "exact" }).eq("tenant_id", tenantId).eq("status", "pending").order("created_at").limit(1),
  ]);
  const failed = [contacts.error, merged.error, undone.error].find(Boolean);
  if (failed) throw new Error(`Could not load duplicate-check totals: ${failed.message}`);
  const pendingReady = !pending.error;
  return {
    contacts: contacts.count ?? 0,
    households: null,
    pending: pendingReady ? pending.count ?? 0 : null,
    oldestPendingAt: pendingReady ? (pending.data?.[0] as { created_at?: string } | undefined)?.created_at ?? null : null,
    mergedThisMonth: merged.count ?? 0,
    undoneThisMonth: undone.count ?? 0,
    undoableThisMonth: null,
    flaggedContacts: null,
    timezone,
  };
}

/* ── recent merges ───────────────────────────────────────────────────────── */

export async function getRecentMerges(tenantId: string, limit = 20): Promise<RecentMerge[]> {
  const supabase = getSupabaseServiceClient();
  let result = await loose().from("merge_log").select("id, kept_id, merged_id, merged_at, reversed_at, merged_by, source").eq("tenant_id", tenantId).order("merged_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (result.error && isMissingSchema(result.error)) {
    result = await supabase.from("merge_log").select("id, kept_id, merged_id, merged_at, reversed_at, merged_by").eq("tenant_id", tenantId).order("merged_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  }
  if (result.error) throw new Error(`Could not load recent merges: ${result.error.message}`);
  const rows = (result.data ?? []) as Array<{ id: string; kept_id: string; merged_id: string; merged_at: string; reversed_at: string | null; merged_by: string | null; source?: string }>;
  if (!rows.length) return [];
  const contactIds = [...new Set(rows.flatMap((row) => [row.kept_id, row.merged_id]))];
  const userIds = [...new Set(rows.map((row) => row.merged_by).filter(Boolean))] as string[];
  const [contacts, users] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", contactIds),
    userIds.length ? supabase.from("users").select("id, name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error) throw new Error(`Could not load recent merges: ${contacts.error.message}`);
  const names = new Map((contacts.data ?? []).map((row) => [row.id, `${row.first_name} ${row.last_name}`.trim()]));
  const actors = new Map(((users.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name]));
  // undo_contact_merge refuses while a later merge that is still in place touches either contact.
  // Rows are newest first, so every later merge has already been seen when a row is reached.
  const touchedLater = new Set<string>();
  return rows.map((row) => {
    const undoable = !row.reversed_at && !touchedLater.has(row.kept_id) && !touchedLater.has(row.merged_id);
    if (!row.reversed_at) { touchedLater.add(row.kept_id); touchedLater.add(row.merged_id); }
    return { id: row.id, keptId: row.kept_id, mergedId: row.merged_id, keptName: names.get(row.kept_id) ?? "Contact", mergedName: names.get(row.merged_id) ?? "Contact", mergedAt: row.merged_at, reversedAt: row.reversed_at, actorName: row.merged_by ? actors.get(row.merged_by) ?? null : null, source: row.source === "auto" ? "auto" : "manual", undoable };
  });
}

/* ── review queue ────────────────────────────────────────────────────────── */

export async function getReviewQueue(tenantId: string, index = 0): Promise<ReviewQueue> {
  const at = Math.max(0, Math.floor(index));
  const result = await loose().from("contact_duplicate_reviews").select("id, contact_id, candidate_id, score, confidence, matched_on, created_at", { count: "exact" }).eq("tenant_id", tenantId).eq("status", "pending").order("created_at").order("id").range(at, at);
  if (result.error) {
    if (isMissingSchema(result.error)) return { ready: false, total: 0, index: 0, pair: null };
    throw new Error(`Could not load the review queue: ${result.error.message}`);
  }
  const total = result.count ?? 0;
  const row = (result.data ?? [])[0] as { id: string; contact_id: string; candidate_id: string; score: number | string; confidence: "high" | "medium" | "low"; matched_on: string[] | null; created_at: string } | undefined;
  if (!row) return total > 0 && at > 0 ? getReviewQueue(tenantId, total - 1) : { ready: true, total, index: 0, pair: null };
  const base = await getSupabaseServiceClient().from("contacts").select(CONTACT_COLUMNS).eq("tenant_id", tenantId).in("id", [row.contact_id, row.candidate_id]);
  if (base.error) throw new Error(`Could not load the review pair: ${base.error.message}`);
  const [first, second] = await hydrate(tenantId, ((base.data ?? []) as unknown as ContactBase[]).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  if (!first || !second) return { ready: true, total, index: at, pair: null };
  return { ready: true, total, index: at, pair: { review: { id: row.id, score: Number(row.score), confidence: row.confidence, matched_on: row.matched_on ?? [], created_at: row.created_at }, existing: first, incoming: second } };
}

export async function dismissReview(tenantId: string, userId: string, reviewId: string) {
  const { data, error } = await loose().from("contact_duplicate_reviews").update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: userId }).eq("tenant_id", tenantId).eq("id", reviewId).eq("status", "pending").select("id, contact_id, candidate_id, score").maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new SchemaNotReadyError();
    throw new Error(`Could not dismiss this match: ${error.message}`);
  }
  if (!data) throw new ContactConflictError("Someone has already resolved this match");
  return data as { id: string; contact_id: string; candidate_id: string; score: number };
}

/* ── workspace ───────────────────────────────────────────────────────────── */

/**
 * `scope` (AG-0.5): null — the default — is the workspace as before. For a narrowed agency session the
 * directory and its counts cover the contacts it may see, and the duplicate-review half (merges, the
 * review queue and their month figures) is left out: those are agency-wide, and the routes that act on
 * them (contacts/reviews, contacts/merge) refuse a narrowed session.
 */
export async function getContactWorkspace(tenantId: string, userId: string | undefined, options: { q?: string; page?: number; pageSize?: number } = {}, scope: ProducerScope = null): Promise<ContactWorkspace & { queue: ReviewQueue }> {
  if (scope !== null) {
    const [directory, fieldSchema, timezone, visible] = await Promise.all([
      getContactDirectory(tenantId, options, scope),
      fieldSchemaForTenant(tenantId, userId),
      getWorkspaceTimezone(tenantId).catch(() => null),
      scopedContactTotals(tenantId, scope),
    ]);
    const stats: DuplicateStats = { contacts: visible.contacts, households: visible.households, pending: null, oldestPendingAt: null, mergedThisMonth: null, undoneThisMonth: null, undoableThisMonth: null, flaggedContacts: null, timezone: timezone ?? "UTC" };
    const queue: ReviewQueue = { ready: true, total: 0, index: 0, pair: null };
    return { directory, stats, merges: [], fieldSchema, reviewsReady: true, queue };
  }
  const [directory, stats, merges, fieldSchema, queue] = await Promise.all([
    getContactDirectory(tenantId, options),
    getDuplicateStats(tenantId),
    getRecentMerges(tenantId),
    fieldSchemaForTenant(tenantId, userId),
    getReviewQueue(tenantId, 0),
  ]);
  return { directory, stats, merges, fieldSchema, reviewsReady: queue.ready, queue };
}

/** Active contacts and their distinct households, over the contacts a narrowed session may see. */
async function scopedContactTotals(tenantId: string, scope: readonly string[]): Promise<{ contacts: number; households: number }> {
  const counts = await visibleContactLeadCounts(tenantId, scope);
  const rows = await readByLeadIds<{ id: string; household_id: string | null }>([...counts.keys()], (chunk) => loose().from("contacts").select("id, household_id").eq("tenant_id", tenantId).is("merged_into_id", null).in("id", chunk), "contacts");
  return { contacts: rows.length, households: new Set(rows.map((row) => row.household_id).filter(Boolean)).size };
}

/* ── export ──────────────────────────────────────────────────────────────── */

/**
 * Every active contact, streamed 200 at a time in id order, so an export is complete however large
 * the book is (the old export read the same 200-row page the directory showed).
 */
export function streamContactsCsv(tenantId: string, schemaFields: FieldSchemaRow[], scope: ProducerScope = null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const BATCH = 200;
  let cursor: string | null = null;
  let done = false;
  // AG-0.5: a narrowed agency session exports only the contacts it may see — resolved once, in id order,
  // and walked BATCH ids at a time with the same cursor. Null (the default) streams every contact as before.
  let visibleIds: string[] | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(csvHeaderLine(schemaFields))); },
    async pull(controller) {
      if (done) { controller.close(); return; }
      try {
        let select = getSupabaseServiceClient().from("contacts").select(CONTACT_COLUMNS).eq("tenant_id", tenantId).is("merged_into_id", null).order("id").limit(BATCH);
        if (scope !== null) {
          visibleIds ??= [...(await visibleContactLeadCounts(tenantId, scope)).keys()].sort();
          // The cursor walks the visible ids, not the rows returned: a batch of merged contacts returns
          // no row and must neither end the export early nor leave this pull without output.
          for (;;) {
            const after = cursor;
            const next = visibleIds.filter((id) => after === null || id > after).slice(0, BATCH);
            if (!next.length) { controller.close(); return; }
            const { data, error } = await getSupabaseServiceClient().from("contacts").select(CONTACT_COLUMNS).eq("tenant_id", tenantId).is("merged_into_id", null).in("id", next).order("id");
            if (error) throw new Error(error.message);
            const rows = (data ?? []) as unknown as ContactBase[];
            cursor = next[next.length - 1];
            if (next.length < BATCH) done = true;
            if (rows.length) { controller.enqueue(encoder.encode((await hydrate(tenantId, rows)).map((contact) => csvContactLine(schemaFields, contact)).join(""))); return; }
            if (done) { controller.close(); return; }
          }
        }
        if (cursor) select = select.gt("id", cursor);
        const { data, error } = await select;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as unknown as ContactBase[];
        if (!rows.length) { controller.close(); return; }
        const hydrated = await hydrate(tenantId, rows);
        controller.enqueue(encoder.encode(hydrated.map((contact) => csvContactLine(schemaFields, contact)).join("")));
        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH) done = true;
      } catch (error) {
        controller.error(error instanceof Error ? error : new Error("Could not export contacts"));
      }
    },
  });
}

/* ── writes ──────────────────────────────────────────────────────────────── */

export type CreateContactResult = {
  contact: ContactRow;
  duplicates: DuplicateMatch[];
  outcome: "created" | "review" | "auto_merged";
  mergeId: string | null;
  /** Pairs now waiting in the review queue because of this contact. */
  queued: number;
  /** False before 20260924326000: review pairs were not kept, only returned. */
  reviewsReady: boolean;
};

/**
 * Saves the contact, then applies lib/contacts/matchPolicy.ts: every medium-or-high match is written
 * to the review queue; only a confident best match merges on its own, and that merge resolves its
 * own review row, so undoing it puts the pair back in the queue.
 */
/**
 * `options.scope` (AG-0.5, from scopeFor(auth.context)): for a narrowed agency session the matches it is
 * shown, the count of pairs queued and the contact it may be auto-merged into are limited to contacts it
 * may see. Matches against another producer's contacts still go to the agency's review queue (the owner
 * resolves them); they are just not named to this session. Null — the default — is today's behaviour.
 */
export async function createContact(tenantId: string, userId: string, input: ContactInput, options: { schema?: FieldSchemaRow[]; scope?: ProducerScope } = {}): Promise<CreateContactResult> {
  const normalized = normalizedPayload(input); await validateCustomFields(tenantId, normalized.value.custom_fields ?? {}, userId, options.schema);
  const duplicates = await findDuplicates(tenantId, normalized.value);
  const supabase = getSupabaseServiceClient();
  const { data: id, error } = await supabase.rpc("save_contact", { p_tenant_id: tenantId, p_first_name: normalized.value.first_name, p_last_name: normalized.value.last_name, p_dob: normalized.p_dob, p_primary_phone: normalized.p_phone, p_state: normalized.value.state ?? null, p_name_search: normalized.p_name_search, p_custom_fields: (normalized.value.custom_fields ?? {}) as Json, p_address_hash: normalized.p_address_hash, p_address_search: normalized.p_address_search, p_address_line1: normalized.value.address_line1 ?? null, p_city: normalized.value.city ?? null, p_postal_code: normalized.value.postal_code ?? null, p_phones: (normalized.value.phones ?? []) as unknown as Json, p_emails: (normalized.value.emails ?? []) as unknown as Json });
  if (error || !id) throw new Error(error?.message ?? "Could not save contact");
  const contact = await loadContact(tenantId, id as string);
  const plan = planForMatches(normalized.p_dob, duplicates);

  let reviewsReady = true;
  const reviewIds = new Map<string, string>();
  if (plan.queue.length) {
    const inserted = await loose().from("contact_duplicate_reviews").insert(plan.queue.map((match) => ({ tenant_id: tenantId, contact_id: contact.id, candidate_id: match.contact_id, score: match.score, confidence: match.confidence, matched_on: match.matched_on }))).select("id, candidate_id");
    if (inserted.error) {
      reviewsReady = false;
      if (!isMissingSchema(inserted.error)) console.error("[contacts] review pairs could not be queued", inserted.error);
    } else for (const row of (inserted.data ?? []) as Array<{ id: string; candidate_id: string }>) reviewIds.set(row.candidate_id, row.id);
  }

  const scope = options.scope ?? null;
  const visible = await visibleAmongContacts(tenantId, scope, duplicates.map((match) => match.contact_id));
  const shown = scope === null ? duplicates : duplicates.filter((match) => visible.has(match.contact_id));
  const queuedShown = scope === null ? plan.queue.length : plan.queue.filter((match) => visible.has(match.contact_id)).length;
  // A contact this session may not see is never merged into on its behalf: that would hand it the other
  // producer's contact. The pair stays in the agency's queue for the owner.
  if (plan.auto && visible.has(plan.auto.contact_id)) {
    try {
      const mergeId = await mergeContacts(tenantId, userId, { kept_id: plan.auto.contact_id, merged_id: contact.id, field_choices: {}, review_id: reviewIds.get(plan.auto.contact_id) ?? null }, "auto");
      return { contact: await loadContact(tenantId, plan.auto.contact_id), duplicates: shown, outcome: "auto_merged", mergeId, queued: Math.max(0, queuedShown - 1), reviewsReady };
    } catch (mergeError) {
      // The candidate changed underneath us (merged, or resolved by someone else). The pair stays in
      // the queue for a person instead of failing the save that already happened.
      console.error("[contacts] auto-merge refused; left for review", mergeError);
    }
  }
  return { contact, duplicates: shown, outcome: queuedShown ? "review" : "created", mergeId: null, queued: queuedShown, reviewsReady };
}

/**
 * LA-0.6's one duplicate check, for a contact a carrier file or a proven sale created (LA-4.8/4.9):
 * the probable duplicates found before it was saved go to the Duplicate check review queue. Nothing
 * merges on its own here — a client built from carrier data is checked by a person first (LA-4.9).
 * Never throws: a failed check leaves the client as it is.
 */
export async function queueDuplicateReviews(tenantId: string, contactId: string, dob: string | null, duplicates: readonly DuplicateMatch[]): Promise<number> {
  const queue = planForMatches(dob, duplicates.filter((match) => match.contact_id !== contactId)).queue;
  if (!queue.length) return 0;
  const inserted = await loose().from("contact_duplicate_reviews").insert(queue.map((match) => ({ tenant_id: tenantId, contact_id: contactId, candidate_id: match.contact_id, score: match.score, confidence: match.confidence, matched_on: match.matched_on })));
  if (inserted.error) {
    if (!isMissingSchema(inserted.error)) console.error("[contacts] review pairs could not be queued", inserted.error);
    return 0;
  }
  return queue.length;
}

/** findDuplicates for a caller that must not fail on it (a carrier file, a sale's client). */
export async function findDuplicatesQuietly(tenantId: string, input: ContactInput): Promise<DuplicateMatch[]> {
  try {
    return await findDuplicates(tenantId, input);
  } catch (error) {
    console.error("[contacts] duplicate check skipped", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function mergeContacts(tenantId: string, userId: string, input: { kept_id: string; merged_id: string; field_choices: Record<string, "kept" | "merged">; review_id?: string | null }, source: "manual" | "auto" = "manual") {
  const base = { p_tenant_id: tenantId, p_kept_id: input.kept_id, p_merged_id: input.merged_id, p_field_choices: input.field_choices as Json, p_merged_by: userId };
  let result = await loose().rpc("merge_contacts", { ...base, p_review_id: input.review_id ?? null, p_source: source });
  // Before 20260924326100 only the five-argument function exists. It cannot resolve a review row,
  // but before that migration there are none to resolve.
  if (result.error && isMissingSchema(result.error)) result = await getSupabaseServiceClient().rpc("merge_contacts", base);
  if (result.error || !result.data) {
    const message = result.error?.message ?? "Could not merge contacts";
    if (/already resolved|no longer in the review queue|cannot be merged again/i.test(message)) throw new ContactConflictError(message);
    throw new Error(message);
  }
  return result.data as string;
}

const UNDO_LATER_FIRST = "Undo the later merge first. One of these contacts was merged again afterwards, and undoing this one now would lose that merge.";

export async function undoContactMerge(tenantId: string, mergeId: string) {
  // undo_contact_merge enforces this under lock from 20260924326100. Checked here too so the rule
  // holds against the function that is live before that migration, which does not know it.
  const supabase = getSupabaseServiceClient();
  const target = await supabase.from("merge_log").select("id, kept_id, merged_id, merged_at, reversed_at").eq("tenant_id", tenantId).eq("id", mergeId).maybeSingle();
  if (target.error) throw new Error(`Could not undo merge: ${target.error.message}`);
  if (!target.data) throw new Error("Merge not found");
  if (!target.data.reversed_at) {
    const pair = `${target.data.kept_id},${target.data.merged_id}`;
    const later = await supabase.from("merge_log").select("id").eq("tenant_id", tenantId).is("reversed_at", null).neq("id", mergeId).gte("merged_at", target.data.merged_at).or(`kept_id.in.(${pair}),merged_id.in.(${pair})`).limit(1);
    if (later.error) throw new Error(`Could not undo merge: ${later.error.message}`);
    if ((later.data ?? []).length) throw new ContactConflictError(UNDO_LATER_FIRST);
  }
  const { data, error } = await supabase.rpc("undo_contact_merge", { p_tenant_id: tenantId, p_merge_id: mergeId });
  if (error || !data) {
    const message = error?.message ?? "Could not undo merge";
    if (/Undo the later merge first|already undone/i.test(message)) throw new ContactConflictError(message);
    throw new Error(message);
  }
  return data as string;
}

export async function saveFieldSchema(tenantId: string, input: { entity: string; field_key: string; label: string; type: string; options: string[]; is_required: boolean; sort_order: number }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_field_schema", { p_tenant_id: tenantId, p_entity: input.entity, p_field_key: input.field_key, p_label: input.label, p_type: input.type, p_options: input.options as unknown as Json, p_is_required: input.is_required, p_sort_order: input.sort_order }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save field schema"); return data as unknown as FieldSchemaRow;
}
