import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readBalances, readProducerEntries, syncLedger } from "@/lib/agency/ledgerStore";
import { readRuns } from "@/lib/agency/payoutStore";
import { rowVisible, scopeFor } from "@/lib/agency/visibility";
import { NO_STORE } from "@/lib/agency/http";

/** AG-1.5 / AG-1.8 · a producer's own pay: his balance by basis, every entry, every statement. */
export async function GET() {
  const auth = await requireFeatureRole("producer_payouts", ["producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  await syncLedger(auth.context.tenantId).catch(() => 0);
  const scope = await scopeFor(auth.context);
  const [balances, entries, runs] = await Promise.all([
    readBalances(auth.context),
    readProducerEntries(auth.context.tenantId, auth.context.userId),
    readRuns(auth.context.tenantId, auth.context.userId),
  ]);
  return NextResponse.json({
    balances: balances.rows.filter((b) => b.producerUserId === auth.context.userId),
    entries,
    // belt and braces: only runs the session may see (for a producer, his own)
    runs: runs.filter((r) => r.producerUserId === auth.context.userId && rowVisible(scope, r.producerUserId)),
  }, { headers: NO_STORE });
}
