import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getEntitlement } from "@/lib/entitlements/get";
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

export async function GET() {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const tenantId = auth.context.tenantId;
  const features = await getEntitlement(tenantId).then((e) => e.features, () => [] as string[]);
  const payouts = features.includes("payout_runs");
  const tax = features.includes("tax_summaries");
  const { items, failed } = await loadTodo(tenantId, { bank: true, bills: true, expenses: true, payouts, tax });
  const n = todoCounts(items);
  const counts: AccountingStepCounts = { todo: n.all };
  for (const key of ["bank", "bills", "expenses", "tax"] as const) if (!failed.includes(key)) counts[key] = n[key];
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
