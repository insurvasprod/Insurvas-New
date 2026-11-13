import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { mappingProblem, parseBankCsv, suggestColumnMap, type ColumnMap } from "./bankCore";
import type { MatchStatus } from "./bankLabels";
import { addDays, closestDeposit, moneyState, paymentVerdict, policyState, shortBy, type MoneyState, type PaymentVerdict, type PolicyInput, type PolicyState } from "./bankResultsCore";

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
  id: string; accountId: string; postedOn: string; amountCents: number; descriptionRaw: string; reference: string | null; status: MatchStatus; ignoredReason: string | null;
  matches: { id: string; statementId: string; carrierName: string; statementDate: string; amountAppliedCents: number; confidence: string; confirmed: boolean; confirmedAt: string | null; reason: string | null }[];
};

/** Deposits to review: suggestions to confirm, partial matches, and lines nothing explains. */
export async function matchQueue(tenantId: string, view: "open" | "all" = "open"): Promise<QueueRow[]> {
  let q = db().from("bank_transaction").select("id, bank_account_id, posted_on, amount_cents, description_raw, reference, match_status, ignored_reason").eq("tenant_id", tenantId).gt("amount_cents", 0);
  if (view === "open") q = q.in("match_status", ["unmatched", "suggested", "partially_matched"]);
  const { data, error } = await q.order("posted_on", { ascending: false }).order("id").limit(500);
  if (error) fail(error);
  const txns = (data ?? []) as Loose[];
  const ids = txns.map((t) => t.id);
  const [matches, carriers] = await Promise.all([
    ids.length ? db().from("deposit_match").select("id, bank_transaction_id, carrier_account_statement_id, amount_applied_cents, confidence, confirmed_by, confirmed_at, reason, carrier_account_statement!inner(carrier_id, statement_date)").in("bank_transaction_id", ids) : Promise.resolve({ data: [] }),
    db().from("carriers").select("id, name"),
  ]);
  const name = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const byTxn = new Map<string, QueueRow["matches"]>();
  for (const m of (matches.data ?? []) as Loose[]) {
    const list = byTxn.get(m.bank_transaction_id) ?? [];
    list.push({ id: m.id, statementId: m.carrier_account_statement_id, carrierName: name.get(m.carrier_account_statement?.carrier_id) ?? "Carrier", statementDate: m.carrier_account_statement?.statement_date, amountAppliedCents: Number(m.amount_applied_cents), confidence: m.confidence, confirmed: !!m.confirmed_by, confirmedAt: (m.confirmed_at as string | null) ?? null, reason: m.reason });
    byTxn.set(m.bank_transaction_id, list);
  }
  return txns.map((t) => ({ id: t.id, accountId: t.bank_account_id, postedOn: t.posted_on, amountCents: Number(t.amount_cents), descriptionRaw: t.description_raw, reference: (t.reference as string | null) ?? null, status: t.match_status, ignoredReason: t.ignored_reason, matches: byTxn.get(t.id) ?? [] }));
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
  // Nothing confirmed: the ids are not this agency's suggestions (or were confirmed already) — say so, not "ok".
  const confirmed = Number(data ?? 0);
  if (confirmed === 0) throw new BankError("Nothing to confirm: those matches are not open suggestions in this agency.", 404);
  return confirmed;
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

// ─── Results (owner's Accounting doc, "The Bank Matchmaker", 2026-11-07) ───────────────────────────
// One verdict per carrier payment, read from what is already recorded: the statement, its deposit
// matches and LA-4.15's per-policy findings. Nothing here writes.

export type PaymentPolicy = {
  policyNumber: string;
  paidCents: number;
  rateBp: number | null;
  promisedCents: number | null;
  state: PolicyState;
  shortCents: number;
  findingId: string | null;
};
export type PaymentDeposit = { matchId: string; transactionId: string; postedOn: string; amountCents: number; appliedCents: number; descriptionRaw: string; accountId: string; confirmed: boolean };
export type PaymentResult = {
  id: string;
  carrierId: string;
  carrierName: string;
  statementDate: string;
  paidCents: number;
  fileId: string | null;
  money: MoneyState;
  dueBy: string;
  missingCents: number;
  shortCents: number;
  verdict: PaymentVerdict;
  deposits: PaymentDeposit[];
  policies: PaymentPolicy[];
};

async function bankRules(tenantId: string) {
  const { data } = await db().from("accounting_settings").select("bank_window_days, bank_amount_tolerance_cents").eq("tenant_id", tenantId).maybeSingle();
  return { windowDays: Number(data?.bank_window_days ?? 21), toleranceCents: Number(data?.bank_amount_tolerance_cents ?? 0) };
}

/** Carrier payments since `since` (or one payment by id), each with its deposits, policies and verdict. */
export async function paymentResults(tenantId: string, opts: { since?: string; statementId?: string; today?: string } = {}): Promise<{ rows: PaymentResult[]; windowDays: number; bankThrough: string | null }> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  let sq = db().from("carrier_account_statement").select("id, carrier_id, statement_date, amount_paid_cents, file_id").eq("tenant_id", tenantId).gt("amount_paid_cents", 0);
  if (opts.statementId) sq = sq.eq("id", opts.statementId);
  else if (opts.since) sq = sq.gte("statement_date", opts.since);
  const [stmts, rules, latest, carriers] = await Promise.all([
    sq.order("statement_date", { ascending: false }).limit(300),
    bankRules(tenantId),
    db().from("bank_transaction").select("posted_on").eq("tenant_id", tenantId).order("posted_on", { ascending: false }).limit(1),
    db().from("carriers").select("id, name"),
  ]);
  if (stmts.error) fail(stmts.error);
  const list = (stmts.data ?? []) as Loose[];
  const bankThrough = ((latest.data ?? []) as Loose[])[0]?.posted_on ?? null;
  const name = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  if (!list.length) return { rows: [], windowDays: rules.windowDays, bankThrough };

  const ids = list.map((s) => s.id as string);
  const carrierIds = [...new Set(list.map((s) => s.carrier_id as string))];
  const dates = [...new Set(list.map((s) => s.statement_date as string))];
  const fileIds = list.map((s) => s.file_id as string | null).filter((f): f is string => !!f);
  const [matches, byDate, byFile] = await Promise.all([
    db().from("deposit_match").select("id, carrier_account_statement_id, amount_applied_cents, confirmed_by, bank_transaction!inner(id, posted_on, amount_cents, description_raw, bank_account_id)").eq("tenant_id", tenantId).in("carrier_account_statement_id", ids),
    db().from("commission_entry").select("carrier_id, statement_date, file_id, policy_number, amount_cents").eq("tenant_id", tenantId).in("carrier_id", carrierIds).in("statement_date", dates).limit(10000),
    fileIds.length ? db().from("commission_entry").select("carrier_id, statement_date, file_id, policy_number, amount_cents").eq("tenant_id", tenantId).in("file_id", fileIds).limit(10000) : Promise.resolve({ data: [] }),
  ]);
  if (matches.error) fail(matches.error);

  // Each statement's policies: lines from its own file, else lines of that carrier dated that statement day.
  const stmtByFile = new Map(list.filter((s) => s.file_id).map((s) => [s.file_id as string, s.id as string]));
  const stmtByDay = new Map(list.map((s) => [`${s.carrier_id}|${s.statement_date}`, s.id as string]));
  const paid = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  for (const e of [...((byFile.data ?? []) as Loose[]), ...((byDate.data ?? []) as Loose[])]) {
    const sid = (e.file_id && stmtByFile.get(e.file_id)) || stmtByDay.get(`${e.carrier_id}|${e.statement_date}`);
    if (!sid) continue;
    const key = `${sid}|${e.file_id}|${e.policy_number}|${e.amount_cents}|${e.statement_date}`;
    if (seen.has(key)) continue; // the same line found both ways
    seen.add(key);
    const m = paid.get(sid) ?? new Map<string, number>();
    m.set(e.policy_number, (m.get(e.policy_number) ?? 0) + Number(e.amount_cents));
    paid.set(sid, m);
  }
  const policyNumbers = [...new Set([...paid.values()].flatMap((m) => [...m.keys()]))];
  const [findingsRes, expectedRes] = policyNumbers.length
    ? await Promise.all([
        db().from("commission_discrepancy").select("id, carrier_id, policy_number, discrepancy_type, expected_amount_cents, reported_amount_cents, difference_cents").eq("tenant_id", tenantId).in("status", ["open", "disputed"]).in("discrepancy_type", ["missing", "short_paid", "mis_rated", "over_paid"]).in("policy_number", policyNumbers.slice(0, 1000)),
        db().from("expected_commission").select("carrier_id, policy_number, policy_year, rate_bp_applied, expected_amount_cents, expected_advance_cents").eq("tenant_id", tenantId).in("policy_number", policyNumbers.slice(0, 1000)).order("policy_year"),
      ])
    : [{ data: [] }, { data: [] }];
  // One finding per policy: one that says it was underpaid (or not paid) outranks an overpayment.
  const asInput = (f: Loose): PolicyInput["finding"] => ({ type: f.discrepancy_type, expectedCents: f.expected_amount_cents === null ? null : Number(f.expected_amount_cents), reportedCents: f.reported_amount_cents === null ? null : Number(f.reported_amount_cents), differenceCents: f.difference_cents === null ? null : Number(f.difference_cents) });
  const isShort = (f: Loose) => policyState({ finding: asInput(f), expected: null }) === "short";
  const finding = new Map<string, Loose>();
  for (const f of (findingsRes.data ?? []) as Loose[]) {
    const k = `${f.carrier_id}|${f.policy_number}`;
    const prev = finding.get(k);
    if (!prev || (!isShort(prev) && isShort(f))) finding.set(k, f);
  }
  const expected = new Map<string, Loose>();
  for (const x of (expectedRes.data ?? []) as Loose[]) if (!expected.has(`${x.carrier_id}|${x.policy_number}`)) expected.set(`${x.carrier_id}|${x.policy_number}`, x);

  const deposits = new Map<string, PaymentDeposit[]>();
  for (const m of (matches.data ?? []) as Loose[]) {
    const t = m.bank_transaction;
    const d = deposits.get(m.carrier_account_statement_id) ?? [];
    d.push({ matchId: m.id, transactionId: t.id, postedOn: t.posted_on, amountCents: Number(t.amount_cents), appliedCents: Number(m.amount_applied_cents), descriptionRaw: t.description_raw, accountId: t.bank_account_id, confirmed: !!m.confirmed_by });
    deposits.set(m.carrier_account_statement_id, d);
  }

  const rows = list.map((s): PaymentResult => {
    const dep = deposits.get(s.id) ?? [];
    const confirmedCents = dep.filter((d) => d.confirmed).reduce((n, d) => n + d.appliedCents, 0);
    const suggestedCents = dep.filter((d) => !d.confirmed).reduce((n, d) => n + d.appliedCents, 0);
    const money = moneyState({ paidCents: Number(s.amount_paid_cents), confirmedCents, suggestedCents, statementDate: s.statement_date, windowDays: rules.windowDays, toleranceCents: rules.toleranceCents, today, bankThrough });
    const policies = [...(paid.get(s.id) ?? new Map<string, number>()).entries()].map(([policyNumber, paidCents]): PaymentPolicy => {
      const f = finding.get(`${s.carrier_id}|${policyNumber}`);
      const x = expected.get(`${s.carrier_id}|${policyNumber}`);
      const input: PolicyInput = {
        finding: f ? asInput(f) : null,
        expected: x ? { rateBp: x.rate_bp_applied === null ? null : Number(x.rate_bp_applied), amountCents: x.expected_amount_cents === null ? null : Number(x.expected_advance_cents ?? x.expected_amount_cents) } : null,
      };
      const state = policyState(input);
      return {
        policyNumber, paidCents, state,
        rateBp: input.expected?.rateBp ?? null,
        promisedCents: f?.expected_amount_cents != null ? Number(f.expected_amount_cents) : input.expected?.amountCents ?? null,
        shortCents: state === "short" ? shortBy(input) : 0,
        findingId: f?.id ?? null,
      };
    }).sort((a, b) => b.shortCents - a.shortCents || a.policyNumber.localeCompare(b.policyNumber));
    return {
      id: s.id, carrierId: s.carrier_id, carrierName: name.get(s.carrier_id) ?? "Carrier", statementDate: s.statement_date, paidCents: Number(s.amount_paid_cents), fileId: s.file_id ?? null,
      money: money.state, dueBy: money.dueBy, missingCents: money.missingCents,
      shortCents: policies.reduce((n, p) => n + p.shortCents, 0),
      verdict: paymentVerdict(money.state, policies.map((p) => p.state)),
      deposits: dep.sort((a, b) => a.postedOn.localeCompare(b.postedOn)), policies,
    };
  });
  return { rows, windowDays: rules.windowDays, bankThrough };
}

/** For a payment nothing matched: the nearest unmatched deposit, to link in one click. */
export async function nearestDeposit(tenantId: string, statementDate: string, paidCents: number, windowDays: number) {
  const { data } = await db().from("bank_transaction").select("id, posted_on, amount_cents, description_raw, bank_account_id").eq("tenant_id", tenantId).gt("amount_cents", 0)
    .in("match_status", ["unmatched", "suggested", "partially_matched"]).gte("posted_on", statementDate).lte("posted_on", addDays(statementDate, windowDays + 7)).limit(200);
  const near = closestDeposit(((data ?? []) as Loose[]).map((t) => ({ id: t.id as string, postedOn: t.posted_on as string, amountCents: Number(t.amount_cents), descriptionRaw: t.description_raw as string, accountId: t.bank_account_id as string })), statementDate, paidCents, windowDays);
  return near;
}

export async function setIgnored(tenantId: string, transactionId: string, reason: string | null) {
  const { data, error } = await db().from("bank_transaction").update(reason ? { match_status: "ignored", ignored_reason: reason } : { match_status: "unmatched", ignored_reason: null }).eq("tenant_id", tenantId).eq("id", transactionId).select("id");
  if (error) fail(error);
  if (!(data as Loose[] | null)?.length) throw new BankError("That deposit isn't in this agency.", 404);
  if (!reason) await db().rpc("refresh_bank_match_status", { p_transaction_id: transactionId });
}

// ─── Round 7 (owner 2026-11-10, mockups-r7/accounting.html § 1): reads only ───────────────────────────────

export type AccountFacts = { accountId: string; linesReach: string | null; deposits: number; lastImport: { at: string; rows: number } | null };

/** Per account: how far its lines reach (Missing money is only called once they reach the due date), how many
 *  deposits it holds, and its last import. Head reads and one-row reads, one set per account. */
export async function accountFacts(tenantId: string, accountIds: string[]): Promise<AccountFacts[]> {
  return Promise.all(accountIds.map(async (accountId) => {
    const [latest, count, imported] = await Promise.all([
      db().from("bank_transaction").select("posted_on").eq("tenant_id", tenantId).eq("bank_account_id", accountId).order("posted_on", { ascending: false }).limit(1),
      db().from("bank_transaction").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("bank_account_id", accountId).gt("amount_cents", 0),
      db().from("bank_import").select("imported_at, rows_total").eq("tenant_id", tenantId).eq("bank_account_id", accountId).order("imported_at", { ascending: false }).limit(1),
    ]);
    if (latest.error) fail(latest.error);
    const last = ((imported.data ?? []) as Loose[])[0];
    return {
      accountId,
      linesReach: ((latest.data ?? []) as Loose[])[0]?.posted_on ?? null,
      deposits: Number(count.count ?? 0),
      lastImport: last ? { at: String(last.imported_at).slice(0, 10), rows: Number(last.rows_total ?? 0) } : null,
    };
  }));
}

export type PaymentLetter = { id: string; createdAt: string; status: string; totalCents: number; items: number };

/** The dispute letters (LA-4.15) drafted from this payment's findings, newest first. */
export async function paymentLetters(tenantId: string, findingIds: string[]): Promise<PaymentLetter[]> {
  if (!findingIds.length) return [];
  const { data, error } = await db().from("commission_dispute").select("id, created_at, status, total_cents, discrepancy_ids").eq("tenant_id", tenantId).overlaps("discrepancy_ids", findingIds).order("created_at", { ascending: false }).limit(50);
  if (error) {
    if (isSchemaGap(error)) return [];
    fail(error);
  }
  return ((data ?? []) as Loose[]).map((d) => ({ id: d.id, createdAt: String(d.created_at).slice(0, 10), status: d.status, totalCents: Number(d.total_cents ?? 0), items: Array.isArray(d.discrepancy_ids) ? d.discrepancy_ids.length : 0 }));
}
