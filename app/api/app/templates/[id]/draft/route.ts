import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { clearServerDraft, FormSchemaPendingError, readServerDraft, saveServerDraft } from "@/lib/templates/formsServer";

/**
 * The builder's draft saved to Insurvas (board A2: "draft saved to Insurvas 1 min ago, so it follows
 * you to any computer"). Needs 20261112200000; until then GET answers `{ draft: null, pending: true }`
 * and the builder keeps the draft in this browser, as before.
 */
const pendingResponse = () => NextResponse.json({ draft: null, pending: true, error: "Saving drafts to Insurvas needs a database update that has not been applied yet.", code: "schema_pending" }, { status: 503 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    return NextResponse.json({ draft: await readServerDraft(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return pendingResponse();
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the draft" }, { status: 400 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { base_revision?: number; draft?: unknown } | null;
  if (!body || !Number.isInteger(body.base_revision) || !body.draft) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  try {
    const { id } = await params;
    return NextResponse.json(await saveServerDraft(auth.context.tenantId, auth.context.userId, id, body.base_revision as number, body.draft));
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return pendingResponse();
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the draft" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await clearServerDraft(auth.context.tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clear the draft" }, { status: 400 });
  }
}
