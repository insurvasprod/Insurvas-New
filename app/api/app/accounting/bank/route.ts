import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { BankError, confirmMatches, findings, listAccounts, manualMatch, matchQueue, openStatements, paymentResults, removeMatch, saveAccount, setIgnored, suggest } from "@/lib/accounting/bankStore";
import { isDate, isMonth } from "@/lib/accounting/depositWeeksCore";
import { loadDepositWeeks } from "@/lib/accounting/depositWeeksStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.6 (Notion sprint) · bank deposits: accounts, the review queue (suggestions to confirm),
 * the open statements, and the two findings — deposits nothing explains, and statements the bank
 * never shows paid. A person confirms every match. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const uuid = z.string().uuid();
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save_account"), id: uuid.optional(), nickname: z.string().trim().min(1).max(80), bank_name: z.string().trim().max(120).nullable(), last_four: z.string().regex(/^\d{4}$/, "Last four must be exactly four digits.").nullable() }).strict(),
  z.object({ op: z.literal("suggest") }).strict(),
  z.object({ op: z.literal("confirm"), match_ids: z.array(uuid).min(1).max(50) }).strict(),
  z.object({ op: z.literal("manual"), transaction_id: uuid, statement_id: uuid, amount_cents: z.number().int().min(1).max(1_000_000_000_00) }).strict(),
  z.object({ op: z.literal("remove"), match_id: uuid }).strict(),
  z.object({ op: z.literal("ignore"), transaction_id: uuid, reason: z.string().trim().min(1).max(300) }).strict(),
  z.object({ op: z.literal("unignore"), transaction_id: uuid }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof BankError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[bank]", error);
  return NextResponse.json({ error: "That didn't save" }, { status: 500 });
};

/**
 * The carrier payments as Bank deposits › Payments reads them (paymentResults: the statement, the deposits matched to
 * it, each policy against the rate card), for the phone (release 3 boards G3 and G3d). `?payments=1` lists the last
 * 90 days, newest first; `?payment=<statement id>` reads one with its policies. Only reads, as the page does; each
 * deposit is named by its account ("Truist ••4471"), never by the bank's raw line.
 */
async function payments(tenantId: string, statementId: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  // The same 90 days Accounting › To do reads payments over, so a row it lists is always found here.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [list, accounts] = await Promise.all([paymentResults(tenantId, statementId ? { statementId, today } : { since, today }), listAccounts(tenantId)]);
  const label = new Map(accounts.map((a) => [a.id, `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`]));
  const named = statementId && list.rows[0] ? await lineNames(tenantId, list.rows[0]) : null;
  return list.rows.map((r) => ({
    id: r.id, carrierId: r.carrierId, carrierName: r.carrierName, statementDate: r.statementDate, paidCents: r.paidCents, money: r.money, verdict: r.verdict,
    dueBy: r.dueBy, missingCents: r.missingCents, shortCents: r.shortCents,
    landedCents: r.deposits.reduce((sum, d) => sum + d.appliedCents, 0),
    deposits: r.deposits.map((d) => ({ postedOn: d.postedOn, appliedCents: d.appliedCents, account: label.get(d.accountId) ?? "Bank", confirmed: d.confirmed })),
    policies: statementId ? r.policies.map((p) => ({
      policyNumber: p.policyNumber, paidCents: p.paidCents, promisedCents: p.promisedCents, state: p.state, shortCents: p.shortCents, findingId: p.findingId,
      clientName: named?.client.get(p.policyNumber) ?? null, lineType: named?.type.get(p.policyNumber) ?? null,
    })) : undefined,
  }));
}

const LINE_TYPE: Record<string, string> = { advance: "Advance", earned: "As earned", override: "Override", held: "Held", chargeback: "Chargeback", fee: "Fee", advance_interest: "Advance interest", reversal: "Correction" };
type Loose = Record<string, unknown>;
type Read = { eq(c: string, v: unknown): Read; in(c: string, v: unknown[]): Read; limit(n: number): PromiseLike<{ data: Loose[] | null; error: unknown }> };

/**
 * One payment's policy lines named as the phone's Bank deposit draws them (board G3d, "George Patel · Advance"): the
 * insured from the policy book, and the kind of line from that statement's own commission lines (one kind when the
 * policy's lines on that statement agree). Tenant-scoped reads only; a read that fails names nothing.
 */
async function lineNames(tenantId: string, r: { carrierId: string; statementDate: string; policies: { policyNumber: string }[] }) {
  const policies = r.policies.map((p) => p.policyNumber).slice(0, 500);
  const client = new Map<string, string>();
  const type = new Map<string, string>();
  if (!policies.length) return { client, type };
  const db = getSupabaseServiceClient() as unknown as { from(t: string): { select(c: string): Read } };
  const [pcs, lines] = await Promise.all([
    db.from("policy_current").select("policy_number, extra").eq("tenant_id", tenantId).eq("carrier_id", r.carrierId).in("policy_number", policies).limit(1000),
    db.from("commission_entry").select("policy_number, entry_type").eq("tenant_id", tenantId).eq("carrier_id", r.carrierId).eq("statement_date", r.statementDate).in("policy_number", policies).limit(5000),
  ]);
  for (const pc of pcs.error ? [] : pcs.data ?? []) {
    const extra = (pc.extra ?? {}) as Record<string, unknown>;
    const name = [extra.insured_first_name ?? extra.first_name, extra.insured_last_name ?? extra.last_name].filter((v) => typeof v === "string" && v).join(" ");
    if (name) client.set(String(pc.policy_number), name);
  }
  const kinds = new Map<string, Set<string>>();
  for (const l of lines.error ? [] : lines.data ?? []) kinds.set(String(l.policy_number), (kinds.get(String(l.policy_number)) ?? new Set<string>()).add(String(l.entry_type)));
  for (const [policy, set] of kinds) if (set.size === 1) { const k = [...set][0]; if (LINE_TYPE[k]) type.set(policy, LINE_TYPE[k]); }
  return { client, type };
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  const q = request.nextUrl.searchParams;
  // `?deposits=YYYY-MM[&today=YYYY-MM-DD]` (the phone's bookkeeper Home, board B6 "Cash this month"): that month's
  // deposits summed by Monday-to-Sunday week, to today. Only reads, under the same gate.
  const month = q.get("deposits");
  if (month !== null) {
    if (!isMonth(month)) return NextResponse.json({ error: "Name a month as YYYY-MM." }, { status: 400 });
    const today = q.get("today");
    try {
      return NextResponse.json({ deposits: await loadDepositWeeks(tenantId, month, isDate(today) ? today : null) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return fail(error);
    }
  }
  const one = q.get("payment");
  if (one !== null || q.get("payments") === "1") {
    if (one !== null && !uuid.safeParse(one).success) return NextResponse.json({ error: "That payment could not be found." }, { status: 404 });
    try {
      const rows = await payments(tenantId, one);
      if (one !== null) return rows[0] ? NextResponse.json({ payment: rows[0] }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "That payment could not be found." }, { status: 404 });
      return NextResponse.json({ payments: rows }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return fail(error);
    }
  }
  const view = q.get("view") === "all" ? "all" : "open";
  try {
    const [accounts, queue, statements, found] = await Promise.all([listAccounts(tenantId), matchQueue(tenantId, view), openStatements(tenantId), findings(tenantId)]);
    return NextResponse.json({ accounts, queue, statements, findings: found }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const b = parsed.data;
  try {
    let result: unknown = null;
    if (b.op === "save_account") result = await saveAccount(tenantId, userId, { id: b.id, nickname: b.nickname, bankName: b.bank_name, lastFour: b.last_four });
    else if (b.op === "suggest") result = await suggest(tenantId);
    else if (b.op === "confirm") result = await confirmMatches(tenantId, userId, b.match_ids);
    else if (b.op === "manual") result = await manualMatch(tenantId, userId, b.transaction_id, b.statement_id, b.amount_cents);
    else if (b.op === "remove") await removeMatch(tenantId, userId, b.match_id);
    else if (b.op === "ignore") await setIgnored(tenantId, b.transaction_id, b.reason);
    else await setIgnored(tenantId, b.transaction_id, null);
    if (b.op !== "suggest" && b.op !== "save_account") {
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.deposit_match", targetType: "bank_transaction", targetId: "transaction_id" in b ? b.transaction_id : "match_id" in b ? b.match_id : undefined, metadata: { tenantId, op: b.op }, request });
    }
    return NextResponse.json({ result });
  } catch (error) {
    return fail(error);
  }
}
