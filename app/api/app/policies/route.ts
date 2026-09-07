import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** Reading the book of business — allowed even while suspended. */
export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, readOnly: auth.entitlement.access === "read_only", policies: [] });
}

/**
 * Creating a policy — the same feature, but `write: true`.
 *
 * This pair is the clearest expression of the doc's rule: a suspended tenant can GET this
 * endpoint and cannot POST to it. Suspend the doing, preserve the seeing.
 */
export async function POST() {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, created: true }, { status: 201 });
}
