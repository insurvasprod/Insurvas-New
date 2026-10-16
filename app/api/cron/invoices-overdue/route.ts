import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { markOverdueInvoices } from "@/lib/invoices/overdue";

/**
 * SA-3.7 · Moves issued invoices past their due date to overdue (daily; pg_cron calls it through
 * call_app_cron, 20261015500000). The same call as `npm run mark:overdue`; idempotent, since an
 * overdue invoice is no longer `issued`.
 *
 * Same shape as /api/cron/period-billing. Fails closed: with no CRON_SECRET set this answers 401
 * to everybody, including the scheduler.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const moved = await markOverdueInvoices(getSupabaseServiceClient());
    return NextResponse.json({ moved });
  } catch (error) {
    console.error("[cron/invoices-overdue]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Marking overdue invoices failed" }, { status: 500 });
  }
}
