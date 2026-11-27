/**
 * The partner phone app's extra facts (board K1–K6, docs/qa/MOBILE-BOARD-GAPS.md section K), pure so
 * the rules are tested for what they promise. phoneFacts.ts reads the rows, always under the session's
 * own tenant and partner, and hands them here.
 *
 * What a partner may see and nothing more:
 *   - who took a transfer, by FIRST name only ("Jordan took it") — never the agent's full name, email
 *     or id;
 *   - when a callback is booked (the moment only — never the agent's note on it);
 *   - how many times the agency called and over which days (a count and two dates — never the
 *     outcome of each call);
 *   - how many agents are ready right now (a count — the agency already posts "agent ready" cards to
 *     every partner channel);
 *   - the next payout's date by the agency's own timer and the statement's per-unit lines.
 */

/** "Jordan" from "Jordan Reyes"; null for nothing usable. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, 40) : null;
}

export type QueueFact = { id: string; claimed_at: string | null; owner_user_id: string | null; claimed_by: string | null };
export type CallbackFact = { work_item_id: string; scheduled_at_utc: string };
export type LiveFact = { claimedBy: string | null; claimedAt: string | null; callbackAt: string | null };

/**
 * Per work item: the first name of whoever holds it (the owner, else whoever claimed it), when it was
 * claimed, and the earliest open callback. Work items with nothing to say are left out.
 */
export function liveFacts(queues: QueueFact[], names: Map<string, string>, callbacks: CallbackFact[]): Record<string, LiveFact> {
  const nextCallback = new Map<string, string>();
  for (const c of callbacks) {
    const seen = nextCallback.get(c.work_item_id);
    if (!seen || c.scheduled_at_utc < seen) nextCallback.set(c.work_item_id, c.scheduled_at_utc);
  }
  const out: Record<string, LiveFact> = {};
  for (const q of queues) {
    const holder = q.owner_user_id ?? q.claimed_by;
    const fact: LiveFact = {
      claimedBy: holder ? firstName(names.get(holder)) : null,
      claimedAt: q.claimed_at,
      callbackAt: nextCallback.get(q.id) ?? null,
    };
    if (fact.claimedBy || fact.claimedAt || fact.callbackAt) out[q.id] = fact;
  }
  return out;
}

export type AttemptSummary = { count: number; firstAt: string; lastAt: string };

/** "Called 3 times · 20–21 Nov": how many dialer attempts, the first and the last. Null for none. */
export function attemptSummary(attempts: Array<{ attempted_at: string }>): AttemptSummary | null {
  const times = attempts.map((a) => a.attempted_at).filter((t) => typeof t === "string" && t).sort();
  if (!times.length) return null;
  return { count: times.length, firstAt: times[0], lastAt: times[times.length - 1] };
}

/** Agents whose saved status is ready and whose heartbeat is fresh (the floor's own 60-second rule). */
export const READY_HEARTBEAT_MS = 60_000;
export function readyCount(rows: Array<{ status: string; last_seen_at: string | null }>, now: number = Date.now()): number {
  return rows.filter((r) => r.status === "ready" && r.last_seen_at && now - new Date(r.last_seen_at).getTime() <= READY_HEARTBEAT_MS).length;
}

/** The statement's per-unit item types, by the label payoutsCore gives each line (ITEM_LABELS). */
export type BreakdownLine = { itemType: string; count: number; rateCents: number };
export function breakdownLines(lines: Array<{ label: string; count: number; rateCents: number | null }>, labels: Record<string, string>): BreakdownLine[] {
  const byLabel = new Map(Object.entries(labels).map(([type, label]) => [label, type]));
  return lines.flatMap((l) => {
    const itemType = byLabel.get(l.label);
    return itemType && l.rateCents !== null && l.count > 0 ? [{ itemType, count: l.count, rateCents: l.rateCents }] : [];
  });
}
