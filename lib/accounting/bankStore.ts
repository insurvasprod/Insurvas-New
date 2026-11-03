import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { mappingProblem, parseBankCsv, suggestColumnMap, type ColumnMap } from "./bankCore";
import type { MatchStatus } from "./bankLabels";

/**
 * LA-7.6 (Notion sprint, Module 7 — Accounting) · bank deposits, server side. Imports go through
 * import_bank_rows (deduplicated by content hash) and then suggest_deposit_matches; a person
 * confirms every match (20261015260000). Nothing here writes to commission_entry.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const BANK_PENDING_MESSAGE = "Bank matching needs a database update (20261015200000–20261015260000).";

export class BankError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new BankError(BANK_PENDING_MESSAGE, 503);
  if (error.code === "P0002") throw new BankError(error.message.replace(/^\w+: /, ""), 404);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new BankError(error.message.replace(/^\w+: /, ""), 400);
  if (error.code === "23505") throw new BankError("Those two are already matched.", 409);
  throw new Error(error.message);
}

export type BankAccount = { id: string; nickname: string; bankName: string | null; lastFour: string | null; columnMap: ColumnMap | null };
const toAccount = (a: Loose): BankAccount => ({ id: a.id, nickname: a.nickname, bankName: a.bank_name, lastFour: a.last_four, columnMap: a.column_map_json });

export async function listAccounts(tenantId: string): Promise<BankAccount[]> {
  const { data, error } = await db().from("bank_account").select("id, nickname, bank_name, last_four, column_map_json").eq("tenant_id", tenantId).order("nickname");
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map(toAccount);
}

export async function saveAccount(tenantId: string, by: string, input: { id?: string; nickname: string; bankName: string | null; lastFour: string | null; columnMap?: ColumnMap | null }) {
  const row: Record<string, unknown> = { tenant_id: tenantId, nickname: input.nickname.trim(), bank_name: input.bankName?.trim() || null, last_four: input.lastFour?.trim() || null, updated_at: new Date().toISOString() };
  if (input.columnMap !== undefined) row.column_map_json = input.columnMap;
  const res = input.id
    ? await db().from("bank_account").update(row).eq("tenant_id", tenantId).eq("id", input.id).select("id").single()
    : await db().from("bank_account").insert({ ...row, created_by: by }).select("id").single();
  if (res.error) fail(res.error);
  return res.data.id as string;
}

/** Read a file's headers and the account's remembered (or a suggested) mapping, before importing. */
export async function previewImport(tenantId: string, accountId: string, text: string) {
  const account = (await listAccounts(tenantId)).find((a) => a.id === accountId);
  if (!account) throw new BankError("That account isn't in this agency.", 404);
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const headers = parseBankCsv(`${firstLine}\n`, { date: "", description: "", amount: "" }, accountId).headers;
  const map = account.columnMap ?? suggestColumnMap(headers);
  return { headers, map, remembered: !!account.columnMap, problem: mappingProblem(map, headers) };
}

/** Import a bank export: parse with the mapping (remembered on the account), store new lines, suggest matches. */
export async function importBankFile(tenantId: string, by: string, accountId: string, fileName: string, text: string, map: ColumnMap) {
  const account = (await listAccounts(tenantId)).find((a) => a.id === accountId);
  if (!account) throw new BankError("That account isn't in this agency.", 404);
  const parsed = parseBankCsv(text, map, accountId);
  const problem = mappingProblem(map, parsed.headers);
  if (problem) throw new BankError(problem);
  if (!parsed.rows.length) throw new BankError("No lines could be read with that mapping.");
  await saveAccount(tenantId, by, { id: accountId, nickname: account.nickname, bankName: account.bankName, lastFour: account.lastFour, columnMap: map });
  const sha = createHash("sha256").update(text).digest("hex");
  const { data, error } = await db().rpc("import_bank_rows", { p_tenant_id: tenantId, p_account_id: accountId, p_file_name: fileName, p_file_sha256: sha, p_rows: parsed.rows, p_by: by });
  if (error) fail(error);
  const suggested = await suggest(tenantId);
  return { rows: Number(data?.rows ?? 0), added: Number(data?.new ?? 0), duplicates: Number(data?.duplicates ?? 0), skipped: parsed.skipped, suggested };
}

export async function suggest(tenantId: string): Promise<number> {
  const { data, error } = await db().rpc("suggest_deposit_matches", { p_tenant_id: tenantId });
  if (error) fail(error);
  return Number(data ?? 0);
}

export type QueueRow = {
  id: string; accountId: string; postedOn: string; amountCents: number; descriptionRaw: string; status: MatchStatus; ignoredReason: string | null;
  matches: { id: string; statementId: string; carrierName: string; statementDate: string; amountAppliedCents: number; confidence: string; confirmed: boolean; reason: string | null }[];
};

/** Deposits to review: suggestions to confirm, partial matches, and lines nothing explains. */
export async function matchQueue(tenantId: string, view: "open" | "all" = "open"): Promise<QueueRow[]> {
  let q = db().from("bank_transaction").select("id, bank_account_id, posted_on, amount_cents, description_raw, match_status, ignored_reason").eq("tenant_id", tenantId).gt("amount_cents", 0);
  if (view === "open") q = q.in("match_status", ["unmatched", "suggested", "partially_matched"]);
  const { data, error } = await q.order("posted_on", { ascending: false }).order("id").limit(500);
  if (error) fail(error);
  const txns = (data ?? []) as Loose[];
  const ids = txns.map((t) => t.id);
  const [matches, carriers] = await Promise.all([
    ids.length ? db().from("deposit_match").select("id, bank_transaction_id, carrier_account_statement_id, amount_applied_cents, confidence, confirmed_by, reason, carrier_account_statement!inner(carrier_id, statement_date)").in("bank_transaction_id", ids) : Promise.resolve({ data: [] }),
    db().from("carriers").select("id, name"),
  ]);
  const name = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const byTxn = new Map<string, QueueRow["matches"]>();
  for (const m of (matches.data ?? []) as Loose[]) {
    const list = byTxn.get(m.bank_transaction_id) ?? [];
    list.push({ id: m.id, statementId: m.carrier_account_statement_id, carrierName: name.get(m.carrier_account_statement?.carrier_id) ?? "Carrier", statementDate: m.carrier_account_statement?.statement_date, amountAppliedCents: Number(m.amount_applied_cents), confidence: m.confidence, confirmed: !!m.confirmed_by, reason: m.reason });
    byTxn.set(m.bank_transaction_id, list);
  }
  return txns.map((t) => ({ id: t.id, accountId: t.bank_account_id, postedOn: t.posted_on, amountCents: Number(t.amount_cents), descriptionRaw: t.description_raw, status: t.match_status, ignoredReason: t.ignored_reason, matches: byTxn.get(t.id) ?? [] }));
}

/** Statements a deposit could still be matched to by hand: paid, and not fully accounted for. */
export async function openStatements(tenantId: string) {
  const [stmts, matched, carriers] = await Promise.all([
    db().from("carrier_account_statement").select("id, carrier_id, statement_date, amount_paid_cents").eq("tenant_id", tenantId).gt("amount_paid_cents", 0).order("statement_date", { ascending: false }).limit(300),
    db().from("deposit_match").select("carrier_account_statement_id, amount_applied_cents").eq("tenant_id", tenantId).not("confirmed_by", "is", null),
    db().from("carriers").select("id, name"),
  ]);
  if (stmts.error) fail(stmts.error);
  const name = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const applied = new Map<string, number>();
  for (const m of (matched.data ?? []) as Loose[]) applied.set(m.carrier_account_statement_id, (applied.get(m.carrier_account_statement_id) ?? 0) + Number(m.amount_applied_cents));
  return ((stmts.data ?? []) as Loose[]).map((s) => ({ id: s.id as string, carrierName: name.get(s.carrier_id) ?? "Carrier", statementDate: s.statement_date as string, paidCents: Number(s.amount_paid_cents), receivedCents: applied.get(s.id) ?? 0 })).filter((s) => s.receivedCents < s.paidCents);
}

export async function findings(tenantId: string) {
  const [deposits, unreceived, carriers] = await Promise.all([
    db().rpc("deposit_unmatched_deposits", { p_tenant_id: tenantId }),
    db().rpc("deposit_unreceived_statements", { p_tenant_id: tenantId, p_today: new Date().toISOString().slice(0, 10) }),
    db().from("carriers").select("id, name"),
  ]);
  if (deposits.error) fail(deposits.error);
  if (unreceived.error) fail(unreceived.error);
  const name = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  return {
    unexplained: ((deposits.data ?? []) as Loose[]).map((d) => ({ id: d.id as string, postedOn: d.posted_on as string, amountCents: Number(d.amount_cents), appliedCents: Number(d.applied_cents), descriptionRaw: d.description_raw as string })),
    notReceived: ((unreceived.data ?? []) as Loose[]).map((s) => ({ statementId: s.statement_id as string, carrierName: name.get(s.carrier_id) ?? "Carrier", statementDate: s.statement_date as string, paidCents: Number(s.amount_paid_cents), receivedCents: Number(s.received_cents), lagDays: Number(s.lag_days), dueBy: s.due_by as string })),
  };
}

export async function confirmMatches(tenantId: string, by: string, matchIds: string[]) {
  const { data, error } = await db().rpc("confirm_deposit_matches", { p_tenant_id: tenantId, p_match_ids: matchIds, p_by: by });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function manualMatch(tenantId: string, by: string, transactionId: string, statementId: string, amountCents: number) {
  const { data, error } = await db().rpc("manual_deposit_match", { p_tenant_id: tenantId, p_transaction_id: transactionId, p_statement_id: statementId, p_amount_cents: amountCents, p_by: by });
  if (error) fail(error);
  return data as string;
}

/** A confirmed match goes through its writer; a pending suggestion is simply declined. */
export async function removeMatch(tenantId: string, by: string, matchId: string) {
  const { data: m } = await db().from("deposit_match").select("id, confirmed_by, bank_transaction_id").eq("tenant_id", tenantId).eq("id", matchId).maybeSingle();
  if (!m) throw new BankError("That match isn't in this agency.", 404);
  if (m.confirmed_by) {
    const { error } = await db().rpc("remove_deposit_match", { p_tenant_id: tenantId, p_match_id: matchId, p_by: by });
    if (error) fail(error);
    return;
  }
  const { error } = await db().from("deposit_match").delete().eq("tenant_id", tenantId).eq("id", matchId).is("confirmed_by", null);
  if (error) fail(error);
  await db().rpc("refresh_bank_match_status", { p_transaction_id: m.bank_transaction_id });
}

export async function setIgnored(tenantId: string, transactionId: string, reason: string | null) {
  const { error } = await db().from("bank_transaction").update(reason ? { match_status: "ignored", ignored_reason: reason } : { match_status: "unmatched", ignored_reason: null }).eq("tenant_id", tenantId).eq("id", transactionId);
  if (error) fail(error);
  if (!reason) await db().rpc("refresh_bank_match_status", { p_transaction_id: transactionId });
}
