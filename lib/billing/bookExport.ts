import "server-only";

// LA-8.5 · The export offered when an agency cancels (and any time from Plan & billing): its book of
// business and its commission history, as CSV. Leads and contacts already have their own exports.
// Read as the service client with an explicit tenant filter on every query.

import type { SupabaseClient } from "@supabase/supabase-js";

import { csvCellMinimal } from "@/lib/csv/cell";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const BOOK_EXPORT_PARTS = ["policies", "commissions"] as const;
export type BookExportPart = (typeof BOOK_EXPORT_PARTS)[number];

// Untyped: the statement tables are not in the generated types.
const db = () => getSupabaseServiceClient() as unknown as SupabaseClient;

/** PostgREST caps a response at 1,000 rows; an export pages until it runs out. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await page(offset, offset + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return all;
}

const line = (cells: unknown[]) => cells.map(csvCellMinimal).join(",");

export async function bookExportCsv(tenantId: string, part: BookExportPart): Promise<string> {
  if (part === "policies") {
    type Row = { policy_number: string | null; insured_name: string | null; carrier: string | null; product: string | null; status: string | null; effective_date: string | null; renewal_date: string | null; annual_premium_cents: number | null; source: string | null; created_at: string };
    const rows = await readAll<Row>((from, to) =>
      db().from("tenant_policies").select("policy_number, insured_name, carrier, product, status, effective_date, renewal_date, annual_premium_cents, source, created_at").eq("tenant_id", tenantId).order("created_at").order("id").range(from, to));
    return [
      line(["Policy number", "Insured", "Carrier", "Product", "Status", "Effective date", "Renewal date", "Annual premium (cents)", "Source", "Added"]),
      ...rows.map((r) => line([r.policy_number, r.insured_name, r.carrier, r.product, r.status, r.effective_date, r.renewal_date, r.annual_premium_cents, r.source, r.created_at])),
    ].join("\r\n");
  }

  type Statement = { id: string; carrier_id: string | null; period_start: string | null; period_end: string | null; original_filename: string | null };
  const statements = await readAll<Statement>((from, to) =>
    db().from("tenant_commission_statements").select("id, carrier_id, period_start, period_end, original_filename").eq("tenant_id", tenantId).is("voided_at", null).order("id").range(from, to));
  const carrierIds = [...new Set(statements.map((s) => s.carrier_id).filter((id): id is string => Boolean(id)))];
  const carriers = carrierIds.length ? await db().from("carriers").select("id, name").in("id", carrierIds) : { data: [] };
  const carrierName = new Map(((carriers.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const byId = new Map(statements.map((s) => [s.id, s]));

  type Line = { statement_id: string; line_number: number; policy_number: string | null; insured_name: string | null; kind: string | null; line_date: string | null; amount_cents: number | null; premium_cents: number | null; review_status: string | null };
  const lines = await readAll<Line>((from, to) =>
    db().from("tenant_commission_statement_lines").select("statement_id, line_number, policy_number, insured_name, kind, line_date, amount_cents, premium_cents, review_status").eq("tenant_id", tenantId).order("statement_id").order("line_number").range(from, to));
  return [
    line(["Carrier", "Statement period start", "Statement period end", "Statement file", "Line", "Policy number", "Insured", "Kind", "Date", "Amount (cents)", "Premium (cents)", "Review"]),
    ...lines.flatMap((l) => {
      const s = byId.get(l.statement_id);
      if (!s) return []; // a voided statement's lines are not history
      return [line([s.carrier_id ? carrierName.get(s.carrier_id) ?? "" : "", s.period_start, s.period_end, s.original_filename, l.line_number, l.policy_number, l.insured_name, l.kind, l.line_date, l.amount_cents, l.premium_cents, l.review_status])];
    }),
  ].join("\r\n");
}
