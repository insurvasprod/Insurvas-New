import { NextResponse } from "next/server";

import { quoteCatalog } from "@/lib/applications/catalog";
import { actorOf, failure } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const PRODUCT_LINES = new Set(["final_expense", "whole_life", "term_life"]);

/**
 * LA-3.4/3.6 · Quick quote (the phone's board E1): the carriers and products this agency can quote for
 * a client in `?state=` (two letters) on `?product=` (final_expense by default), with appointment
 * status — the same read the case's Quote step makes (lib/applications/catalog.ts quoteCatalog),
 * without a case. Read-only; no commission, contract level or premium figure is in this payload (the
 * platform holds no premium rate tables: premiums are typed from each carrier's own quote tool).
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("quoting", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const url = new URL(request.url);
  const state = (url.searchParams.get("state") ?? "").trim().toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) return NextResponse.json({ error: "Give the state as two letters, like GA.", code: "invalid_request" }, { status: 400 });
  const product = url.searchParams.get("product") ?? "final_expense";
  if (!PRODUCT_LINES.has(product)) return NextResponse.json({ error: "Quick quote covers final expense, whole life and term.", code: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json(await quoteCatalog(actor.tenantId, state || null, product));
  } catch (error) {
    return failure(error);
  }
}
