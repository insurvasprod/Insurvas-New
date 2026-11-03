import { NextResponse, type NextRequest } from "next/server";

import { badRequest, statementFailure, statementImportSchema, toImportInput } from "@/lib/ledger/statementHttp";
import { previewStatement } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary: the preview step of a statement import. Parses the file with the chosen mapping,
 * proposes exact matches against the book and checks for a duplicate — and writes nothing. It is a
 * POST only because the file travels in the body.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const body = statementImportSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest(body.error);
  try {
    const preview = await previewStatement(auth.context.tenantId, toImportInput(body.data));
    return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return statementFailure(error, "Could not read the statement");
  }
}
