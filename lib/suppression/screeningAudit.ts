import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeDigits } from "./constants";
import type { ScreeningAuditRow } from "./exemptionConstants";

/**
 * LA-2.3-9 · "Every check audited (who, when, vendor, raw response, outcome); cached per phone with
 * TTL; metered." Every screening writes a screening_audit row (lib/compliance/screening.ts), and
 * nothing showed them. This is the read for /app/tcpa: newest first, filterable by number and
 * outcome, paged by time.
 *
 * Who: the partner for a partner intake, the user for an import, a re-scrub or a Check a number,
 * and "Real-time post" for a vendor's post (it runs with no user). The raw response is the vendor
 * answer exactly as stored.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Query = PromiseLike<Result<Row[]> & { count?: number | null }> & {
  select(columns: string, options?: { count?: "exact" }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
};
type Db = { from(table: string): Query };

const db = () => getSupabaseServiceClient() as unknown as Db;
const text = (value: unknown) => (typeof value === "string" ? value : "");

export const SCREENING_OUTCOMES = ["clear", "dnc", "internal_dq", "tcpa_litigator", "invalid_phone", "unavailable"] as const;

async function nameMap(table: "users" | "partners", ids: string[], columns: string, pick: (row: Row) => string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await db().from(table).select(columns).in("id", unique);
  if (result.error) return new Map();
  return new Map((result.data ?? []).map((row) => [text(row.id), pick(row)]));
}

function leadName(values: unknown): string | null {
  const v = (values && typeof values === "object" ? values : {}) as Row;
  const name = text(v.full_name) || text(v.name) || [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ");
  return name.trim() || null;
}

function origin(row: Row): string {
  const raw = (row.raw_response && typeof row.raw_response === "object" ? row.raw_response : {}) as Row;
  if (text(raw.source) === "dial_preflight") return "Check a number";
  if (row.partner_id) return "Partner intake";
  if (row.user_id) return "Import, re-scrub or check";
  return "Real-time post";
}

export type ScreeningAuditPage = { rows: ScreeningAuditRow[]; total: number; page: number; pageSize: number };

export async function listScreeningAudit(input: {
  tenantId: string;
  phone?: string | null;
  outcome?: string | null;
  /** 1-based, for the shared Pager. */
  page?: number;
  pageSize?: number;
}): Promise<ScreeningAuditPage> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 25, 100));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const digits = input.phone ? normalizeDigits(input.phone) : null;
  if (input.phone && !digits) throw new Error("That is not a ten-digit US phone number.");
  if (input.outcome && !(SCREENING_OUTCOMES as readonly string[]).includes(input.outcome)) throw new Error("That is not a screening outcome.");
  const scoped = (columns: string, options?: { count?: "exact" }) => {
    let query = db().from("screening_audit").select(columns, options).eq("tenant_id", input.tenantId);
    if (digits) query = query.eq("phone_digits", digits);
    if (input.outcome) query = query.eq("outcome", input.outcome);
    return query;
  };
  // Newest first, id as the tie-break so a page boundary never repeats or skips a row. The count is
  // its own read (20260925709730 indexes both): if it cannot be answered, the page still shows.
  const [result, counted] = await Promise.all([
    scoped("id, ts, phone_digits, outcome, vendor, cached, user_id, partner_id, lead_id, raw_response")
      .order("ts", { ascending: false }).order("id", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
    scoped("id", { count: "exact" }).range(0, 0),
  ]);
  if (result.error) throw new Error(`Could not load the screening audit: ${result.error.message}`);
  const rows = result.data ?? [];
  const seen = (page - 1) * pageSize + rows.length;
  const total = !counted.error && typeof counted.count === "number" ? counted.count : rows.length === pageSize ? seen + 1 : seen;

  const [users, partners, leads] = await Promise.all([
    nameMap("users", rows.map((row) => text(row.user_id)), "id, full_name, email", (row) => text(row.full_name) || text(row.email) || "Someone on your team"),
    nameMap("partners", rows.map((row) => text(row.partner_id)), "id, name", (row) => text(row.name) || "A partner"),
    (async () => {
      const ids = [...new Set(rows.map((row) => text(row.lead_id)).filter(Boolean))];
      if (!ids.length) return new Map<string, string | null>();
      const read = await db().from("agent_leads").select("id, values").eq("tenant_id", input.tenantId).in("id", ids);
      return new Map((read.error ? [] : read.data ?? []).map((row) => [text(row.id), leadName(row.values)]));
    })(),
  ]);

  return {
    rows: rows.map((row): ScreeningAuditRow => {
      const partner = partners.get(text(row.partner_id));
      const user = users.get(text(row.user_id));
      return {
        id: text(row.id),
        at: text(row.ts),
        phoneDigits: text(row.phone_digits) || null,
        outcome: text(row.outcome),
        vendor: text(row.vendor) || null,
        cached: row.cached === true,
        who: partner ? `${partner}${user ? ` · ${user}` : ""}` : user ?? (row.user_id ? "A former team member" : "Vendor post (no user)"),
        origin: origin(row),
        leadId: text(row.lead_id) || null,
        leadName: leads.get(text(row.lead_id)) ?? null,
        rawResponse: row.raw_response ?? null,
      };
    }),
    total,
    page,
    pageSize,
  };
}
