import { getUsPhone10Digits } from "@/lib/compliance/scrub";

// Shared by the review-screen import (importPreflight.ts) and the direct CSV import (service.ts,
// importAgentLeads), so both dedupe the same way: by the numbers in the file, never by loading the
// tenant's leads (PostgREST caps an unpaged read at 1,000 rows).

type DbError = { message: string; code?: string };
type Result<T> = { data: T; error: DbError | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  limit(count: number): Query<T>;
};
type Db = {
  from(table: string): Query<unknown>;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
};

/** Numbers per dedupe call. One call answers all of them; the chunk only bounds the request body. */
const LOOKUP_CHUNK = 5_000;
/** Numbers per fallback IN-query, which travels in a URL. */
const FALLBACK_CHUNK = 150;

function phoneOf(values: Record<string, unknown>) {
  try {
    return getUsPhone10Digits(values.phone ?? values.phone_number);
  } catch {
    return null;
  }
}

function isMissingSchema(error: DbError | null | undefined) {
  if (!error) return false;
  return ["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
    || /could not find the (function|column)/i.test(error.message);
}

/**
 * Which of these numbers already belong to one of the tenant's leads, and to which lead.
 *
 * Both callers used to read EVERY lead the tenant has (`select id, values … eq tenant_id`) and build
 * the set in TypeScript. The service client is a plain supabase-js client with no range paging, so
 * that read was capped by PostgREST's max-rows (1,000 on a hosted project unless raised) and on a
 * tenant with ~214k leads the dedupe quietly checked the first thousand and missed everyone else.
 *
 * `import_existing_lead_phones` (20260924330000) returns one jsonb object for just the numbers in
 * the file, so no row cap applies. Before that migration, an IN-query on the two phone keys stands
 * in; it finds leads whose phone is stored as ten or eleven digits — which is how every import
 * stores it — but not a phone saved with punctuation by another intake path.
 */
export async function existingLeadsByPhone(db: Db, tenantId: string, phones: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (phones.length === 0) return found;
  for (let start = 0; start < phones.length; start += LOOKUP_CHUNK) {
    const chunk = phones.slice(start, start + LOOKUP_CHUNK);
    const result = await db.rpc("import_existing_lead_phones", { p_tenant_id: tenantId, p_phones: chunk });
    if (result.error) {
      if (isMissingSchema(result.error)) return existingLeadsByPhoneFallback(db, tenantId, phones);
      throw new Error(`Could not check existing leads: ${result.error.message}`);
    }
    const map = (result.data ?? {}) as Record<string, unknown>;
    for (const [phone, leadId] of Object.entries(map)) if (typeof leadId === "string") found.set(phone, leadId);
  }
  return found;
}

async function existingLeadsByPhoneFallback(db: Db, tenantId: string, phones: string[]): Promise<Map<string, string>> {
  const earliest = new Map<string, { id: string; createdAt: string }>();
  for (let start = 0; start < phones.length; start += FALLBACK_CHUNK) {
    const chunk = phones.slice(start, start + FALLBACK_CHUNK);
    const variants = chunk.flatMap((phone) => [phone, `1${phone}`]);
    for (const column of ["values->>phone", "values->>phone_number"]) {
      const result = await db
        .from("agent_leads")
        .select("id, values, created_at")
        .eq("tenant_id", tenantId)
        .in(column, variants)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (result.error) throw new Error(`Could not check existing leads: ${result.error.message}`);
      for (const lead of (result.data as unknown as Array<{ id: string; values: Record<string, unknown> | null; created_at: string }>) ?? []) {
        const digits = phoneOf(lead.values ?? {});
        if (!digits) continue;
        const seen = earliest.get(digits);
        if (!seen || lead.created_at < seen.createdAt) earliest.set(digits, { id: lead.id, createdAt: lead.created_at });
      }
    }
  }
  return new Map([...earliest].map(([phone, lead]) => [phone, lead.id]));
}
