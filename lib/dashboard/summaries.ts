import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getQueueSlaSettings } from "@/lib/queueSla/service";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { owedToYou } from "@/lib/discrepancies/service";

import { activitySentence, appointmentsSentence, callbacksSentence, carriersSentence, dialerSentence, inboundSentence, leadsSentence, policiesSentence, poolSentence, waitLabel } from "./summaryText";
import { NOT_A_CONTACT } from "./todayMath";

/**
 * The live figure behind each cell of the dashboard's metrics grid, one per registered tile. Each
 * is a head count or a single row, scoped to the tenant, and runs only for a tile the viewer can
 * see — the page renders the grid first and streams these figures in, so the one-second budget is
 * spent on the page, not on these.
 *
 * A figure is the number, a two- or three-word caption under it, and the full sentence
 * (summaryText) as the cell's hover text. Null for a tile with no figure, or when the read fails:
 * the cell then says "—" rather than showing a number it could not get.
 */
export type TileMetric = {
  value: number;
  caption: string;
  detail: string;
  tone?: "danger" | "warning" | "good";
  /** The figure as shown, when it is not a plain count — money, say ("$3,412"). */
  display?: string;
};

type Head = PromiseLike<{ count: number | null; error: { message: string } | null }>;
type Loose = {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): Filterable;
  };
};
type Filterable = Head & PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count: number | null }> & {
  eq(column: string, value: unknown): Filterable;
  is(column: string, value: null): Filterable;
  not(column: string, op: string, value: unknown): Filterable;
  lt(column: string, value: string): Filterable;
  gte(column: string, value: string): Filterable;
  order(column: string, options: { ascending: boolean }): Filterable;
  limit(count: number): Filterable;
};

const db = () => getSupabaseServiceClient() as unknown as Loose;
const n = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, word: string) => `${n(value)} ${word}${value === 1 ? "" : "s"}`;

async function inbound(tenantId: string): Promise<TileMetric> {
  // Inbound transfers are the queue rows a partner sent (partner_id set) that nobody has claimed.
  const waiting = () => db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "unclaimed").not("partner_id", "is", null);
  const sla = await getQueueSlaSettings(tenantId);
  const cutoff = new Date(Date.now() - sla.escalate_after_seconds * 1000).toISOString();
  const [all, past, oldest] = await Promise.all([
    waiting(),
    waiting().lt("queued_at", cutoff),
    db().from("lead_queue").select("queued_at").eq("tenant_id", tenantId).eq("status", "unclaimed").not("partner_id", "is", null).order("queued_at", { ascending: true }).limit(1),
  ]);
  if (all.error || past.error || oldest.error) throw new Error("inbound summary unavailable");
  const first = ((oldest.data ?? []) as Array<{ queued_at: string }>)[0];
  const longestSeconds = first ? (Date.now() - Date.parse(first.queued_at)) / 1000 : null;
  const pastSla = past.count ?? 0;
  return {
    value: all.count ?? 0,
    caption: pastSla ? `${n(pastSla)} past SLA` : longestSeconds !== null ? `longest ${waitLabel(longestSeconds)}` : "waiting now",
    detail: inboundSentence({ waiting: all.count ?? 0, longestSeconds, pastSla, slaSeconds: sla.escalate_after_seconds }),
    tone: pastSla ? "danger" : undefined,
  };
}

async function floor(tenantId: string): Promise<TileMetric> {
  // Who is on the floor right now: a presence row that heartbeat in the last minute and is not "off".
  const rows = await db().from("agent_presence").select("status, last_seen_at").eq("tenant_id", tenantId).gte("last_seen_at", new Date(Date.now() - 60_000).toISOString());
  if (rows.error) throw new Error("floor summary unavailable");
  const live = ((rows.data ?? []) as Array<{ status: string }>).filter((row) => row.status !== "off");
  const ready = live.filter((row) => row.status === "ready").length;
  const onCall = live.filter((row) => row.status === "on_call").length;
  return {
    value: live.length,
    caption: `${ready} ready · ${onCall} on call`,
    detail: live.length ? `${plural(live.length, "agent")} on the floor: ${ready} ready, ${onCall} on a call.` : "Nobody is on the floor right now.",
  };
}

async function dialer(tenantId: string): Promise<TileMetric> {
  // Outbound: unclaimed rows no partner sent. Whether each is callable this minute is the dialer's
  // own answer (calling window, cadence, preflight); this counts what is waiting, and says so.
  const ready = await db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "unclaimed").is("partner_id", null);
  if (ready.error) throw new Error("dialer summary unavailable");
  return { value: ready.count ?? 0, caption: "ready to dial", detail: dialerSentence(ready.count ?? 0) };
}

async function leads(tenantId: string): Promise<TileMetric> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [total, recent] = await Promise.all([
    db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", weekAgo),
  ]);
  if (total.error || recent.error) throw new Error("leads summary unavailable");
  const added = recent.count ?? 0;
  return { value: total.count ?? 0, caption: `+${n(added)} this week`, detail: leadsSentence(added, total.count ?? 0), tone: added ? "good" : undefined };
}

async function policies(tenantId: string): Promise<TileMetric> {
  const [total, active] = await Promise.all([
    db().from("tenant_policies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db().from("tenant_policies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active"),
  ]);
  if (total.error || active.error) throw new Error("policies summary unavailable");
  return { value: total.count ?? 0, caption: `${n(active.count ?? 0)} active`, detail: policiesSentence(total.count ?? 0) };
}

async function ledger(tenantId: string): Promise<TileMetric> {
  const [all, review] = await Promise.all([
    db().from("tenant_commission_statements").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("status", "eq", "voided"),
    db().from("tenant_commission_statements").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "review"),
  ]);
  if (all.error || review.error) throw new Error("ledger summary unavailable");
  const total = all.count ?? 0;
  const waiting = review.count ?? 0;
  return {
    value: total,
    caption: waiting ? `${n(waiting)} to review` : "statements",
    detail: `${plural(total, "carrier statement")} imported${waiting ? `, ${n(waiting)} waiting for review.` : "."}`,
    tone: waiting ? "warning" : undefined,
  };
}

/**
 * LA-4.6 · "Owed to you": the open and disputed discrepancies, summed from their stored rows — one
 * read, no ledger recompute. Before any statement is imported there is nothing to compare, so the
 * cell says what to do next rather than claiming $0.
 */
async function owed(tenantId: string): Promise<TileMetric> {
  const [statements, totals] = await Promise.all([
    db().from("tenant_commission_statements").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("status", "eq", "voided"),
    owedToYou(tenantId),
  ]);
  if (statements.error) throw new Error("owed summary unavailable");
  if (!totals.available || (statements.count ?? 0) === 0) {
    return { value: 0, display: "—", caption: "import a statement", detail: "Import a carrier statement to see what the carrier paid against what your contract says it owes." };
  }
  const dollars = `$${Math.round(totals.totalCents / 100).toLocaleString("en-US")}`;
  const parts = [
    totals.byKind.never_paid.count ? `${n(totals.byKind.never_paid.count)} never paid` : null,
    totals.byKind.short_paid.count + totals.byKind.mis_rated.count ? `${n(totals.byKind.short_paid.count + totals.byKind.mis_rated.count)} paid short` : null,
    totals.byKind.duplicate_chargeback.count + totals.byKind.unexpected_chargeback.count ? `${n(totals.byKind.duplicate_chargeback.count + totals.byKind.unexpected_chargeback.count)} chargebacks to dispute` : null,
  ].filter(Boolean);
  return {
    value: totals.totalCents,
    display: dollars,
    caption: totals.count ? plural(totals.count, "item") : "nothing found",
    detail: totals.count ? `You appear to be owed ${dollars}: ${parts.join(", ")}.` : "Every accepted statement line agrees with your contract.",
    tone: totals.count ? "warning" : "good",
  };
}

async function callbacks(tenantId: string): Promise<TileMetric> {
  const due = await listDueCallbacks(tenantId);
  const overdue = due.filter((item) => item.isOverdue).length;
  return { value: due.length, caption: overdue ? `${n(overdue)} overdue` : "due today", detail: callbacksSentence(due.length - overdue, overdue), tone: overdue ? "danger" : undefined };
}

async function carriers(tenantId: string): Promise<TileMetric> {
  const active = await db().from("tenant_carriers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true);
  if (active.error) throw new Error("carriers summary unavailable");
  return { value: active.count ?? 0, caption: "active carriers", detail: carriersSentence(active.count ?? 0) };
}

async function appointments(tenantId: string): Promise<TileMetric> {
  // Agency appointments still in force: not terminated. The states are counted from the same rows.
  const rows = await db().from("appointments").select("state").eq("tenant_id", tenantId).is("terminated_at", null).limit(2000);
  if (rows.error) throw new Error("appointments summary unavailable");
  const list = (rows.data ?? []) as Array<{ state: string }>;
  const states = new Set(list.map((row) => row.state)).size;
  return { value: list.length, caption: `across ${plural(states, "state")}`, detail: appointmentsSentence(list.length, states) };
}

async function assignments(tenantId: string): Promise<TileMetric> {
  // The pool: outbound rows nobody owns yet (the Lead assignment page's "unassigned").
  const unowned = await db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "unclaimed").is("partner_id", null).is("owner_user_id", null);
  if (unowned.error) throw new Error("assignments summary unavailable");
  return { value: unowned.count ?? 0, caption: "unassigned in pool", detail: poolSentence(unowned.count ?? 0), tone: unowned.count ? "warning" : undefined };
}

async function activity(tenantId: string): Promise<TileMetric> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const attempts = () => db().from("tenant_call_attempts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("attempted_at", weekAgo);
  const [dials, reached] = await Promise.all([
    attempts(),
    attempts().not("disposition", "is", null).not("disposition", "in", `(${NOT_A_CONTACT.join(",")})`),
  ]);
  if (dials.error || reached.error) throw new Error("activity summary unavailable");
  const total = dials.count ?? 0;
  const rate = total ? `${((Math.min(reached.count ?? 0, total) / total) * 100).toFixed(1)}% reached` : "none this week";
  return { value: total, caption: `dials · ${rate}`, detail: activitySentence(total, reached.count ?? 0) };
}

const READERS: Record<string, (tenantId: string) => Promise<TileMetric>> = {
  "setup.carriers": carriers,
  "setup.appointments": appointments,
  "work.assignments": assignments,
  "insight.activity": activity,
  "work.callbacks": callbacks,
  "work.inbound": inbound,
  "work.floor": floor,
  "work.dialer": dialer,
  "work.leads": leads,
  "book.policies": policies,
  "book.ledger": ledger,
  "book.owed": owed,
};

/** LA-4.6 · whether any carrier statement stands (not voided): the setup checklist's statement step. One head count. */
export async function hasImportedStatement(tenantId: string): Promise<boolean> {
  try {
    const { count, error } = await db().from("tenant_commission_statements").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("status", "eq", "voided");
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function tileMetric(key: string, tenantId: string): Promise<TileMetric | null> {
  const read = READERS[key];
  if (!read) return null;
  try {
    return await read(tenantId);
  } catch {
    return null;
  }
}
