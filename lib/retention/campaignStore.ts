import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { rowVisible, scopeQuery, type ProducerScope } from "@/lib/agency/visibility";

import { byPerson, campaignOrder, campaignTotals, historyLine, lapseComparison, PLATFORM_TALK_TRACK, stateOf, type CampaignState, type CampaignTotals, type ConversionOutcome } from "./campaign";
import { SCORED_STATUSES } from "./constants";
import { loadRadarConfig } from "./radarStore";
import { ownsCard } from "./assignment";
import { ensureOwners, ownerOf, type Owner } from "./assignmentStore";
import { advanceAtRisk } from "@/lib/ingestion/retentionStore";
import { wholeMonths } from "./signals";

/**
 * LA-5.5 (Notion sprint) · the paper-bill campaign, server side. The list is computed from
 * policy_current (LA-4.7); "converted" is the LA-5.4 request the file verified; what an agent did is
 * conversion_attempt. Opening the page writes nothing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const CHUNK = 200;

export const CAMPAIGN_PENDING_MESSAGE = "The paper-bill campaign needs a database update (20261014300000).";

export class CampaignError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CampaignError";
  }
}

/**
 * AG-0.5 · `scope` is the session's producer scope (scopeFor). With one, the campaign lists, totals and lapse
 * comparison cover only policies credited to a visible producer (policy_current.agent_user_id), owners are read
 * but never moved from that partial list, and a call can be logged only on such a policy. Absent or null =
 * unchanged (individual plan, owner, bookkeeper and the retention role, which works the whole book).
 */
export type Viewer = { tenantId: string; userId: string; role: string; scope?: ProducerScope };

async function everyRow(build: () => Loose, max = 100_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const keyOf = (r: { carrier_id: string; policy_number: string }) => `${r.carrier_id}|${r.policy_number}`;

export type CampaignRow = {
  key: string;
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  phone: string | null;
  monthlyCents: number | null;
  annualCents: number | null;
  history: string;
  state: CampaignState;
  returnsOn: string | null;
  lastAttempt: { outcome: ConversionOutcome; at: string; by: string | null } | null;
  /** LA-5.8: who calls it (rows still to work). */
  owner: Owner | null;
};

export type Campaign = {
  available: true;
  rows: CampaignRow[];
  totals: CampaignTotals;
  talkTrack: string;
  talkTrackIsOwn: boolean;
  cooloffDays: number;
  lapse: ReturnType<typeof lapseComparison>;
  people: Array<{ name: string; calls: number; agreed: number; verified: number }>;
  /** LA-5.8: owners are shown only when more than one person owns rows. */
  showOwners: boolean;
};

const POLICY_COLUMNS = "carrier_id, policy_number, contact_id, agent_user_id, status_normalized, payment_method, annualised_premium_cents, issue_date, issued_on, effective_date, as_of, months_paid, product_code";

export async function loadCampaign(viewer: Viewer): Promise<Campaign | { available: false }> {
  const config = await loadRadarConfig(viewer.tenantId);
  if (!config) return { available: false };
  const scoped = viewer.role === "producer";
  let attempts: Loose[];
  let requests: Loose[];
  try {
    [attempts, requests] = await Promise.all([
      everyRow(() => db().from("conversion_attempt").select("carrier_id, policy_number, outcome, attempted_at, attempted_by, servicing_request_id").eq("tenant_id", viewer.tenantId).order("attempted_at").order("id")),
      everyRow(() => db().from("servicing_request").select("id, carrier_id, policy_number, status, verified_at, created_at").eq("tenant_id", viewer.tenantId).eq("request_type", "bill_to_draft_conversion").order("created_at").order("id")),
    ]);
  } catch (error) {
    if (isSchemaGap(error as Loose)) return { available: false };
    throw error;
  }
  // Every policy that has ever paid by mailed bill (any status), for the list and the lapse comparison.
  const everPaper = await everyRow(() => {
    let q = db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", viewer.tenantId).eq("payment_method", "direct_bill");
    if (scoped) q = q.eq("agent_user_id", viewer.userId);
    return scopeQuery(q, "agent_user_id", viewer.scope ?? null).order("carrier_id").order("policy_number");
  });
  const newestRequest = new Map<string, Loose>();
  for (const r of requests) newestRequest.set(keyOf(r), r);
  // Converted policies pay by draft now: read them by their request — and so do ones whose switch is
  // still being proven, so a policy never drops off the campaign between the file and the check.
  const requestedKeys = [...newestRequest.values()].filter((r) => r.status !== "cancelled").map(keyOf);
  // Only a verified switch counts as converted, for the lapse comparison.
  const convertedKeys = [...newestRequest.values()].filter((r) => r.status === "verified_in_file").map(keyOf);
  const paperKeys = new Set(everPaper.map(keyOf));
  const missing = requestedKeys.filter((k) => !paperKeys.has(k));
  const convertedPolicies: Loose[] = [];
  for (let i = 0; i < missing.length; i += CHUNK) {
    const numbers = missing.slice(i, i + CHUNK).map((k) => k.slice(k.indexOf("|") + 1));
    let q = db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", viewer.tenantId).in("policy_number", numbers);
    if (scoped) q = q.eq("agent_user_id", viewer.userId);
    const part = await scopeQuery(q, "agent_user_id", viewer.scope ?? null);
    if (part.error) throw part.error;
    convertedPolicies.push(...((part.data ?? []) as Loose[]).filter((p) => missing.includes(keyOf(p))));
  }
  const inForce = new Set<string>(SCORED_STATUSES);
  const listed = [...everPaper.filter((p) => inForce.has(p.status_normalized)), ...convertedPolicies];
  const listedKeys = new Set(listed.map(keyOf));

  const attemptsOf = new Map<string, Loose[]>();
  for (const a of attempts) attemptsOf.set(keyOf(a), [...(attemptsOf.get(keyOf(a)) ?? []), a]);
  const numbers = [...new Set(listed.map((p) => p.policy_number))];
  const contactIds = [...new Set(listed.map((p) => p.contact_id).filter(Boolean))] as string[];
  const userIds = [...new Set(attempts.map((a) => a.attempted_by).filter(Boolean))] as string[];
  const [signals, contacts, users, carriers] = await Promise.all([
    Promise.all(Array.from({ length: Math.ceil(numbers.length / CHUNK) }, (_, i) => db().from("policy_risk_signals").select("carrier_id, policy_number, months_since_issue, draft_failures_count").eq("tenant_id", viewer.tenantId).in("policy_number", numbers.slice(i * CHUNK, i * CHUNK + CHUNK)))).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    Promise.all(Array.from({ length: Math.ceil(contactIds.length / CHUNK) }, (_, i) => db().from("contacts").select("id, first_name, last_name, primary_phone").eq("tenant_id", viewer.tenantId).in("id", contactIds.slice(i * CHUNK, i * CHUNK + CHUNK)))).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    userIds.length ? db().from("users").select("id, name, email").in("id", userIds) : { data: [] },
    db().from("carriers").select("id, name"),
  ]);
  const signalOf = new Map<string, Loose>(signals.map((s: Loose) => [keyOf(s), s]));
  const contactOf = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const userName = new Map<string, string>(((users.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const today = new Date().toISOString().slice(0, 10);
  // Months on the books from the policy itself, so the line reads right before the radar has ever run.
  const monthsOf = (p: Loose): number | null => {
    const issued = (p.issue_date ?? p.issued_on ?? p.effective_date) as string | null;
    return issued ? wholeMonths(issued.slice(0, 10), (p.as_of as string | null) ?? today) : null;
  };

  const rows: CampaignRow[] = campaignOrder(listed.map((p) => {
    const key = keyOf(p);
    const req = newestRequest.get(key);
    const tried = (attemptsOf.get(key) ?? []).map((a) => ({ outcome: a.outcome as ConversionOutcome, at: a.attempted_at as string, by: a.attempted_by as string | null }));
    const { state, returnsOn } = stateOf({ key, onPaperNow: p.payment_method === "direct_bill", annualCents: p.annualised_premium_cents === null ? null : Number(p.annualised_premium_cents), attempts: tried, request: req ? { status: req.status, verifiedAt: req.verified_at } : null }, today, config.settings.billDeclineCooloffDays);
    const s = signalOf.get(key);
    const c = p.contact_id ? contactOf.get(p.contact_id) : null;
    const last = tried.at(-1);
    const annual = p.annualised_premium_cents === null ? null : Number(p.annualised_premium_cents);
    return {
      key, carrierId: p.carrier_id, carrierName: carrierName.get(p.carrier_id) ?? "Carrier not known", policyNumber: p.policy_number,
      clientName: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || null : null, phone: c?.primary_phone ?? null,
      annualCents: annual, monthlyCents: annual === null ? null : Math.round(annual / 12),
      history: historyLine(monthsOf(p) ?? s?.months_since_issue ?? null, s?.draft_failures_count ?? null),
      state, returnsOn, lastAttempt: last ? { outcome: last.outcome, at: last.at, by: last.by ? userName.get(last.by) ?? "Someone no longer here" : null } : null,
      owner: null,
    };
  }));

  // LA-5.8: every row still to work has an owner, resolved across the agency (a producer's view is
  // their own book only, so it reads owners and never moves them).
  const working = (r: CampaignRow) => r.state === "remaining" || r.state === "in_progress";
  const agentOf = new Map<string, string | null>(listed.map((p) => [keyOf(p), p.agent_user_id ?? null]));
  let owners: Map<string, Owner> | null = null;
  // A scoped list is part of the book: resolving owners from it would close the rest's assignments.
  if (!scoped && (viewer.scope ?? null) === null) {
    const exposure = await advanceAtRisk(viewer.tenantId, listed.filter((p) => rows.some((r) => r.key === keyOf(p) && working(r))).map((p) => ({ carrier_id: p.carrier_id, policy_number: p.policy_number, months_paid: p.months_paid ?? null, product_code: p.product_code ?? null, as_of: p.as_of }))).catch(() => new Map<string, number | null>());
    owners = await ensureOwners(viewer.tenantId, "paper_bill", rows.filter(working).map((r) => ({ key: r.key, carrierId: r.carrierId, writingAgentId: agentOf.get(r.key) ?? null, exposureCents: exposure.get(r.key) ?? null })), config.settings, { keep: new Set(rows.filter(working).map((r) => r.key)) }).catch((error) => {
      console.error("[campaign] owners could not be resolved", error);
      return null;
    });
    for (const r of rows) r.owner = working(r) ? owners?.get(r.key) ?? null : null;
  }
  const shown = viewer.role === "retention" ? rows.filter((r) => working(r) && r.owner?.userId === viewer.userId) : rows;

  // Lapse rate: policies the file shows converted, against those still on (or lapsed on) a mailed bill.
  const convertedSet = new Set(convertedKeys);
  const convertedCohort = convertedPolicies.filter((p) => convertedSet.has(keyOf(p))).concat(everPaper.filter((p) => convertedSet.has(keyOf(p))));
  const paperCohort = everPaper.filter((p) => !convertedSet.has(keyOf(p)) && (inForce.has(p.status_normalized) || p.status_normalized === "lapsed"));
  const lapsed = (list: Loose[]) => list.filter((p) => p.status_normalized === "lapsed").length;
  const verifiedRequests = new Set([...newestRequest.values()].filter((r) => r.status === "verified_in_file").map((r) => r.id));
  const people = byPerson(attempts.filter((a) => listedKeys.has(keyOf(a)) || convertedSet.has(keyOf(a))).map((a) => ({ by: a.attempted_by, outcome: a.outcome, verified: a.servicing_request_id ? verifiedRequests.has(a.servicing_request_id) : false })));

  return {
    available: true,
    rows: shown,
    totals: campaignTotals(shown),
    showOwners: Boolean(owners) && new Set([...(owners?.values() ?? [])].map((o) => o.userId)).size > 1,
    talkTrack: config.settings.billTalkTrack ?? PLATFORM_TALK_TRACK,
    talkTrackIsOwn: config.settings.billTalkTrack !== null,
    cooloffDays: config.settings.billDeclineCooloffDays,
    lapse: lapseComparison({ lapsed: lapsed(convertedCohort), total: convertedCohort.length }, { lapsed: lapsed(paperCohort), total: paperCohort.length }, config.settings.sampleFloor),
    // A retention rep sees their own line only (LA-5.8: nobody else's numbers).
    people: [...people.entries()].filter(([id]) => viewer.role !== "retention" || id === viewer.userId).map(([id, v]) => ({ name: id === "—" ? "Nobody recorded" : userName.get(id) ?? "Someone no longer here", ...v })).sort((a, b) => b.verified - a.verified || b.calls - a.calls),
  };
}

/** Log a call that did not open a request: no answer, call back, said no (with a reason), no bank account. */
export async function logConversionCall(viewer: Viewer, input: { carrierId: string; policyNumber: string; outcome: Exclude<ConversionOutcome, "converted">; declineReason: string | null; note: string | null }) {
  const { data: p, error } = await db().from("policy_current").select("agent_user_id, status_normalized, payment_method").eq("tenant_id", viewer.tenantId).eq("carrier_id", input.carrierId).eq("policy_number", input.policyNumber).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p || (viewer.role === "producer" && p.agent_user_id !== viewer.userId) || !rowVisible(viewer.scope ?? null, p.agent_user_id)) throw new CampaignError("That policy isn't in your book.", 404);
  if (viewer.role === "retention" && !ownsCard(viewer, (await ownerOf(viewer.tenantId, "paper_bill", input.carrierId, input.policyNumber)) ?? undefined)) {
    throw new CampaignError("That policy is assigned to someone else.", 404);
  }
  if (p.payment_method !== "direct_bill" || !(SCORED_STATUSES as readonly string[]).includes(p.status_normalized)) throw new CampaignError("This policy isn't an in-force mailed-bill policy now.", 409);
  if (input.outcome === "declined" && (!input.declineReason || input.declineReason.trim().length < 3)) throw new CampaignError("Say why they said no.", 400);
  const insert = await db().from("conversion_attempt").insert({
    tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber, outcome: input.outcome,
    decline_reason: input.outcome === "declined" ? input.declineReason!.trim() : null, attempted_by: viewer.userId, note: input.note?.trim() || null,
  });
  if (insert.error) {
    if (isSchemaGap(insert.error)) throw new CampaignError(CAMPAIGN_PENDING_MESSAGE, 503);
    throw new Error(`Could not log the call: ${insert.error.message}`);
  }
}

/** The agency's talk track (owners). Empty goes back to the platform's. Audited. */
export async function saveTalkTrack(viewer: Viewer, text: string | null) {
  const value = text?.trim() ? text.trim() : null;
  const current = await db().from("retention_settings").select("bill_talk_track").eq("tenant_id", viewer.tenantId).maybeSingle();
  if (current.error) {
    if (isSchemaGap(current.error)) throw new CampaignError(CAMPAIGN_PENDING_MESSAGE, 503);
    throw new Error(current.error.message);
  }
  const old = (current.data as Loose)?.bill_talk_track ?? null;
  if (old === value) return;
  const write = current.data
    ? await db().from("retention_settings").update({ bill_talk_track: value, updated_by: viewer.userId, updated_at: new Date().toISOString() }).eq("tenant_id", viewer.tenantId)
    : await db().from("retention_settings").insert({ tenant_id: viewer.tenantId, bill_talk_track: value, updated_by: viewer.userId });
  if (write.error) throw new Error(`Could not save the talk track: ${write.error.message}`);
  const audit = await db().from("retention_setting_change").insert({ tenant_id: viewer.tenantId, setting: "bill_talk_track", old_value: old, new_value: value, changed_by: viewer.userId });
  if (audit.error) console.error("[campaign] the talk-track change could not be recorded", audit.error);
}
