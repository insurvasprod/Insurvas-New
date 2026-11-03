import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { mapLimit, READ_CONCURRENCY } from "./batch";
import type { ClientReason, ContactOutcome } from "./constants";
import { SCORECARD_PERIODS, scorecards, visibleCards, type PolicyIn, type RepCard, type ScorecardPeriod } from "./scorecard";

/**
 * LA-5.8 (Notion sprint) · the retention scorecard, server side. Read from what people recorded:
 * save-queue calls (LA-5.3), paper-bill calls and the requests the next file verified (LA-5.5),
 * reinstatements the carrier file confirmed (LA-5.6), the policy as the book shows it now, and the
 * holdout (LA-5.9), whose policies count against nobody. An owner sees everyone's card; anyone else
 * only their own — the others are never read into the response.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const CHUNK = 200;

export { SCORECARD_PERIODS, SCORECARD_PERIOD_LABELS, type ScorecardPeriod } from "./scorecard";

async function everyRow(build: () => Loose, max = 200_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const keyOf = (r: { carrier_id: string; policy_number: string }) => `${r.carrier_id}|${r.policy_number}`;

export type Scorecard = {
  available: true;
  from: string;
  to: string;
  cards: Array<RepCard & { name: string; role: string | null }>;
  /** Cards the holdout kept out of everyone's numbers in the period. */
  holdoutExcluded: number;
};

export async function loadScorecard(viewer: { tenantId: string; userId: string; role: string }, period: ScorecardPeriod): Promise<Scorecard | { available: false }> {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - SCORECARD_PERIODS[period] * 86_400_000).toISOString().slice(0, 10);
  const mineOnly = viewer.role !== "owner";
  const since = `${from}T00:00:00Z`;
  const settle = <T,>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  const optional = async (build: () => Loose) => everyRow(build).catch((error) => {
    if (isSchemaGap(error as Loose)) return [] as Loose[];
    throw error;
  });
  // One round trip: the save calls beside the rest (none of them needs the calls). The calls are still
  // decided first — before the migration the page is "not switched on", whatever the others did.
  const [savesRead, rest] = await Promise.all([
    settle(everyRow(() => {
      let q = db().from("save_attempt").select("carrier_id, policy_number, attempted_by, attempted_at, contact_outcome, recommended_actions_json, client_reason, unearned_advance_at_attempt_cents, in_holdout").eq("tenant_id", viewer.tenantId).gte("attempted_at", since);
      if (mineOnly) q = q.eq("attempted_by", viewer.userId);
      return q.order("attempted_at").order("id");
    })),
    settle(Promise.all([
      optional(() => {
        let q = db().from("conversion_attempt").select("carrier_id, policy_number, attempted_by, attempted_at, outcome, servicing_request_id").eq("tenant_id", viewer.tenantId).gte("attempted_at", since);
        if (mineOnly) q = q.eq("attempted_by", viewer.userId);
        return q.order("attempted_at").order("id");
      }),
      optional(() => {
        let q = db().from("reinstatement_case").select("carrier_id, policy_number, worked_by, resolved_at").eq("tenant_id", viewer.tenantId).eq("status", "reinstated").gte("resolved_at", since);
        if (mineOnly) q = q.eq("worked_by", viewer.userId);
        return q.order("resolved_at").order("id");
      }),
      // Held out at any point in the period (drawn before its end, and not left before its start).
      optional(() => db().from("retention_holdout").select("carrier_id, policy_number, drawn_on, left_at").eq("tenant_id", viewer.tenantId).eq("selected", true).lte("drawn_on", today).order("id")),
      db().from("tenant_users").select("user_id, role, users!tenant_users_user_id_fkey(name, email)").eq("tenant_id", viewer.tenantId),
    ])),
  ]);
  if (!savesRead.ok) {
    if (isSchemaGap(savesRead.error as Loose)) return { available: false };
    throw savesRead.error;
  }
  const saves: Loose[] = savesRead.value;
  if (!rest.ok) throw rest.error;
  const [conversions, reinstated, held, members] = rest.value;
  const holdoutKeys = new Set(held.filter((h) => !h.left_at || String(h.left_at).slice(0, 10) >= from).map(keyOf));

  const requestIds = [...new Set(conversions.map((c) => c.servicing_request_id).filter(Boolean))] as string[];
  const keys = new Set([...saves, ...conversions, ...reinstated].map(keyOf));
  const numbers = [...new Set([...keys].map((k) => k.slice(k.indexOf("|") + 1)))];
  const [requests, policies] = await Promise.all([
    mapLimit(chunks(requestIds, CHUNK), READ_CONCURRENCY, (ids) => db().from("servicing_request").select("id, status").eq("tenant_id", viewer.tenantId).in("id", ids)).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    mapLimit(chunks(numbers, CHUNK), READ_CONCURRENCY, (part) => db().from("policy_current").select("carrier_id, policy_number, status_normalized, lapsed_on, annualised_premium_cents").eq("tenant_id", viewer.tenantId).in("policy_number", part)).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
  ]);
  const verified = new Set((requests as Loose[]).filter((r) => r.status === "verified_in_file").map((r) => r.id));
  const policyOf = new Map<string, PolicyIn>((policies as Loose[]).filter((p) => keys.has(keyOf(p))).map((p) => [keyOf(p), { status: p.status_normalized, lapsedOn: p.lapsed_on, annualCents: p.annualised_premium_cents === null ? null : Number(p.annualised_premium_cents) }]));

  const cards = scorecards({
    attempts: saves.map((a) => ({
      by: a.attempted_by, key: keyOf(a), at: a.attempted_at, outcome: a.contact_outcome as ContactOutcome,
      firstAction: (a.recommended_actions_json?.[0]?.action as string | undefined) ?? null, clientReason: (a.client_reason ?? null) as ClientReason | null,
      advanceCents: a.unearned_advance_at_attempt_cents === null ? null : Number(a.unearned_advance_at_attempt_cents), inHoldout: Boolean(a.in_holdout),
    })),
    conversions: conversions.map((c) => ({ by: c.attempted_by, key: keyOf(c), at: c.attempted_at, outcome: c.outcome, verified: Boolean(c.servicing_request_id && verified.has(c.servicing_request_id)) })),
    reinstated: reinstated.map((r) => ({ by: r.worked_by, key: keyOf(r), at: r.resolved_at })),
    policies: policyOf,
    holdoutKeys,
    from,
    to: today,
    today,
  });
  const memberOf = new Map<string, Loose>(((members.data ?? []) as Loose[]).map((m) => [m.user_id, m]));
  return {
    available: true,
    from,
    to: today,
    cards: visibleCards(cards, viewer).map((c) => ({ ...c, name: memberOf.get(c.userId)?.users?.name || memberOf.get(c.userId)?.users?.email || "Someone no longer here", role: memberOf.get(c.userId)?.role ?? null })),
    holdoutExcluded: new Set([...saves, ...conversions].filter((a) => holdoutKeys.has(keyOf(a)) || a.in_holdout).map(keyOf)).size,
  };
}
