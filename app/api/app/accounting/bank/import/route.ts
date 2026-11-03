import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { BankError, importBankFile, previewImport } from "@/lib/accounting/bankStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.6 (Notion sprint) · importing a bank export: preview its columns against the account's
 * remembered mapping, then import — new lines only, the bank's text verbatim — and queue suggested
 * matches for a person to confirm. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const mapSchema = z.object({
  date: z.string().min(1).max(120),
  amount: z.string().max(120).nullable().optional(),
  credit: z.string().max(120).nullable().optional(),
  debit: z.string().max(120).nullable().optional(),
  description: z.string().min(1).max(120),
  reference: z.string().max(120).nullable().optional(),
  invert: z.boolean().optional(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const accountId = String(form?.get("account_id") ?? "");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose the CSV your bank exported." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Files up to 5 MB." }, { status: 400 });
  if (!z.string().uuid().safeParse(accountId).success) return NextResponse.json({ error: "Choose the account." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const text = await file.text();
    if (form?.get("preview") === "1") return NextResponse.json(await previewImport(tenantId, accountId, text));
    const map = mapSchema.safeParse(JSON.parse(String(form?.get("map") ?? "null")));
    if (!map.success) return NextResponse.json({ error: "Choose which columns hold the date, the description and the amount." }, { status: 400 });
    const result = await importBankFile(tenantId, userId, accountId, file.name.slice(0, 200), text, map.data);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.bank_imported", targetType: "bank_account", targetId: accountId, metadata: { tenantId, rows: result.rows, added: result.added, duplicates: result.duplicates }, request });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BankError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "The column mapping could not be read." }, { status: 400 });
    console.error("[bank-import]", error);
    return NextResponse.json({ error: "The file could not be imported" }, { status: 500 });
  }
}
