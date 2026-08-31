import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { LegalError, outstandingDocuments, recordAcceptances } from "@/lib/legal/acceptance";

const schema = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(5) });

/**
 * Records acceptance from the re-acceptance gate.
 *
 * The submitted ids are checked against what this user actually owes, computed server-side. A
 * client that posts an arbitrary document id — or a stale one from a tab left open — records
 * nothing it should not, and the gate keeps holding until the real outstanding version is accepted.
 */
export async function POST(request: NextRequest) {
  const context = await resolveTenantContext();
  if (!context) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const outstanding = await outstandingDocuments(context.userId);
  if (outstanding.length === 0) return NextResponse.json({ ok: true, alreadyUpToDate: true });

  const owed = new Set(outstanding.map((doc) => doc.id));
  const submitted = new Set(parsed.data.documentIds);
  const unaccepted = outstanding.filter((doc) => !submitted.has(doc.id));

  if (unaccepted.length > 0) {
    return NextResponse.json(
      { error: `You must accept the ${unaccepted[0].title} to continue.` },
      { status: 400 },
    );
  }

  try {
    // Only what they owe — an id they sent that is not outstanding is ignored rather than recorded.
    await recordAcceptances(
      context.userId,
      parsed.data.documentIds.filter((id) => owed.has(id)),
      "reacceptance",
      request,
    );
  } catch (error) {
    if (error instanceof LegalError) return NextResponse.json({ error: error.message }, { status: 500 });
    console.error("[legal] acceptance failed", error);
    return NextResponse.json({ error: "Could not record your acceptance" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
