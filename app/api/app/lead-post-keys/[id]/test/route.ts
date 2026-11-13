import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { testHistory, testPost } from "@/lib/leadPost/boardStore";

/**
 * Round 8 · "Send a test post": every check a real post runs that has no side effects, stopping
 * before a lead, a charge or a metered screening (lib/leadPost/boardStore.ts `testPost`). GET lists
 * the vendor's test posts, theirs and ours, once 20261112100100 keeps them.
 */
const ROLES = ["owner"] as const;

const bodySchema = z
  .object({
    payload: z.record(z.string().min(1).max(120), z.unknown()).refine((value) => Object.keys(value).length <= 120, "Too many fields"),
    // The field map being edited, so "Fix and resend" tests the map before it is saved.
    fieldMap: z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)).optional(),
  })
  .strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("lead_import", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That is not a key id" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Send a test lead" }, { status: 400 });
  try {
    const result = await testPost({ tenantId: auth.context.tenantId, keyId: id, payload: parsed.data.payload, fieldMap: parsed.data.fieldMap ?? null });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The test could not run" }, { status: 400 });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That is not a key id" }, { status: 400 });
  try {
    return NextResponse.json({ tests: await testHistory(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tests didn't load" }, { status: 500 });
  }
}
