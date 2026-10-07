import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import type { StatementCheck } from "./carrierAccounts";

/**
 * LA-4.14 (Notion sprint) · carrier account statements and the orphan summary, server side. The
 * statement header is typed in from the statement (most files carry it above the lines, where the
 * layout map doesn't read); the checks are the carrier_account_checks view's, never recomputed here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const ACCOUNTS_PENDING_MESSAGE = "Carrier accounts need a database update (20261008240000).";

export class AccountError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AccountError";
  }
}

const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function loadAccounts(tenantId: string) {
  const [checks, orphans, carriers, files] = await Promise.all([
    db().from("carrier_account_checks").select("*").eq("tenant_id", tenantId).order("carrier_id").order("statement_date"),
    db().from("commission_orphan_summary").select("*").eq("tenant_id", tenantId),
    db().from("carriers").select("id, name"),
    db().from("file_registry").select("id, carrier_id, original_filename, file_date, status").eq("tenant_id", tenantId).eq("file_type", "commissions").neq("status", "superseded").order("file_date", { ascending: false }).limit(500),
  ]);
  if (checks.error) {
    if (isSchemaGap(checks.error)) return { available: false as const };
    throw new Error(`Could not load the carrier accounts: ${checks.error.message}`);
  }
  const name = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  const statements: Array<StatementCheck & { carrierName: string }> = (checks.data ?? []).map((s: Loose) => ({
    id: s.id, carrierId: s.carrier_id, carrierName: name.get(s.carrier_id) ?? "Carrier not known", statementDate: s.statement_date, fileId: s.file_id,
    openingCents: Number(s.opening_balance_cents), activityCents: Number(s.activity_cents), closingCents: Number(s.closing_balance_cents), debitCents: Number(s.debit_balance_cents),
    amountPaidCents: n(s.amount_paid_cents), heldCents: n(s.held_cents), minimumPayoutCents: n(s.minimum_payout_cents), entriesCents: n(s.entries_cents), entries: n(s.entries),
    arithmeticOk: Boolean(s.arithmetic_ok), entriesOk: Boolean(s.entries_ok), continuityOk: Boolean(s.continuity_ok), previousStatementDate: s.previous_statement_date,
  }));
  return {
    available: true as const,
    statements,
    orphans: (orphans.data ?? []).map((o: Loose) => ({ carrierId: o.carrier_id as string, carrierName: name.get(o.carrier_id) ?? "Carrier not known", policies: Number(o.orphan_policies), lines: Number(o.orphan_lines), amountCents: Number(o.orphan_amount_cents), heldCents: Number(o.orphan_held_cents), oldest: o.oldest_orphan_date as string | null, pastThreshold: Number(o.past_threshold) })),
    files: (files.data ?? []).map((f: Loose) => ({ id: f.id as string, carrierId: f.carrier_id as string, label: `${f.original_filename}${f.file_date ? ` · ${f.file_date}` : ""}`, fileDate: f.file_date as string | null })),
    carriers: [...new Map((files.data ?? []).map((f: Loose) => [f.carrier_id, name.get(f.carrier_id) ?? "Carrier not known"])).entries()].map(([id, label]) => ({ id: id as string, name: label as string })),
  };
}

export type StatementInput = { carrierId: string; statementDate: string; fileId: string | null; openingCents: number; activityCents: number; closingCents: number; amountPaidCents: number | null; heldCents: number | null; minimumPayoutCents: number | null };

/** A statement's header, as the statement states it. Saving the same carrier and date again corrects it. */
export async function saveStatement(tenantId: string, userId: string, input: StatementInput) {
  if (input.fileId) {
    const { data: file } = await db().from("file_registry").select("id, carrier_id, file_type").eq("tenant_id", tenantId).eq("id", input.fileId).maybeSingle();
    if (!file || file.file_type !== "commissions") throw new AccountError("Choose one of this agency's commission files.", 400);
    if (file.carrier_id !== input.carrierId) throw new AccountError("That file is another carrier's statement.", 400);
  }
  const { error } = await db().from("carrier_account_statement").upsert({
    tenant_id: tenantId, carrier_id: input.carrierId, statement_date: input.statementDate, file_id: input.fileId,
    opening_balance_cents: input.openingCents, activity_cents: input.activityCents, closing_balance_cents: input.closingCents,
    amount_paid_cents: input.amountPaidCents, held_cents: input.heldCents, minimum_payout_cents: input.minimumPayoutCents,
    entered_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,carrier_id,statement_date" });
  if (error) {
    if (isSchemaGap(error)) throw new AccountError(ACCOUNTS_PENDING_MESSAGE, 503);
    if (error.code === "23505") throw new AccountError("That commission file already heads another statement.", 409);
    throw new Error(`Could not save the statement: ${error.message}`);
  }
}

/** The orphan sweep for one agency: opens items past the threshold, closes the ones whose policy arrived. */
export async function sweepOrphans(tenantId: string): Promise<{ opened: number; closed: number } | null> {
  const { data, error } = await db().rpc("sweep_orphan_commissions", { p_tenant_id: tenantId });
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not sweep the orphan commission lines: ${error.message}`);
  }
  return { opened: Number(data?.opened ?? 0), closed: Number(data?.closed ?? 0) };
}

/** Files whose statement fails its arithmetic: their lines are held out of every total until corrected. */
export async function flaggedFiles(tenantId: string): Promise<Set<string>> {
  const { data, error } = await db().from("carrier_account_checks").select("file_id").eq("tenant_id", tenantId).eq("flagged", true).not("file_id", "is", null);
  if (error) return new Set();
  return new Set((data ?? []).map((r: Loose) => r.file_id as string));
}
