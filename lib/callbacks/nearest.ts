import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The nearest legal time after a refused callback time (LA-1 §6.3): "The nearest legal time is
 * 8:00 AM his time, which is 11:00 AM yours." A suggestion the agent can take with "Use that" —
 * never booked here.
 *
 * The answer is next_callable_instant (20260925708600), which walks tenant_can_dial_now — the same
 * function the booking and the dialer enforce — so a suggested time is one the booking will accept.
 * Before that migration is applied (42883 / PGRST202) there is no suggestion, and the refusal reads
 * exactly as it did.
 */
export type NearestLegalTime = { utc: string; customerLocal: string };

/** "YYYY-MM-DDTHH:mm" on the customer's clock, the shape the booking takes. */
export function customerLocalValue(utc: string | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(utc));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour === "24" ? "00" : value.hour}:${value.minute}`;
}

/** Five minutes from now at the earliest, so a suggestion is still in the future when it is taken. */
const LEAD_TIME_MS = 5 * 60_000;

export async function nearestLegalTime(input: { tenantId: string; leadId: string; fromUtc: string | null; timezone: string }): Promise<NearestLegalTime | null> {
  const floor = Date.now() + LEAD_TIME_MS;
  const requested = input.fromUtc ? Date.parse(input.fromUtc) : NaN;
  const from = new Date(Number.isFinite(requested) ? Math.max(requested, floor) : floor).toISOString();
  try {
    const client = getSupabaseServiceClient();
    // Bound: rpc reads `this`. Loose: the generated types do not know this function yet.
    const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
    const result = await rpc("next_callable_instant", { p_tenant_id: input.tenantId, p_lead_id: input.leadId, p_from: from, p_until: null });
    if (result.error || typeof result.data !== "string") return null;
    return { utc: new Date(result.data).toISOString(), customerLocal: customerLocalValue(result.data, input.timezone) };
  } catch {
    return null;
  }
}
