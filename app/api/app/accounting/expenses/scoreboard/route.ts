import { NextResponse, type NextRequest } from "next/server";

import { ExpenseError, monthScoreboard } from "@/lib/accounting/expenseStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Expenses tracker (owner, 2026-11-06) · the end-of-month scoreboard: what the agency spent in a month,
 * in total and per bucket (leads, subscriptions, daily & random), with the biggest items. Owner and
 * bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  try {
    return NextResponse.json({ scoreboard: await monthScoreboard(auth.context.tenantId, month) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[expenses-scoreboard]", error);
    return NextResponse.json({ error: "The scoreboard could not be loaded" }, { status: 500 });
  }
}
