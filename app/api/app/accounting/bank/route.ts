import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { BankError, confirmMatches, findings, listAccounts, manualMatch, matchQueue, openStatements, removeMatch, saveAccount, setIgnored, suggest } from "@/lib/accounting/bankStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.6 (Notion sprint) · bank deposits: accounts, the review queue (suggestions to confirm),
 * the open statements, and the two findings — deposits nothing explains, and statements the bank
 * never shows paid. A person confirms every match. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const uuid = z.string().uuid();
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save_account"), id: uuid.optional(), nickname: z.string().trim().min(1).max(80), bank_name: z.string().trim().max(120).nullable(), last_four: z.string().regex(/^\d{4}$/).nullable() }).strict(),
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

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  const view = request.nextUrl.searchParams.get("view") === "all" ? "all" : "open";
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
