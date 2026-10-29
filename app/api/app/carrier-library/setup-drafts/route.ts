import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { saveCarrierSetupDraft } from "@/lib/carriers/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const draftSchema = z.object({
  carrier_id: z.string().uuid(),
  contract_level_text: z.string().trim().max(20).nullable(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  writing_number: z.string().trim().max(120).nullable(),
}).strict();

/** Incomplete Contracting form values stay separate from real contract and appointment records. */
export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid carrier setup details" }, { status: 400 });
  try {
    await saveCarrierSetupDraft(auth.context.tenantId, auth.context.userId, parsed.data);
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save carrier setup" }, { status: 400 });
  }
}
