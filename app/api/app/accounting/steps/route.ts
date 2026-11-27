import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import type { AccountingStepCounts } from "@/lib/accounting/steps";
import { loadTodo } from "@/lib/accounting/todoStore";
import { todoCounts } from "@/lib/accounting/todoCore";

/**
 * The live counts on the Accounting rail (round 7, owner 2026-11-10): what waits on a person, per step, read from
 * the same list Accounting › To do shows, so a badge and the page never disagree. Never an amount. Under the gate
 * its steps share (profit_and_loss, owner and bookkeeper). A source that fails is left out of its step's count.
 *
 *   todo      everything below together (partner payout drafts count once: one job)
 *   bank      carrier payments with bad math or missing money, and deposits to match
 *   bills     vendor bills to finish, approve, close a dispute on, or pay
 *   expenses  monthly bills that came back and wait for an OK
 *   tax       payees over the 1099 threshold missing a W-9, tax ID or legal name
 */
const ROLES = ["owner", "bookkeeper"] as const;

/**
 * `?items=1` (the phone's Money tab, release 3 board G3): the same To do rows Accounting › To do draws, oldest first,
 * beside the counts, so the phone lists what waits without a second reading of every source. Same gate, same groups.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const tenantId = auth.context.tenantId;
  // The feature check already read the plan: no second trip for it.
  const features = auth.entitlement.features;
  const payouts = features.includes("payout_runs");
  const tax = features.includes("tax_summaries");
  const { items, failed } = await loadTodo(tenantId, { bank: true, bills: true, expenses: true, payouts, tax });
  const n = todoCounts(items);
  const counts: AccountingStepCounts = { todo: n.all };
  for (const key of ["bank", "bills", "expenses", "tax"] as const) if (!failed.includes(key)) counts[key] = n[key];
  const withItems = request.nextUrl.searchParams.get("items") === "1";
  return NextResponse.json(withItems ? { counts, items, failed } : { counts }, { headers: { "Cache-Control": "no-store" } });
}
