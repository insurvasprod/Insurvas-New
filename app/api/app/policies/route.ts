import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/entitlements/requireFeature";

/** Reading the book of business — allowed even while suspended. */
export async function GET() {
  const auth = await requireFeature("book_of_business");
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
  const auth = await requireFeature("book_of_business", { write: true });
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, created: true }, { status: 201 });
}
