import "server-only";

import { guardPage, type PageGuardResult } from "@/lib/entitlements/guardPage";

import type { NeedsYouScope } from "./store";

/**
 * Who is looking, as Needs you reads it: the owner and bookkeepers keep the whole list (as on Exceptions and
 * Policy matching); Money and Credit also need their own features on the plan, as their APIs require.
 */
export async function needsYouScope(guard: PageGuardResult): Promise<NeedsYouScope> {
  const keeper = guard.role === "owner" || guard.role === "bookkeeper";
  const [money, credit] = keeper ? await Promise.all([guardPage("discrepancy_report"), guardPage("producer_payouts")]) : [null, null];
  return { tenantId: guard.context.tenantId, userId: guard.context.userId, keeper, money: Boolean(money?.entitled), credit: Boolean(credit?.entitled) };
}
