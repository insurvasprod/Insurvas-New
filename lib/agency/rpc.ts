import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";

/**
 * Agency Module 0 · one way to call the agency's SQL functions and turn their refusals into words a person can
 * act on. Every refusal code raised by the AG migrations is listed here once.
 */

export class AgencyRefusal extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "AgencyRefusal";
  }
}

const REFUSALS: Array<[RegExp, string, string, number]> = [
  [/split_must_total_10000:(\d+)/, "split_total", "Shares must add up to exactly 100%.", 400],
  [/split_share_positive/, "split_share", "Every share must be more than 0%.", 400],
  [/split_writer_missing/, "split_writer", "The writing producer must keep a share of his own policy.", 400],
  [/split_not_a_producer/, "split_producer", "Everyone in a split must be a producer in your agency.", 400],
  [/split_duplicate_producer/, "split_duplicate", "A producer appears twice in this split.", 400],
  [/attribution_not_a_producer/, "not_a_producer", "Give the row to a producer in your agency.", 400],
  [/attribution_reason_required/, "reason_required", "Say why, so the audit shows who decided and on what.", 400],
  [/attribution_item_not_open/, "not_open", "Someone already resolved this row.", 409],
  [/payout_method_required/, "method_required", "Enter how and when you paid.", 400],
  [/payout_no_producers/, "no_producers", "Choose at least one producer to pay.", 400],
  [/payout_amount_required/, "amount_required", "Enter the amount to pay.", 400],
  [/payout_not_a_producer/, "not_a_producer", "Only producers in your agency can be paid.", 400],
  [/a run already covers part of this period|producer_run_one_live/, "already_run", "This period is already paid for one of these producers. Nothing was paid twice.", 409],
  [/variance_note_required/, "note_required", "Write what you found.", 400],
  [/variance_not_open/, "not_open", "Someone already reviewed this.", 409],
  [/review_not_queued/, "not_open", "Someone already reviewed this application.", 409],
  [/review_status_unknown/, "bad_status", "Choose pass, fail or fix and resubmit.", 400],
  [/application_review_outcome/, "needs_note", "A fail or a fix needs an error type and a note.", 400],
  [/agency_plan_required/, "agency_plan_required", "This needs an agency plan.", 409],
];

export function toRefusal(error: { code?: string; message?: string }): Error {
  const message = error.message ?? "";
  for (const [pattern, code, text, status] of REFUSALS) if (pattern.test(message)) return new AgencyRefusal(text, code, status);
  if (error.code === "PGRST202" || error.code === "42883" || isPendingSchema(error as { code?: string; message: string })) {
    return new AgencyRefusal("This needs the agency database update that has not been applied yet.", "schema_pending", 503);
  }
  return new Error(message);
}

type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

export async function agencyRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (getSupabaseServiceClient() as unknown as Rpc).rpc(name, args);
  if (error) throw toRefusal(error);
  return data as T;
}

/** The route's answer for a thrown store error: a refusal in words, or rethrow. */
export function refusalResponse(error: unknown): NextResponse {
  if (error instanceof AgencyRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  throw error;
}
