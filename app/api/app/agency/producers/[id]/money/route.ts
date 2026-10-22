import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { guardProducer } from "@/lib/agency/guards";
import { readBalances, readProducerEntries, syncLedger } from "@/lib/agency/ledgerStore";
import { readRuns } from "@/lib/agency/payoutStore";
import { NO_STORE, refuseManagerMoney } from "@/lib/agency/http";

/**
 * AG-1.1 Money tab · one producer's payable ledger (every entry with its basis) and his statements. Hidden from a
 * manager (he sees production, not pay) and absent for an assistant. A producer opens his own.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  // the guard and the record are read together; nothing of the record is used before the guard has passed
  const [hidden, { data: producer }] = await Promise.all([
    guardProducer(auth.context, id),
    getSupabaseServiceClient().from("producer" as never).select("user_id").eq("tenant_id", auth.context.tenantId).eq("id", id).maybeSingle<{ user_id: string }>(),
  ]);
  if (hidden) return hidden;
  if (!producer) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const refused = refuseManagerMoney(auth.context, producer.user_id);
  if (refused) return refused;
  await syncLedger(auth.context.tenantId).catch(() => 0);
  const [balances, entries, runs] = await Promise.all([
    readBalances(auth.context),
    readProducerEntries(auth.context.tenantId, producer.user_id),
    readRuns(auth.context.tenantId, producer.user_id),
  ]);
  return NextResponse.json({ balances: balances.rows.filter((b) => b.producerUserId === producer.user_id), entries, runs }, { headers: NO_STORE });
}
