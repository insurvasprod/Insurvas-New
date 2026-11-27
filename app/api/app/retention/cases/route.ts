import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { STATE_TIMEZONES } from "@/lib/callbacks/timezone";
import { hasFeature } from "@/lib/entitlements/types";
import { isRecordUuid } from "@/lib/ingestion/path";
import { policyKeys } from "@/lib/ingestion/policyPageStore";
import { ACTION_TAKEN, CONTACT_OUTCOMES } from "@/lib/retention/constants";
import { CaseError, FIX_KINDS, addNote, assignCase, closeCase, linkServicing, loadCase, loadLadder, loadScoreCases, logCaseCall, openManualCase, recordFix, type CaseRow } from "@/lib/retention/cases/store";
import { caseScorecard, type ScoreLine } from "@/lib/retention/cases/scorecard";
import { SCORECARD_PERIODS, type ScorecardPeriod } from "@/lib/retention/scorecard";
import { ensureCasesFresh, LADDER_PENDING_MESSAGE } from "@/lib/retention/cases/sync";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { scopeFor } from "@/lib/agency/visibility";
import { PERSON_REASONS, REASON_LABELS, STEP_LABELS, type Reason } from "@/lib/retention/cases/ladder";

/**
 * The Retention ladder (owner 2026-11-05, docs/retention/SPEC.md) · what a person does on a case: log a call,
 * record a fix (the case then waits for a carrier file to prove it), link the servicing request opened from it,
 * assign it (owner), close it without a save (with a reason) or close a lost one to win-back, and open a case no
 * file carries (a new payment date). Opening, moving and saving are the files' (lib/retention/cases/sync.ts).
 *
 * Gated on `chargeback_radar` (the Retention module); owner, producer (their policies), retention (their cases).
 */
const id = z.string().refine(isRecordUuid, "Choose the case.");
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("call"), id, outcome: z.enum(CONTACT_OUTCOMES, { message: "Choose what happened on the call." }), did: z.enum(ACTION_TAKEN), note: z.string().trim().max(2000).nullable(),
    // Mobile board F5 (2026-11-27, additive): when to try again, in the words the phone showed ("Wed 25 Nov · 10:00 am
    // her time"), and "She'll call the carrier". Kept on the case's timeline as a note event (see nextAttemptNote).
    next_attempt_at: z.string().datetime({ offset: true, message: "Pick when to try again." }).nullable().optional(),
    next_attempt_label: z.string().trim().max(80).nullable().optional(),
    client_calls_carrier: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal("fix"), id, kind: z.enum(FIX_KINDS), note: z.string().trim().max(2000).nullable(), amount_cents: z.number().int().min(0).max(100_000_000).nullable().optional(), items: z.array(z.string().trim().min(1).max(200)).max(20).optional() }).strict(),
  z.object({ action: z.literal("link_servicing"), id, request_id: z.string().refine(isRecordUuid, "Choose the request.") }).strict(),
  z.object({ action: z.literal("note"), id, note: z.string().trim().min(1, "Write the note first.").max(2000) }).strict(),
  z.object({ action: z.literal("assign"), id, user_id: z.string().refine(isRecordUuid, "Choose who.") }).strict(),
  z.object({ action: z.literal("close"), id, as: z.enum(["closed_no_save", "lost"]), reason: z.string().trim().max(1000) }).strict(),
  z.object({ action: z.literal("open"), carrier_id: z.string().refine(isRecordUuid, "Choose the policy."), policy_number: z.string().trim().min(1).max(120), reason: z.enum(PERSON_REASONS, { message: "Choose why." }), note: z.string().trim().max(2000).nullable() }).strict(),
]);

/**
 * The phone's read of the same ladder the Cases page draws (mobile release 2, boards B7, F3, F4). The list is the
 * open cases in working order plus this month's decided ones as counts; `?id=` is one case with its calls. Both go
 * through loadLadder / loadCase, so who sees what is the page's rule (a retention rep: the cases they own). Like the
 * page, the list first refreshes the cases from the files (at most every 15 minutes). No unearned advance or face
 * amount: the phone shows a rep counts, and on a case only the monthly premium the page's strip shows.
 */
const clientEvidence = (e: Record<string, unknown>) => ({
  status: typeof e.status === "string" ? e.status : null,
  carrierWord: typeof e.carrier_word === "string" ? e.carrier_word : null,
  fileDate: typeof e.file_date === "string" ? e.file_date.slice(0, 10) : null,
  paidTo: typeof e.paid_to === "string" ? e.paid_to.slice(0, 10) : null,
  lapsedOn: typeof e.lapsed_on === "string" ? e.lapsed_on.slice(0, 10) : null,
  daysPastDue: typeof e.days_past_due === "number" ? e.days_past_due : null,
  byPerson: e.by === "person",
});
const listRow = (r: CaseRow) => ({
  id: r.id, clientName: r.clientName, carrierName: r.carrierName, policyNumber: r.policyNumber,
  step: r.step, reason: r.reason, reasonLabel: REASON_LABELS[r.reason as Reason] ?? r.reason, status: r.status,
  deadline: r.deadline, daysLeft: r.daysLeft, contactAttempts: r.contactAttempts, unreachable: r.unreachable,
  lastContactAt: r.lastContactAt, lastCall: r.lastCall, openedAt: r.openedAt, evidence: clientEvidence(r.evidence),
});

// Service-role reads, so every one carries the tenant filter itself.
type Chain = PromiseLike<{ error: unknown; count?: number | null }> & {
  eq(column: string, value: unknown): Chain;
  neq(column: string, value: unknown): Chain;
  gte(column: string, value: string): Chain;
  order(column: string, options: { ascending: boolean }): Chain;
  limit(n: number): Chain;
  maybeSingle(): PromiseLike<{ data: { received_at?: unknown } | null; error: unknown }>;
};
const serviceDb = () => getSupabaseServiceClient() as unknown as { from(table: string): { select(columns: string, options?: { count: "exact"; head: true }): Chain } };

/** The newest carrier policy file's arrival (file_registry.received_at): the files the ladder is built from. */
async function lastPolicyFileAt(tenantId: string): Promise<string | null> {
  try {
    const { data, error } = await serviceDb().from("file_registry").select("received_at").eq("tenant_id", tenantId).eq("file_type", "policies")
      .neq("status", "failed").order("received_at", { ascending: false }).limit(1).maybeSingle();
    return error || typeof data?.received_at !== "string" ? null : data.received_at;
  } catch {
    return null;
  }
}

/** The agency's cases decided this month (saved, lost): head counts, no rows. Null on any failure. */
async function teamMonth(tenantId: string, monthStart: string): Promise<{ saved: number; lost: number } | null> {
  const decided = (status: "saved" | "lost") => serviceDb().from("retention_case").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("status", status).gte("resolved_at", `${monthStart}T00:00:00Z`);
  try {
    const [saved, lost] = await Promise.all([decided("saved"), decided("lost")]);
    if (saved.error || lost.error) return null;
    return { saved: saved.count ?? 0, lost: lost.count ?? 0 };
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const looseDb = (): Loose => getSupabaseServiceClient();

type TimelineEvent = { kind: string; at: string; payload: Record<string, unknown> | null };

/**
 * The "try again" a case carries now: the note written with its latest call (F5), if that note set one. A later call
 * logged without one clears it, so a stale day never holds a case back. Events newest first.
 */
function latestNextAttempt(events: TimelineEvent[]): { at: string | null; clientCallsCarrier: boolean } {
  const lastCall = events.find((e) => e.kind === "call");
  if (!lastCall) return { at: null, clientCallsCarrier: false };
  const note = events.find((e) => e.kind === "note" && e.at >= lastCall.at && e.payload && (typeof e.payload.next_attempt_at === "string" || e.payload.client_calls_carrier === true));
  return { at: typeof note?.payload?.next_attempt_at === "string" ? note.payload.next_attempt_at : null, clientCallsCarrier: note?.payload?.client_calls_carrier === true };
}

/** The latest "try again" per open case (the list's order and chip). An empty map on any failure. */
async function nextAttemptsFor(tenantId: string, caseIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (let i = 0; i < caseIds.length; i += 200) {
      const { data, error } = await looseDb().from("retention_case_event").select("case_id, kind, payload, created_at")
        .eq("tenant_id", tenantId).in("kind", ["call", "note"]).in("case_id", caseIds.slice(i, i + 200)).order("created_at", { ascending: false });
      if (error) return out;
      const byCase = new Map<string, TimelineEvent[]>();
      for (const e of (data ?? []) as Loose[]) byCase.set(e.case_id, [...(byCase.get(e.case_id) ?? []), { kind: e.kind, at: e.created_at, payload: e.payload ?? null }]);
      for (const [id, events] of byCase) {
        const next = latestNextAttempt(events).at;
        if (next) out.set(id, next);
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** The carrier file row the case's evidence was read from (policy_snapshot → raw_rows), as Needs you finds a row. */
async function evidenceRow(tenantId: string, carrierId: string, policyNumber: string, fileDate: string | null): Promise<number | null> {
  try {
    let query = looseDb().from("policy_snapshot").select("raw_row_id, snapshot_date").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).not("raw_row_id", "is", null);
    if (fileDate) query = query.eq("snapshot_date", fileDate);
    const { data } = await query.order("snapshot_date", { ascending: false }).limit(1);
    const snap = (data ?? [])[0];
    if (!snap?.raw_row_id) return null;
    const { data: raw } = await looseDb().from("raw_rows").select("row_number").eq("tenant_id", tenantId).eq("id", snap.raw_row_id).maybeSingle();
    return raw?.row_number == null ? null : Number(raw.row_number);
  } catch {
    return null;
  }
}

/** F5's "Try again" and "She'll call the carrier", on the case's timeline as a note (the web shows its words). */
async function nextAttemptNote(tenantId: string, userId: string, caseId: string, input: { at: string | null; label: string | null; clientCallsCarrier: boolean }) {
  const words = [input.clientCallsCarrier ? "The client will call the carrier" : null, input.at ? `Try again ${input.label || new Date(input.at).toISOString().slice(0, 16).replace("T", " ") + " UTC"}` : null].filter(Boolean).join(" · ");
  const { error } = await looseDb().from("retention_case_event").insert({
    tenant_id: tenantId, case_id: caseId, kind: "note", actor_user_id: userId,
    payload: { note: words, next_attempt_at: input.at, client_calls_carrier: input.clientCallsCarrier, by: "phone" },
  });
  if (error) console.error("[retention cases] the next attempt could not be written", error);
  return !error;
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer", "retention"] as const, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const headers = { "Cache-Control": "no-store" };
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
  const id = request.nextUrl.searchParams.get("id");
  try {
    if (id !== null) {
      if (!isRecordUuid(id)) return NextResponse.json({ error: "Choose the case." }, { status: 400 });
      const loaded = await loadCase(viewer, id);
      if (!loaded) return NextResponse.json({ error: "That case isn't here." }, { status: 404 });
      const { row, calls, events } = loaded;
      // Mobile board F4 / F5 (2026-11-27, additive): the lead behind the policy (Call goes through that lead's dialer
      // checks), whether this person may use the dialer at all, the client's own zone for "Try again … her time", the
      // file row the evidence came from, and the latest "try again" set on the timeline.
      const held = auth.context.roles?.length ? auth.context.roles : [role];
      const canDial = held.some((r) => r === "owner" || r === "producer" || r === "setter") && hasFeature(auth.entitlement, "outbound_dialing");
      const [keys, fileRow] = await Promise.all([
        policyKeys(viewer, row.carrierId, row.policyNumber).catch(() => null),
        evidenceRow(tenantId, row.carrierId, row.policyNumber, typeof row.evidence?.file_date === "string" ? row.evidence.file_date.slice(0, 10) : null),
      ]);
      const next = latestNextAttempt(events.map((e) => ({ kind: e.kind, at: e.at, payload: e.payload })));
      return NextResponse.json({
        case: {
          ...listRow(row), phone: row.phone, monthlyCents: row.monthlyCents, product: row.product ?? loaded.policy?.product_code ?? null,
          ownerName: row.ownerName, servicingRequestId: row.servicingRequestId, nextAction: row.nextAction, resolvedAt: row.resolvedAt, outcomeReason: row.outcomeReason,
          calls: calls.slice(0, 10).map((c) => ({ at: c.at, outcome: c.outcome, did: c.did, note: c.note, by: c.by })),
          leadId: keys?.leadId ?? null, canDial,
          clientState: row.clientState, clientZone: row.clientState ? STATE_TIMEZONES[row.clientState.toUpperCase()] ?? null : null,
          fileRow, nextAttemptAt: next.at, clientCallsCarrier: next.clientCallsCarrier,
        },
      }, { headers });
    }
    // `?scorecard=90|180|365` · the phone's Retention scorecard (mobile board I4c): the web page's own read
    // (loadScoreCases + caseScorecard, Reports › Retention scorecard), counts only — the premium kept is left out,
    // as everywhere a rep looks on the phone. An owner sees everyone; anyone else only their own card, as on the page.
    // A plain read: it does not refresh the cases from the files.
    const scorecard = request.nextUrl.searchParams.get("scorecard");
    if (scorecard !== null) {
      if (!(scorecard in SCORECARD_PERIODS)) return NextResponse.json({ error: "Choose a period." }, { status: 400 });
      const scored = await loadScoreCases(viewer, SCORECARD_PERIODS[scorecard as ScorecardPeriod]);
      if (!scored) return NextResponse.json({ available: false, message: LADDER_PENDING_MESSAGE }, { headers });
      const mine = role === "owner" ? scored.cases : scored.cases.filter((c) => c.ownerId === userId);
      const card = caseScorecard(mine.map((c) => ({ ownerId: c.ownerId, step: c.step, status: c.status, unreachable: c.unreachable, monthlyCents: 0 })));
      const counts = (l: ScoreLine) => ({ key: l.key, open: l.open, saved: l.saved, lost: l.lost, closedNoSave: l.closedNoSave, unreachable: l.unreachable, rate: l.rate });
      return NextResponse.json({
        available: true,
        days: SCORECARD_PERIODS[scorecard as ScorecardPeriod],
        total: counts(card.total),
        steps: card.steps.map((l) => ({ ...counts(l), label: STEP_LABELS[l.key as keyof typeof STEP_LABELS] ?? l.key })),
        people: card.people.map((l) => ({ ...counts(l), name: l.key === "nobody" ? "Nobody yet" : scored.names.get(l.key) ?? (l.key === userId ? "You" : "Someone no longer here") })),
      }, { headers });
    }
    await ensureCasesFresh(tenantId);
    // Board B7's subtitle and ring line read beside the ladder: when the last carrier policy file arrived, and the
    // agency's save rate this month. Both are reads only and answer null on any failure; neither waits on the other.
    const lastFileRead = lastPolicyFileAt(tenantId);
    const ladder = await loadLadder(viewer);
    if (!ladder.available) return NextResponse.json({ available: false, message: LADDER_PENDING_MESSAGE }, { headers });
    const monthStart = `${ladder.today.slice(0, 7)}-01`;
    const [lastFileAt, team, nextAttempts] = await Promise.all([lastFileRead, teamMonth(tenantId, monthStart), nextAttemptsFor(tenantId, ladder.open.map((r) => r.id))]);
    const month = ladder.closed.filter((r) => (r.resolvedAt ?? "") >= monthStart);
    const fileDates = ladder.open.map((r) => r.evidence?.file_date).filter((d): d is string => typeof d === "string").sort();
    return NextResponse.json({
      available: true,
      today: ladder.today,
      lastFileDate: fileDates.length ? fileDates[fileDates.length - 1].slice(0, 10) : null,
      // Board F5's "Try again" (2026-11-27, additive): the latest one set on each case, null when none.
      cases: ladder.open.map((r) => ({ ...listRow(r), nextAttemptAt: nextAttempts.get(r.id) ?? null })),
      // Decided this month, as counts (the scorecard's rule: the save rate is saved ÷ saved + lost).
      month: { saved: month.filter((r) => r.status === "saved").length, lost: month.filter((r) => r.status === "lost").length, closedNoSave: month.filter((r) => r.status === "closed_no_save").length },
      // When the newest carrier policy file arrived (ISO timestamp; board B7 "Last carrier file 6:02 am"). Null: none, or unread.
      lastFileAt,
      // The whole agency's month by the same rule (saved ÷ saved + lost), counts only; null when unread.
      team,
    }, { headers });
  } catch (error) {
    if (error instanceof CaseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention cases] read:", error);
    return NextResponse.json({ error: "The cases could not be read" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer", "retention"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
  try {
    let result: Record<string, unknown> = { ok: true };
    if (b.action === "call") {
      await logCaseCall(viewer, b.id, { outcome: b.outcome, did: b.did, note: b.note });
      // The call is on the case either way; the answer says whether "try again" was kept, so the phone never logs the call twice.
      if (b.next_attempt_at || b.client_calls_carrier) result = { ok: true, nextAttemptSaved: await nextAttemptNote(tenantId, userId, b.id, { at: b.next_attempt_at ?? null, label: b.next_attempt_label ?? null, clientCallsCarrier: Boolean(b.client_calls_carrier) }) };
    }
    else if (b.action === "fix") await recordFix(viewer, b.id, { kind: b.kind, note: b.note, amountCents: b.amount_cents ?? null, items: b.items });
    else if (b.action === "link_servicing") await linkServicing(viewer, b.id, b.request_id);
    else if (b.action === "note") await addNote(viewer, b.id, b.note);
    else if (b.action === "assign") await assignCase(viewer, b.id, b.user_id);
    else if (b.action === "close") await closeCase(viewer, b.id, { as: b.as, reason: b.reason });
    else result = { ok: true, ...(await openManualCase(viewer, { carrierId: b.carrier_id, policyNumber: b.policy_number, reason: b.reason, note: b.note })) };
    await audit({ actorType: "tenant", actorId: userId, action: `retention.case_${b.action}`, targetType: "retention_case", targetId: "id" in b ? b.id : `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId }, request });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CaseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention cases]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
