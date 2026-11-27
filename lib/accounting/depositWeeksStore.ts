import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { BANK_PENDING_MESSAGE, BankError } from "./bankStore";
import { depositWeeks, monthSpan, type DepositWeeks } from "./depositWeeksCore";

/**
 * Reads this tenant's deposits for one month (bank_transaction, amount_cents > 0) and sums them by week for the
 * bookkeeper's "Cash this month" (mobile board B6). Only reads. The service client has no RLS, so every read names
 * the tenant.
 */
// bank_transaction is not in the generated types yet; bankStore reads it the same way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const PAGE = 1000;
const MAX_PAGES = 50;

export async function loadDepositWeeks(tenantId: string, month: string, today: string | null): Promise<DepositWeeks> {
  const span = monthSpan(month, today);
  const rows: { posted_on: string; amount_cents: number }[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await db()
      .from("bank_transaction")
      .select("id, posted_on, amount_cents")
      .eq("tenant_id", tenantId)
      .gt("amount_cents", 0)
      .gte("posted_on", span.from)
      .lte("posted_on", span.through)
      .order("posted_on", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      if (isSchemaGap(error)) throw new BankError(BANK_PENDING_MESSAGE, 503);
      throw new Error(error.message);
    }
    const got = (data ?? []) as { posted_on: string; amount_cents: number }[];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return depositWeeks(month, today, rows);
}
