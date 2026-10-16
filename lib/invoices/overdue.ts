// SA-3.7 · Moves issued invoices past their due date to overdue — the one call behind
// `npm run mark:overdue` (scripts/mark-overdue-invoices.mjs) and the scheduled
// /api/cron/invoices-overdue route. Idempotent: an invoice already overdue is not `issued`, so a
// second run the same day moves nothing.
//
// Deliberately NOT a reminder ladder — SA-3.5 stays cancelled; this makes the admin's overdue tile
// and filter tell the truth so a human can chase.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callable from the untyped script client too
export async function markOverdueInvoices(supabase: SupabaseClient<any>): Promise<number> {
  const { data, error } = await supabase.rpc("mark_overdue_invoices");
  if (error) throw new Error(`Could not mark overdue invoices: ${error.message}`);
  return typeof data === "number" ? data : Number(data ?? 0);
}
