import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { switchedOffCarrierIds } from "@/lib/carriers/service";
import { getQueueSlaSettings } from "@/lib/queueSla/service";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { owedToYou } from "@/lib/discrepancies/service";
import { statementMoney } from "@/lib/ledger/statementConstants";
import type { ProducerScope } from "@/lib/agency/visibilityCore";

import { activitySentence, appointmentsSentence, callbacksSentence, carriersSentence, dialerSentence, inboundSentence, leadsSentence, policiesSentence, poolSentence, waitLabel } from "./summaryText";
import { scopeWithSelf, waitingTransferOr } from "./scope";
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
 *
 * AG-0.5 · producer isolation. `viewer.scope` is the session's producer scope (scopeFor, from the
 * session); null or no viewer = no filter, exactly as before. With a scope, only the three `shared`
 * tiles (the ones a narrow role is ever shown a figure for, lib/dashboard/tiles) are read, each over
 * what that session may see: callbacks assigned to its scope or to itself, the inbound transfers still
 * waiting or held in its scope, and the floor's members in its scope plus itself (as the Agent Floor
 * shows them). Every other figure is agency-wide by nature (the agency's leads, policies, statements,
 * pool, carriers, dials) and is null under a scope: the cell keeps its way in, without a number.
 */
export type TileViewer = { userId: string; scope: ProducerScope };
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
  in(column: string, values: readonly string[]): Filterable;
  or(filters: string): Filterable;
  not(column: string, op: string, value: unknown): Filterable;
  lt(column: string, value: string): Filterable;
  gte(column: string, value: string): Filterable;
  order(column: string, options: { ascending: boolean }): Filterable;
  limit(count: number): Filterable;
};

const db = () => getSupabaseServiceClient() as unknown as Loose;
const n = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, word: string) => `${n(value)} ${word}${value === 1 ? "" : "s"}`;

async function inbound(tenantId: string, held: ProducerScope = null): Promise<TileMetric> {
  // Inbound transfers are the queue rows a partner sent (partner_id set) that nobody has claimed.
  // AG-0.5: scoped, only those still waiting (anyone may claim them) or held in the scope.
  const visible = (query: Filterable) => (held === null ? query : query.or(waitingTransferOr(held)));
  const waiting = () => visible(db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "unclaimed").not("partner_id", "is", null));
  const sla = await getQueueSlaSettings(tenantId);
  const cutoff = new Date(Date.now() - sla.escalate_after_seconds * 1000).toISOString();
  const [all, past, oldest] = await Promise.all([
    waiting(),
    waiting().lt("queued_at", cutoff),
    visible(db().from("lead_queue").select("queued_at").eq("tenant_id", tenantId).eq("status", "unclaimed").not("partner_id", "is", null)).order("queued_at", { ascending: true }).limit(1),
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

async function floor(tenantId: string, members: ProducerScope = null): Promise<TileMetric> {
  // Who is on the floor right now: a presence row that heartbeat in the last minute and is not "off".
  // AG-0.5: scoped, only the members the Agent Floor shows this session (its scope and itself).
  let query = db().from("agent_presence").select("status, last_seen_at").eq("tenant_id", tenantId).gte("last_seen_at", new Date(Date.now() - 60_000).toISOString());
  if (members !== null) query = query.in("user_id", members);
  const rows = await query;
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
 * read, no ledger recompute. The figure is the Discrepancies page's own (statementMoney, to the
 * cent), so the two never disagree.
 *
 * It never claims $0 without something behind it:
 *   · no statement stands yet          → "—", import one;
 *   · statements, none reviewed yet,
 *     and nothing found                → "—", review them (an unreviewed statement's lines are still
 *                                        proposals, so "everything agrees" would be unchecked);
 *   · reviewed, nothing found          → $0.00, every reviewed statement agrees.
 */
async function owed(tenantId: string): Promise<TileMetric> {
  const [statements, totals] = await Promise.all([
    db().from("tenant_commission_statements").select("status").eq("tenant_id", tenantId).not("status", "eq", "voided").limit(5000),
    owedToYou(tenantId),
  ]);
  if (statements.error) throw new Error("owed summary unavailable");
  const standing = (statements.data ?? []) as Array<{ status: string }>;
  if (!totals.available || standing.length === 0) {
    return { value: 0, display: "—", caption: "import a statement", detail: "Import a carrier statement to see what the carrier paid against what your contract says it owes." };
  }
  const reviewed = standing.filter((row) => row.status === "reviewed").length;
  if (!totals.count && reviewed === 0) {
    const waiting = standing.length;
    return { value: 0, display: "—", caption: "review your statement", detail: `Review the lines on your ${waiting === 1 ? "statement" : `${n(waiting)} statements`} to see what the carrier paid against what your contract says it owes.` };
  }
  const dollars = statementMoney(totals.totalCents);
  const parts = [
    totals.byKind.never_paid.count ? `${n(totals.byKind.never_paid.count)} never paid` : null,
    totals.byKind.short_paid.count + totals.byKind.mis_rated.count ? `${n(totals.byKind.short_paid.count + totals.byKind.mis_rated.count)} paid short` : null,
    totals.byKind.duplicate_chargeback.count + totals.byKind.unexpected_chargeback.count ? `${n(totals.byKind.duplicate_chargeback.count + totals.byKind.unexpected_chargeback.count)} chargebacks to dispute` : null,
  ].filter(Boolean);
  return {
    value: totals.totalCents,
    display: dollars,
    caption: totals.count ? plural(totals.count, "item") : "nothing found",
    detail: totals.count ? `You appear to be owed ${dollars}: ${parts.join(", ")}.` : `Every statement you reviewed agrees with your contract${reviewed < standing.length ? `; ${n(standing.length - reviewed)} still to review` : ""}.`,
    tone: totals.count ? "warning" : "good",
  };
}

async function callbacks(tenantId: string, assigned: ProducerScope = null): Promise<TileMetric> {
  // AG-0.5: scoped, the callbacks assigned to the scope or the reader (D1: assigned_to).
  const due = await listDueCallbacks(tenantId, assigned);
  const overdue = due.filter((item) => item.isOverdue).length;
  return { value: due.length, caption: overdue ? `${n(overdue)} overdue` : "due today", detail: callbacksSentence(due.length - overdue, overdue), tone: overdue ? "danger" : undefined };
}

async function carriers(tenantId: string): Promise<TileMetric> {
  const [active, switchedOff] = await Promise.all([
    db().from("tenant_carriers").select("carrier_id").eq("tenant_id", tenantId).eq("is_active", true),
    switchedOffCarrierIds(tenantId),
  ]);
  if (active.error) throw new Error("carriers summary unavailable");
  // LA-0.4: a carrier the agency switched off is not active.
  const count = ((active.data ?? []) as Array<{ carrier_id: string }>).filter((row) => !switchedOff.has(row.carrier_id)).length;
  return { value: count, caption: "active carriers", detail: carriersSentence(count) };
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

/** AG-0.5: the figures that can be read under a producer scope, each over what the session may see. */
const SCOPED_READERS: Record<string, (tenantId: string, visible: readonly string[]) => Promise<TileMetric>> = {
  "work.callbacks": callbacks,
  "work.inbound": inbound,
  "work.floor": floor,
};

export async function tileMetric(key: string, tenantId: string, viewer?: TileViewer): Promise<TileMetric | null> {
  const scope = viewer?.scope ?? null;
  try {
    if (viewer && scope !== null) {
      // A narrow session in an agency: the three shared figures, narrowed; nothing agency-wide.
      const scoped = SCOPED_READERS[key];
      return scoped ? await scoped(tenantId, scopeWithSelf(scope, viewer.userId) ?? []) : null;
    }
    const read = READERS[key];
    if (!read) return null;
    return await read(tenantId);
  } catch {
    return null;
  }
}
