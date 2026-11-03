import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { checkCallbackInCallingWindow } from "@/lib/dispositions/callbackWindow";
import { customerLocalValue, nearestLegalTime } from "./nearest";
import { rescheduleCallback } from "./service";

/**
 * Clear the overdue pile (Callbacks A, owner pick 2026-10-28): book many callbacks into the next open
 * times, each inside its own customer's calling window, with no hour holding more than the agent set.
 *
 * Two steps, so nothing is booked by surprise: `planSpread` works the times out and books nothing;
 * `commitSpread` books the plan the agent saw, one callback at a time through the same window check
 * and reschedule_callback every other move uses. A time that stopped being legal in between is
 * refused for that callback alone and reported.
 *
 * Each candidate time comes from next_callable_instant (nearestLegalTime), which weighs the state's
 * window, Sundays, holidays and the campaign, so a planned time is one the booking accepts.
 */

const HOUR = 3_600_000;
/** How many hours forward one callback may be pushed looking for a free hour before it is reported. */
const MAX_TRIES = 60;

export type SpreadItem = { callbackId: string; utc: string; customerLocal: string };
export type SpreadMiss = { callbackId: string; reason: string };
export type SpreadPlan = { placed: SpreadItem[]; missed: SpreadMiss[] };

type Row = { id: string; lead_id: string; customer_timezone: string; status: string; assigned_to: string | null };

export async function planSpread(input: { tenantId: string; userId: string; callbackIds: string[]; days: number; perHour: number; now?: number }): Promise<SpreadPlan> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("tenant_callbacks").select("id, lead_id, customer_timezone, status, assigned_to, scheduled_at_utc").eq("tenant_id", input.tenantId).in("id", input.callbackIds);
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as Array<Row & { scheduled_at_utc: string }>).map((row) => [row.id, row]));
  const now = input.now ?? Date.now();
  // A quarter past at the earliest: times land on the quarter hour, not "in 5 minutes".
  const start = Math.ceil((now + 5 * 60_000) / (15 * 60_000)) * 15 * 60_000;
  const end = start + input.days * 24 * HOUR;

  // Hours already holding this agent's open callbacks count towards the cap.
  const counts = new Map<number, number>();
  const busy = await supabase.from("tenant_callbacks").select("scheduled_at_utc").eq("tenant_id", input.tenantId).eq("assigned_to", input.userId).in("status", ["scheduled", "due"]).gte("scheduled_at_utc", new Date(start).toISOString()).lt("scheduled_at_utc", new Date(end).toISOString());
  for (const row of (busy.data ?? []) as Array<{ scheduled_at_utc: string }>) {
    const key = Math.floor(Date.parse(row.scheduled_at_utc) / HOUR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const placed: SpreadItem[] = [];
  const missed: SpreadMiss[] = [];
  // Oldest promise first: it has waited longest.
  const ordered = input.callbackIds.map((id) => byId.get(id)).filter((row): row is Row & { scheduled_at_utc: string } => Boolean(row)).sort((a, b) => a.scheduled_at_utc.localeCompare(b.scheduled_at_utc));
  for (const id of input.callbackIds) if (!byId.has(id)) missed.push({ callbackId: id, reason: "Not found" });
  // In rounds: every callback still to place asks for its next legal time at once (a few at a time),
  // then they are placed oldest first; one that finds its hour full tries from the next hour in the
  // next round. One request per callback per round, not one after another.
  let pending = ordered.filter((row) => {
    if (["scheduled", "due", "missed"].includes(row.status)) return true;
    missed.push({ callbackId: row.id, reason: "Already settled" });
    return false;
  }).map((row) => ({ row, from: start }));
  const dayCap = Math.max(1, Math.ceil(pending.length / input.days));
  const perDay = new Map<number, number>();
  for (let round = 0; round < MAX_TRIES && pending.length; round += 1) {
    const answers = await inBatches(pending, 8, (item) => nearestLegalTime({ tenantId: input.tenantId, leadId: item.row.lead_id, fromUtc: new Date(item.from).toISOString(), timezone: item.row.customer_timezone }));
    const next: typeof pending = [];
    pending.forEach((item, index) => {
      const legal = answers[index];
      if (!legal) { missed.push({ callbackId: item.row.id, reason: "No legal time found (the lead may have no state)" }); return; }
      const at = Date.parse(legal.utc);
      if (at >= end) { missed.push({ callbackId: item.row.id, reason: `No open time in the next ${input.days} ${input.days === 1 ? "day" : "days"}` }); return; }
      // Even over the span: no 24-hour stretch takes more than its share.
      const dayIndex = Math.floor((at - start) / (24 * HOUR));
      if ((perDay.get(dayIndex) ?? 0) >= dayCap) { next.push({ row: item.row, from: start + (dayIndex + 1) * 24 * HOUR }); return; }
      const key = Math.floor(at / HOUR);
      const taken = counts.get(key) ?? 0;
      if (taken >= input.perHour) { next.push({ row: item.row, from: (key + 1) * HOUR }); return; }
      perDay.set(dayIndex, (perDay.get(dayIndex) ?? 0) + 1);
      // Spaced inside the hour, never before the legal time.
      const spaced = Math.max(at, key * HOUR + Math.floor((taken * 60) / input.perHour) * 60_000);
      const utc = new Date(Math.ceil(spaced / 60_000) * 60_000).toISOString();
      counts.set(key, taken + 1);
      placed.push({ callbackId: item.row.id, utc, customerLocal: customerLocalValue(utc, item.row.customer_timezone) });
    });
    pending = next;
  }
  for (const item of pending) missed.push({ callbackId: item.row.id, reason: "Every open hour is full; raise the number per hour" });
  placed.sort((a, b) => a.utc.localeCompare(b.utc));
  return { placed, missed };
}

/** `work` over `items`, at most `size` at a time, answers in the items' order. */
async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += size) out.push(...await Promise.all(items.slice(at, at + size).map(work)));
  return out;
}

/** Book a plan, one callback at a time; each is checked against its window again first. */
export async function commitSpread(input: { tenantId: string; userId: string; items: Array<{ callbackId: string; customerLocal: string }>; request: Request }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("tenant_callbacks").select("id, lead_id, customer_timezone").eq("tenant_id", input.tenantId).in("id", input.items.map((item) => item.callbackId));
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as Array<{ id: string; lead_id: string; customer_timezone: string }>).map((row) => [row.id, row]));
  // A few at a time: each callback is its own row and its own reschedule.
  const outcomes = await inBatches(input.items, 5, async (item): Promise<SpreadMiss | null> => {
    const row = byId.get(item.callbackId);
    if (!row) return { callbackId: item.callbackId, reason: "Not found" };
    try {
      const window = await checkCallbackInCallingWindow({ tenantId: input.tenantId, leadId: row.lead_id, callbackLocal: item.customerLocal, timezone: row.customer_timezone, actorId: input.userId });
      if (!window.ok) return { callbackId: item.callbackId, reason: window.message };
      await rescheduleCallback({ tenantId: input.tenantId, userId: input.userId, callbackId: item.callbackId, local: item.customerLocal, request: input.request });
      return null;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not be moved";
      return { callbackId: item.callbackId, reason: message.startsWith("CALLBACK_NOT_YOURS") ? "Someone else's callback" : message.startsWith("CALLBACK_") ? "Cannot be moved in its current state" : message };
    }
  });
  const failed = outcomes.filter((miss): miss is SpreadMiss => miss !== null);
  return { booked: input.items.length - failed.length, failed };
}
