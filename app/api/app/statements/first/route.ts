import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit, auditMany } from "@/lib/audit/log";
import { CarrierLimitError } from "@/lib/carriers/limit";
import { confirmFirstStatement, readFirstStatementFile, type FirstStatementFile } from "@/lib/ledger/firstStatementService";
import { statementFileKind, statementFileProblem } from "@/lib/ledger/statementFile";
import { statementFailure } from "@/lib/ledger/statementHttp";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary: Statement first (ledger-r1 board 3·A, owner pick 2026-11-19), Get set up's guided first statement.
 *
 * multipart/form-data, always with the statement `file` (CSV or Excel):
 *
 *   action=read     what the statement says: carrier, new policies, period, rate, advance, lines already wrong.
 *                   Writes nothing.
 *   action=confirm  "Looks Right", with `choices` (JSON): switches the carrier on with a contract level, saves the
 *                   rate and the advance rule, adds the policies the book lacks, imports the statement, accepts its
 *                   exact matches and runs the pay checks (lib/ledger/firstStatementService.ts).
 *
 * Owner and bookkeeper, the two roles that hold `statements.view`, as every statement route; refused to a read-only
 * account, since the flow exists to write.
 */
const roles = ["owner", "bookkeeper"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-31").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a real date");
const anyUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Choose the carrier from the list.");
const choicesSchema = z.object({
  carrier_id: anyUuid,
  period_start: day,
  period_end: day,
  product_code: z.string().trim().min(1, "Choose the product these policies are.").max(80),
  rate_bp: z.number().int("Rates are whole basis points.").min(1, "Enter your rate.").max(1_000_000),
  advance: z.object({ pct_bp: z.number().int().min(1).max(100_000), months: z.number().int().min(1).max(120) }).strict().nullable(),
}).strict();

async function readFileField(form: FormData): Promise<{ file: FirstStatementFile } | { error: string }> {
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose the carrier's statement file." };
  const problem = statementFileProblem(file);
  if (problem) return { error: problem };
  const kind = statementFileKind(file);
  if (!kind) return { error: "Choose the carrier's statement as a CSV or an Excel (.xlsx) file." };
  return { file: { name: file.name.slice(0, 255) || `statement.${kind}`, kind, bytes: new Uint8Array(await file.arrayBuffer()) } };
}

export async function POST(request: NextRequest) {
  // Write for both actions: reading only leads to the confirm, which a read-only account cannot make (the page says so).
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The file could not be read from the upload; try again." }, { status: 400 });
  const action = form.get("action");
  const read = await readFileField(form);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
  const { tenantId } = auth.context;

  if (action === "read") {
    try {
      const result = await readFirstStatementFile(tenantId, read.file);
      return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return statementFailure(error, "Could not read the statement");
    }
  }
  if (action !== "confirm") return NextResponse.json({ error: "Say whether to read the statement or confirm it." }, { status: 400 });

  const userId = auth.context.userId;
  let raw: unknown = null;
  try { raw = JSON.parse(String(form.get("choices") ?? "")); } catch { raw = null; }
  const parsed = choicesSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check what we found and try again." }, { status: 400 });
  const choices = parsed.data;

  try {
    const result = await confirmFirstStatement(tenantId, userId, read.file, {
      carrierId: choices.carrier_id, periodStart: choices.period_start, periodEnd: choices.period_end, productCode: choices.product_code,
      rateBp: choices.rate_bp, advance: choices.advance ? { pctBp: choices.advance.pct_bp, months: choices.advance.months } : null,
    });
    const log = (entry: Omit<Parameters<typeof audit>[0], "actorType" | "actorId" | "request">) => audit({ actorType: "tenant", actorId: userId, request, ...entry });
    if (result.levelSaved) await log({ action: "tenant.carrier_configured", targetType: "tenant_carrier", targetId: choices.carrier_id, metadata: { tenantId, carrierId: choices.carrier_id, ...result.levelSaved, from: "first_statement" } });
    if (result.rateSaved || result.advanceSaved || result.familiesMapped.length) {
      await log({ action: "rate_card.saved", targetType: "carrier", targetId: choices.carrier_id, metadata: { tenantId, change: "first_statement", productCode: choices.product_code, rateBp: result.rateSaved ? choices.rate_bp : null, advance: result.advanceSaved ? choices.advance : null, familiesMapped: result.familiesMapped } });
    }
    if (result.policiesAdded) await log({ action: "tenant.policies_imported", targetType: "tenant_policy", targetId: result.statementId, metadata: { tenantId, count: result.policiesAdded, source: "first_statement" } });
    await log({ action: "tenant.commission_statement_imported", targetType: "tenant_commission_statement", targetId: result.statementId, metadata: { tenantId, carrierId: choices.carrier_id, periodStart: choices.period_start, periodEnd: choices.period_end, fileName: read.file.name, fileKind: read.file.kind, lines: result.lines, from: "first_statement" } });
    await auditMany(result.acceptedLines.map((line) => ({
      actorType: "tenant" as const, actorId: userId, action: "tenant.statement_match_accepted" as const,
      targetType: "tenant_commission_statement_line", targetId: line.line_id,
      metadata: { tenantId, statementId: result.statementId, lineNumber: line.line_number, policyId: line.policy_id, proposedPolicyId: line.proposed_policy_id },
      request,
    })));
    return NextResponse.json({ ok: true, statementId: result.statementId, carrierName: result.carrierName, policiesAdded: result.policiesAdded, lines: result.lines, accepted: result.accepted, opened: result.opened }, { status: 201 });
  } catch (error) {
    if (error instanceof CarrierLimitError) return NextResponse.json({ error: error.message, code: error.code, limit: error.limit }, { status: 403 });
    return statementFailure(error, "Could not set up from the statement");
  }
}
