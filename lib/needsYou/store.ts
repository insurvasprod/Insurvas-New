import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS, type DiscrepancyType } from "@/lib/ingestion/discrepancyEngine";
import { DISPUTABLE } from "@/lib/ingestion/disputeLetter";
import { DISCREPANCIES_PENDING_MESSAGE, loadDiscrepancies, type DiscrepancyRow } from "@/lib/ingestion/discrepancyStore";
import { QUEUE_TYPES, RESOLUTION_LABELS, type QueueType, type Resolution } from "@/lib/ingestion/exceptionQueues";
import { QUEUES_PENDING_MESSAGE, type QueueItemRow } from "@/lib/ingestion/exceptionQueuesStore";
import { allRows, chunks } from "@/lib/ingestion/pages";
import { WRITING_ROLES, type FieldOutcome, type MatchField } from "@/lib/ingestion/policyMatching";
import { MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";
import { loadRowTrace, untraceableDiscrepancies } from "@/lib/ingestion/traceStore";
import { PIPELINE_RULES_PENDING_MESSAGE } from "@/lib/pipelineRules/rules";
import { listRuleHolds, loadBoard, type HoldRow } from "@/lib/pipelineRules/store";

import { agentItemId, byOldest, daysSince, dollars, itemHref, KIND_META, parseAgentItemId, QUEUE_KIND, type FileFilter, type NeedsYouItem, type NeedsYouKind, type QueueKind } from "./kinds";

/**
 * Book of business › Needs you (owner 2026-11-02, round 2), server side: every open decision from every source,
 * as one list of items (lib/needsYou/kinds.ts), and what one item's page needs to decide it. Reading only: no
 * scan, sweep or refresh runs from here, so opening the list writes nothing.
 *
 * Each source keeps its own rule. The owner and bookkeepers see every item; anyone else sees only the exception
 * items assigned to them (the queue's own rule). Money and credit need their own plan features as well
 * (discrepancy_report, producer_payouts), as their APIs do. A source whose tables aren't there yet adds a
 * "pending database" note instead of items; a read that fails says so too, never "nothing waits".
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const ATTRIBUTION_PENDING_MESSAGE = "Who gets the credit needs a database update (20261018200000).";
export const STATUS_WORDS_PENDING_MESSAGE = "Status words need a database update (20261008130000).";

export type NeedsYouScope = {
  tenantId: string;
  userId: string;
  /** The owner or a bookkeeper: every item, and the kinds only they decide. */
  keeper: boolean;
  /** discrepancy_report is on the plan: Money doesn't match. */
  money: boolean;
  /** producer_payouts is on the plan: Who gets the credit. */
  credit: boolean;
};

type Part = { open: NeedsYouItem[]; closed: NeedsYouItem[]; notes: string[] };
const EMPTY: Part = { open: [], closed: [], notes: [] };
const KEEPERS = "Owner or bookkeeper";
const since30 = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

/** A source that fails adds a note and nothing else: the other sources still show. */
async function guarded(label: string, pending: string, read: () => Promise<Part>): Promise<Part> {
  try {
    return await read();
  } catch (error) {
    if (error && typeof error === "object" && "message" in error && isSchemaGap(error as { message: string; code?: string })) return { ...EMPTY, notes: [pending] };
    console.error(`[needs-you] ${label}`, error instanceof Error ? error.message : error);
    return { ...EMPTY, notes: [`${label} couldn't be read just now. Refresh to try again.`] };
  }
}

/** A read's rows, or the error thrown (a schema gap becomes the source's pending note in `guarded`). */
function rows<T = Loose>(read: { data?: T[] | null; rows?: T[]; error: Loose }): T[] {
  if (read.error) throw read.error;
  return (read.rows ?? read.data ?? []) as T[];
}

type Names = { carrier: Map<string, string>; user: Map<string, string> };

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await byIds(unique, (part) => db().from("users").select("id, name, email").in("id", part));
  return new Map(((data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email || "Someone"]));
}

/** Rows by id, 150 ids a request (a long id list in one request line is refused by the gateway). */
async function byIds(ids: string[], read: (part: string[]) => PromiseLike<{ data: unknown }>): Promise<{ data: Loose[] }> {
  const parts = chunks(ids, 150);
  const out: Loose[] = [];
  for (let i = 0; i < parts.length; i += 6) {
    const pages = await Promise.all(parts.slice(i, i + 6).map(async (part) => ((await read(part)).data ?? []) as Loose[]));
    out.push(...pages.flat());
  }
  return { data: out };
}

function item(kind: NeedsYouKind, id: string, fields: Omit<NeedsYouItem, "kind" | "id" | "href" | "ageDays" | "tone"> & { tone?: NeedsYouItem["tone"] }, today: string): NeedsYouItem {
  return { kind, id, href: itemHref(kind, id), ageDays: daysSince(fields.since, today), tone: fields.tone ?? KIND_META[kind].tone, ...fields };
}

/** A closed item opens where its whole history lives: its source's own page. */
const CLOSED_HREF: Partial<Record<NeedsYouKind, string>> = {
  "pick-client": "/app/policy-matching?tab=links",
  money: "/app/discrepancies",
  credit: "/app/attribution",
  "status-word": "/app/carrier-files",
};
const closedHref = (kind: NeedsYouKind) => CLOSED_HREF[kind] ?? "/app/exceptions";

// ─── Pick the client · policy_match_review ───────────────────────────────────────────────────────────────

const reviewWhy = (shortlist: unknown[], fileDate: string | null) =>
  `${shortlist.length === 0 ? "No sale has this number" : shortlist.length === 1 ? "1 sale could be it" : `${shortlist.length} sales could be it`}${fileDate ? ` · file of ${fileDay(fileDate)}` : ""}`;

async function reviews(scope: NeedsYouScope, names: Names, today: string): Promise<Part> {
  if (!scope.keeper) return EMPTY;
  const [open, closed] = await Promise.all([
    allRows(() => db().from("policy_match_review").select("id, carrier_id, policy_number, carrier_row, shortlist, created_at, file_id").eq("tenant_id", scope.tenantId).eq("status", "open").order("created_at").order("id"), 10_000),
    db().from("policy_match_review").select("id, carrier_id, policy_number, resolved_at, created_at").eq("tenant_id", scope.tenantId).eq("status", "resolved").gte("resolved_at", since30()).order("resolved_at", { ascending: false }).limit(100),
  ]);
  const about = (r: Loose) => `${r.policy_number} · ${names.carrier.get(r.carrier_id) ?? "Carrier not known"}`;
  return {
    open: rows(open).map((r: Loose) => item("pick-client", r.id, { about: about(r), why: reviewWhy(r.shortlist ?? [], r.carrier_row?.fileDate ?? null), who: KEEPERS, ownerUserId: null, since: r.created_at, ref: { carrierId: r.carrier_id, policyNumber: r.policy_number, fileId: r.file_id } }, today)),
    closed: rows(closed).map((r: Loose) => ({ ...item("pick-client", r.id, { about: about(r), why: "The client was picked", who: KEEPERS, ownerUserId: null, since: r.created_at, closedAs: "Linked by a person", closedAt: r.resolved_at }, today), href: closedHref("pick-client") })),
    notes: [],
  };
}

// ─── The exception queues · queue_item ───────────────────────────────────────────────────────────────────

const QUEUE_COLUMNS = "id, queue_type, carrier_id, policy_number, deal_id, contact_id, related_contact_id, payload, subject_id, assigned_to_user_id, age_from, escalated_at, created_at, status, resolution, resolved_at";

function queueText(row: Loose, names: Names, contact: Map<string, string>, deal: Map<string, Loose>): { about: string; why: string } {
  const carrier = row.carrier_id ? names.carrier.get(row.carrier_id) ?? "Carrier not known" : null;
  const payload = row.payload ?? {};
  switch (row.queue_type as QueueType) {
    case "no_deal_flow": {
      const insured = [payload.insured?.first_name, payload.insured?.last_name].filter(Boolean).join(" ");
      return { about: `${row.policy_number ?? "A policy"} · ${carrier ?? payload.carrier_name ?? ""}`, why: `${insured || "The insured"} · no sale or application on record` };
    }
    case "no_policy": {
      const d = row.deal_id ? deal.get(row.deal_id) : null;
      return { about: `${d?.insured_name ?? "A sale"} · ${carrier ?? d?.carrier ?? "no carrier"}`, why: `Sold ${fileDay(d?.local_date ?? row.age_from)} · in no carrier file yet` };
    }
    case "multi_policy":
      return { about: `${contact.get(row.contact_id) ?? "A client"} and ${contact.get(row.related_contact_id) ?? "another client"}`, why: "Two clients may be one person" };
    case "initial_import":
      return { about: `${payload.carrier_name ?? carrier ?? "A carrier"} · file of ${fileDay(payload.file_date ?? null)}`, why: `${Number(payload.provisional ?? 0).toLocaleString("en-US")} new clients made from your existing book` };
    case "orphan_commission":
      return { about: `${dollars(payload.amount_cents == null ? null : Number(payload.amount_cents))} · ${row.policy_number ?? "a policy"}`, why: `${carrier ?? "The carrier"} paid on a policy no file has listed` };
    default:
      return { about: row.policy_number ?? "An item", why: "Waits for a person" };
  }
}

const closedWords = (resolution: string | null) => (resolution === "auto_linked" ? "Linked automatically" : resolution ? RESOLUTION_LABELS[resolution as Resolution] ?? resolution : "Closed");

async function queue(scope: NeedsYouScope, names: Names, today: string): Promise<Part> {
  // Every open item, page by page (the rail counts every one; a capped read would show fewer than it says).
  const open = () => {
    const q = db().from("queue_item").select(QUEUE_COLUMNS).eq("tenant_id", scope.tenantId).eq("status", "open").in("queue_type", [...QUEUE_TYPES]);
    return (scope.keeper ? q : q.eq("assigned_to_user_id", scope.userId)).order("age_from").order("id");
  };
  let closed = db().from("queue_item").select(QUEUE_COLUMNS).eq("tenant_id", scope.tenantId).neq("status", "open").in("queue_type", [...QUEUE_TYPES]).gte("resolved_at", since30()).order("resolved_at", { ascending: false }).limit(100);
  if (!scope.keeper) closed = closed.eq("assigned_to_user_id", scope.userId);
  const [openRes, closedRes] = await Promise.all([allRows(open, 20_000), closed]);
  const all = [...rows(openRes), ...rows(closedRes)] as Loose[];
  const contactIds = [...new Set(all.flatMap((r) => [r.contact_id, r.related_contact_id]).filter(Boolean))] as string[];
  const dealIds = [...new Set(all.map((r) => r.deal_id).filter(Boolean))] as string[];
  const [contacts, deals, users] = await Promise.all([
    byIds(contactIds, (part) => db().from("contacts").select("id, first_name, last_name").eq("tenant_id", scope.tenantId).in("id", part)),
    byIds(dealIds, (part) => db().from("deal_flow").select("id, insured_name, local_date, carrier").eq("tenant_id", scope.tenantId).in("id", part)),
    userNames(all.map((r) => r.assigned_to_user_id)),
  ]);
  const contact = new Map<string, string>(((contacts.data ?? []) as Loose[]).map((c) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]));
  const deal = new Map<string, Loose>(((deals.data ?? []) as Loose[]).map((d) => [d.id, d]));
  const make = (r: Loose) => {
    const kind = QUEUE_KIND[r.queue_type as QueueType];
    const text = queueText(r, names, contact, deal);
    return item(kind, r.id, { ...text, who: users.get(r.assigned_to_user_id) ?? "Someone", ownerUserId: r.assigned_to_user_id, since: r.age_from, tone: r.escalated_at ? "danger" : undefined, ref: { carrierId: r.carrier_id, policyNumber: r.policy_number, fileId: r.queue_type === "initial_import" ? r.subject_id : null } }, today);
  };
  return {
    open: rows(openRes).map(make),
    closed: rows(closedRes).map((r: Loose) => ({ ...make(r), closedAs: closedWords(r.resolution), closedAt: r.resolved_at, href: closedHref(QUEUE_KIND[r.queue_type as QueueType]) })),
    notes: [],
  };
}

// ─── Money doesn't match · commission_discrepancy ────────────────────────────────────────────────────────

function moneyWhy(r: Loose): string {
  const label = DISCREPANCY_LABELS[r.discrepancy_type as DiscrepancyType]?.label ?? "Doesn't match";
  const figures = r.expected_amount_cents != null
    ? ` · expected ${dollars(Number(r.expected_amount_cents))} · paid ${dollars(r.reported_amount_cents == null ? 0 : Number(r.reported_amount_cents))}`
    : r.difference_cents != null ? ` · ${dollars(Number(r.difference_cents))}` : "";
  return `${label}${figures}${r.status === "disputed" ? " · letter drafted" : ""}`;
}

async function money(scope: NeedsYouScope, names: Names, today: string): Promise<Part> {
  if (!scope.keeper || !scope.money) return EMPTY;
  const columns = "id, carrier_id, discrepancy_type, policy_number, expected_amount_cents, reported_amount_cents, difference_cents, detected_at, status, resolution, resolved_at";
  const [open, closed, withheld] = await Promise.all([
    allRows(() => db().from("commission_discrepancy").select(columns).eq("tenant_id", scope.tenantId).in("status", ["open", "disputed"]).order("detected_at").order("id"), 50_000),
    db().from("commission_discrepancy").select(columns).eq("tenant_id", scope.tenantId).in("status", ["resolved", "dismissed"]).gte("resolved_at", since30()).order("resolved_at", { ascending: false }).limit(100),
    // LA-4.20: an item whose trace is broken is not shown, as on the Discrepancies page.
    untraceableDiscrepancies(scope.tenantId).catch(() => null),
  ]);
  const about = (r: Loose) => `${r.policy_number ?? "Carrier account"} · ${names.carrier.get(r.carrier_id) ?? "Carrier not known"}`;
  return {
    open: rows(open).filter((r: Loose) => !withheld?.has(r.id)).map((r: Loose) => item("money", r.id, { about: about(r), why: moneyWhy(r), who: KEEPERS, ownerUserId: null, since: r.detected_at, ref: { carrierId: r.carrier_id, policyNumber: r.policy_number } }, today)),
    closed: rows(closed).map((r: Loose) => ({ ...item("money", r.id, { about: about(r), why: moneyWhy(r), who: KEEPERS, ownerUserId: null, since: r.detected_at, closedAs: r.status === "dismissed" ? "Written off" : "Settled", closedAt: r.resolved_at }, today), href: closedHref("money") })),
    notes: [],
  };
}

/**
 * For the rail: the open findings the list hides because their trace is broken (LA-4.20), so the badge can
 * take them off its head count and say what the list shows.
 */
export async function hiddenOpenFindings(tenantId: string): Promise<number> {
  const withheld = await untraceableDiscrepancies(tenantId).catch(() => null);
  if (!withheld?.size) return 0;
  const ids = [...withheld.keys()];
  const { data } = await byIds(ids, (part) => db().from("commission_discrepancy").select("id").eq("tenant_id", tenantId).in("status", ["open", "disputed"]).in("id", part));
  return data.length;
}

// ─── Who gets the credit · agency_attribution_item ───────────────────────────────────────────────────────

const creditWhy = (r: Loose) =>
  r.kind === "disagreement" ? "The writing number and the application name different producers"
    : r.agent_identifier ? `Agent code ${r.agent_identifier} isn’t anyone yet` : "No writing number on the row";

async function credit(scope: NeedsYouScope, _names: Names, today: string): Promise<Part> {
  if (!scope.keeper || !scope.credit) return EMPTY;
  const columns = "id, kind, policy_number, agent_identifier, amount_cents, carrier_id, file_id, created_at, status, resolved_at, reason";
  const [open, closed] = await Promise.all([
    allRows(() => db().from("agency_attribution_item").select(columns).eq("tenant_id", scope.tenantId).eq("status", "open").order("created_at").order("id"), 20_000),
    db().from("agency_attribution_item").select(columns).eq("tenant_id", scope.tenantId).eq("status", "resolved").gte("resolved_at", since30()).order("resolved_at", { ascending: false }).limit(100),
  ]);
  const about = (r: Loose) => `${r.policy_number ?? "No policy number"} · ${dollars(Number(r.amount_cents))}`;
  return {
    open: rows(open).map((r: Loose) => item("credit", r.id, { about: about(r), why: creditWhy(r), who: KEEPERS, ownerUserId: null, since: r.created_at, ref: { carrierId: r.carrier_id, policyNumber: r.policy_number, fileId: r.file_id } }, today)),
    closed: rows(closed).map((r: Loose) => ({ ...item("credit", r.id, { about: about(r), why: creditWhy(r), who: KEEPERS, ownerUserId: null, since: r.created_at, closedAs: r.reason ? `Credited · ${r.reason}` : "Credited", closedAt: r.resolved_at }, today), href: closedHref("credit") })),
    notes: [],
  };
}

// ─── Who's the agent · agent codes nobody has ────────────────────────────────────────────────────────────

type UnmappedCode = { carrierId: string; code: string; policies: number; firstSeen: string };

/** Every carrier agent code on a policy that maps to nobody (Policy matching's Agent codes, the same rule). */
export async function unmappedAgentCodes(tenantId: string): Promise<UnmappedCode[]> {
  const read = await allRows(() => db().from("policy_current").select("carrier_id, agent_identifier, first_seen_date").eq("tenant_id", tenantId).is("agent_user_id", null).not("agent_identifier", "is", null).order("carrier_id").order("policy_number"), 50_000);
  const codes = new Map<string, UnmappedCode>();
  for (const row of rows(read) as Loose[]) {
    const key = `${row.carrier_id}|${row.agent_identifier}`;
    const entry = codes.get(key) ?? { carrierId: row.carrier_id, code: row.agent_identifier, policies: 0, firstSeen: row.first_seen_date };
    entry.policies++;
    if (row.first_seen_date && row.first_seen_date < entry.firstSeen) entry.firstSeen = row.first_seen_date;
    codes.set(key, entry);
  }
  return [...codes.values()];
}

async function agents(scope: NeedsYouScope, names: Names, today: string): Promise<Part> {
  if (!scope.keeper) return EMPTY;
  const codes = await unmappedAgentCodes(scope.tenantId);
  return {
    open: codes.map((c) => item("agent", agentItemId(c.carrierId, c.code), { about: `Agent code ${c.code} · ${names.carrier.get(c.carrierId) ?? "Carrier not known"}`, why: `${c.policies.toLocaleString("en-US")} ${c.policies === 1 ? "policy" : "policies"} · no one in the agency has this code`, who: KEEPERS, ownerUserId: null, since: c.firstSeen, ref: { carrierId: c.carrierId, agentCode: c.code } }, today)),
    closed: [],
    notes: [],
  };
}

// ─── Status word · unmapped_status_queue (Insurvas maps it) ──────────────────────────────────────────────

async function statusWords(scope: NeedsYouScope, names: Names, today: string): Promise<Part> {
  if (!scope.keeper) return EMPTY;
  const columns = "id, carrier_id, file_type, carrier_status_raw, row_count, first_seen_file_id, first_seen_at, resolved_at";
  const [open, closed] = await Promise.all([
    db().from("unmapped_status_queue").select(columns).eq("tenant_id", scope.tenantId).is("resolved_at", null).order("first_seen_at").limit(500),
    db().from("unmapped_status_queue").select(columns).eq("tenant_id", scope.tenantId).gte("resolved_at", since30()).order("resolved_at", { ascending: false }).limit(100),
  ]);
  const about = (r: Loose) => `“${r.carrier_status_raw}” · ${names.carrier.get(r.carrier_id) ?? "Carrier not known"}`;
  const why = (r: Loose) => `${Number(r.row_count ?? 0).toLocaleString("en-US")} ${Number(r.row_count) === 1 ? "row" : "rows"} held · Insurvas maps new words`;
  return {
    open: rows(open).map((r: Loose) => item("status-word", r.id, { about: about(r), why: why(r), who: "Insurvas", ownerUserId: null, since: r.first_seen_at, ref: { carrierId: r.carrier_id, fileId: r.first_seen_file_id, word: r.carrier_status_raw } }, today)),
    closed: rows(closed).map((r: Loose) => ({ ...item("status-word", r.id, { about: about(r), why: why(r), who: "Insurvas", ownerUserId: null, since: r.first_seen_at, closedAs: "Mapped by Insurvas", closedAt: r.resolved_at }, today), href: closedHref("status-word") })),
    notes: [],
  };
}

// ─── Two rules disagree · pipeline_rule_hold (live, open) ────────────────────────────────────────────────

const leadName = (values: Loose): string | null => {
  const v = values && typeof values === "object" ? values : {};
  const text = (key: string) => (typeof v[key] === "string" && v[key].trim() ? v[key].trim() : null);
  return [text("first_name"), text("last_name")].filter(Boolean).join(" ") || text("full_name") || text("name");
};

/** Lead names and stage names for some holds: what their rows and their choices say. */
async function holdWords(tenantId: string, holds: HoldRow[]) {
  const leadIds = [...new Set(holds.map((h) => h.leadId).filter(Boolean))] as string[];
  const [leads, board] = await Promise.all([
    leadIds.length ? db().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", leadIds.slice(0, 300)) : { data: [] },
    loadBoard(tenantId),
  ]);
  const lead = new Map<string, string | null>(((leads.data ?? []) as Loose[]).map((l) => [l.id, leadName(l.values)]));
  const stage = new Map<string, string>(board.flatMap((p) => p.stages.map((s) => [s.id, `${p.name} › ${s.name}`] as [string, string])));
  return { lead: (id: string | null) => (id ? lead.get(id) ?? null : null), stage: (id: string) => stage.get(id) ?? "a stage no longer on the board" };
}

async function ruleHolds(scope: NeedsYouScope, names: Names, today: string): Promise<Part> {
  if (!scope.keeper) return EMPTY;
  const read = await listRuleHolds(scope.tenantId, 1000);
  if (!read.available) return { ...EMPTY, notes: [PIPELINE_RULES_PENDING_MESSAGE] };
  const words = await holdWords(scope.tenantId, read.holds);
  return {
    open: read.holds.map((h) => {
      const carrier = names.carrier.get(h.carrierId) ?? "Carrier not known";
      const who = words.lead(h.leadId);
      return item("rules", h.id, {
        about: `${who ? `${who} · ` : ""}${h.policyNumber} · ${carrier}`,
        why: h.options.map((o) => `“${o.ruleName}” → ${words.stage(o.toStageId)}`).join(" and "),
        who: KEEPERS, ownerUserId: null, since: h.createdAt, ref: { carrierId: h.carrierId, policyNumber: h.policyNumber },
      }, today);
    }),
    closed: [],
    notes: [],
  };
}

export type NeedsYouList = { open: NeedsYouItem[]; closed: NeedsYouItem[]; notes: string[]; today: string };

/** Every open decision this person may see, oldest first, and what closed in the last 30 days. */
export async function loadNeedsYou(scope: NeedsYouScope): Promise<NeedsYouList> {
  const [today, carriers] = await Promise.all([agencyToday(scope.tenantId), db().from("carriers").select("id, name")]);
  const names: Names = { carrier: new Map(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name])), user: new Map() };
  const parts = await Promise.all([
    guarded("Pick the client", MATCHING_PENDING_MESSAGE, () => reviews(scope, names, today)),
    guarded("The exception queues", QUEUES_PENDING_MESSAGE, () => queue(scope, names, today)),
    guarded("Money doesn’t match", DISCREPANCIES_PENDING_MESSAGE, () => money(scope, names, today)),
    guarded("Who gets the credit", ATTRIBUTION_PENDING_MESSAGE, () => credit(scope, names, today)),
    guarded("Agent codes", MATCHING_PENDING_MESSAGE, () => agents(scope, names, today)),
    guarded("Status words", STATUS_WORDS_PENDING_MESSAGE, () => statusWords(scope, names, today)),
    guarded("Two rules disagree", PIPELINE_RULES_PENDING_MESSAGE, () => ruleHolds(scope, names, today)),
  ]);
  return {
    open: parts.flatMap((p) => p.open).sort(byOldest),
    closed: parts.flatMap((p) => p.closed).sort((a, b) => String(b.closedAt ?? "").localeCompare(String(a.closedAt ?? ""))),
    notes: [...new Set(parts.flatMap((p) => p.notes))],
    today,
  };
}

/**
 * Files › "Open all in Needs you" (?file=): what that one file touched — its policies (from its snapshots and its
 * commission lines), the agent codes on them, and the status words it was held on — so the list can show only
 * the items that came from it. Null when the file isn't this agency's.
 */
export async function loadFileFilter(tenantId: string, fileId: string): Promise<FileFilter | null> {
  const { data: file } = await db().from("file_registry").select("id, original_filename, carrier_id").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (!file) return null;
  const [snapshots, lines, finding] = await Promise.all([
    allRows(() => db().from("policy_snapshot").select("carrier_id, policy_number, agent_identifier").eq("tenant_id", tenantId).eq("file_id", fileId).order("policy_number"), 50_000),
    allRows(() => db().from("commission_entry").select("carrier_id, policy_number").eq("tenant_id", tenantId).eq("file_id", fileId).order("policy_number"), 50_000),
    db().from("agent_findings").select("payload").eq("tenant_id", tenantId).eq("file_id", fileId).eq("finding_type", "unmapped_status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const policies = new Set<string>();
  const codes = new Set<string>();
  for (const s of (snapshots.rows ?? []) as Loose[]) {
    if (s.policy_number) policies.add(`${s.carrier_id}|${s.policy_number}`);
    if (s.agent_identifier) codes.add(`${s.carrier_id}|${s.agent_identifier}`);
  }
  for (const l of (lines.rows ?? []) as Loose[]) if (l.policy_number) policies.add(`${l.carrier_id}|${l.policy_number}`);
  const words = new Set<string>(((finding.data?.payload?.held ?? []) as Array<{ raw: string }>).map((h) => h.raw).filter(Boolean));
  return { fileId: file.id, name: file.original_filename ?? "this file", carrierId: file.carrier_id ?? null, policies, codes, words };
}

// ─── One item's page ─────────────────────────────────────────────────────────────────────────────────────

/** The carrier's row exactly as sent, from the file's raw layer (the trace the row page reads). */
export type RowAsSent = { fileId: string; fileName: string; rowNumber: number; columns: Array<{ column: string; header: string; value: string; readAs: string | null }> };

async function rowAsSent(tenantId: string, at: { fileId: string; rowNumber: number } | null): Promise<RowAsSent | null> {
  if (!at) return null;
  const trace = await loadRowTrace(tenantId, at.fileId, at.rowNumber).catch(() => null);
  if (!trace) return null;
  return { fileId: trace.file.id, fileName: trace.file.name, rowNumber: trace.rowNumber, columns: trace.columns.map((c) => ({ column: c.column, header: c.header, value: c.value, readAs: c.becameField })) };
}

async function rowNumberOf(tenantId: string, fileId: string | null, rawRowId: string | null): Promise<{ fileId: string; rowNumber: number } | null> {
  if (!fileId || !rawRowId) return null;
  const { data } = await db().from("raw_rows").select("row_number").eq("tenant_id", tenantId).eq("id", rawRowId).maybeSingle();
  return data ? { fileId, rowNumber: Number(data.row_number) } : null;
}

/** The latest policy row a carrier file sent for a policy (or for an agent code), optionally from one file. */
async function policyRow(tenantId: string, carrierId: string | null, match: { policyNumber?: string | null; agentCode?: string; fileId?: string | null }) {
  if (!carrierId || (!match.policyNumber && !match.agentCode)) return null;
  let query = db().from("policy_snapshot").select("file_id, raw_row_id, snapshot_date").eq("tenant_id", tenantId).eq("carrier_id", carrierId).not("raw_row_id", "is", null);
  query = match.policyNumber ? query.eq("policy_number", match.policyNumber) : query.eq("agent_identifier", match.agentCode);
  if (match.fileId) query = query.eq("file_id", match.fileId);
  const { data } = await query.order("snapshot_date", { ascending: false }).limit(1);
  const snap = (data ?? [])[0];
  return snap ? rowNumberOf(tenantId, snap.file_id, snap.raw_row_id) : null;
}

async function commissionRow(tenantId: string, carrierId: string | null, policyNumber: string | null) {
  if (!carrierId || !policyNumber) return null;
  const { data } = await db().from("commission_entry").select("file_id, raw_row_id, created_at").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).not("raw_row_id", "is", null).order("created_at", { ascending: false }).limit(1);
  const line = (data ?? [])[0];
  return line ? rowNumberOf(tenantId, line.file_id, line.raw_row_id) : null;
}

export type Candidate = {
  index: number; type: "deal_flow" | "application"; date: string; name: string;
  dob: string | null; phone: string | null; premiumCents: number | null; faceCents: number | null;
  fields: Record<MatchField, FieldOutcome>; score: number; likely: boolean;
};
export type CarrierRow = { name: string; dob: string | null; phone: string | null; premiumCents: number | null; faceCents: number | null; agentIdentifier: string | null; fileDate: string | null };
export type Person = { userId: string; name: string };

export type ItemDetail =
  | { kind: "pick-client"; reviewId: string; policyNumber: string; carrierName: string; carrierRow: CarrierRow; candidates: Candidate[] }
  | { kind: QueueKind; queue: QueueItemRow }
  | { kind: "money"; finding: DiscrepancyRow; disputable: boolean }
  | { kind: "credit"; id: string; kindOfRow: "disagreement" | "unattributed"; policyNumber: string | null; agentCode: string | null; amountCents: number; carrierName: string | null; writingNumber: Person | null; application: Person | null; producers: Person[] }
  | { kind: "agent"; carrierId: string; carrierName: string; code: string; policies: number; members: Person[] }
  | { kind: "status-word"; word: string; carrierName: string; fileType: string; rows: number; firstSeenFileId: string | null }
  | { kind: "rules"; holdId: string; leadId: string | null; leadName: string | null; carrierName: string; policyNumber: string; options: Array<{ ruleId: string; ruleName: string; version: number; stage: string }> };

export type ItemPage = { detail: ItemDetail; row: RowAsSent | null };

/**
 * One open exception item, shaped as the Exceptions page shapes it, with the same choices (the same reads as
 * loadQueues makes for each item: confirmed clients by the insured's last name and the recent submitted sales
 * for a policy with no sale; the carrier's policies and the client's application attempts for a sale no
 * carrier has). Null when it is closed, gone, or someone else's for a producer.
 */
async function oneQueueItem(scope: NeedsYouScope, id: string): Promise<QueueItemRow | null> {
  const t = scope.tenantId;
  const { data: i } = await db().from("queue_item").select("*").eq("tenant_id", t).eq("id", id).maybeSingle();
  if (!i || i.status !== "open" || !(QUEUE_TYPES as readonly string[]).includes(i.queue_type)) return null;
  if (!scope.keeper && i.assigned_to_user_id !== scope.userId) return null;
  const contactIds = [i.contact_id, i.related_contact_id].filter(Boolean);
  const [carrier, contacts, deal, users] = await Promise.all([
    i.carrier_id ? db().from("carriers").select("name").eq("id", i.carrier_id).maybeSingle() : { data: null },
    contactIds.length ? db().from("contacts").select("id, first_name, last_name, provisional").eq("tenant_id", t).in("id", contactIds) : { data: [] },
    i.deal_id ? db().from("deal_flow").select("id, lead_id, insured_name, local_date, monthly_premium_cents, carrier").eq("tenant_id", t).eq("id", i.deal_id).maybeSingle() : { data: null },
    userNames([i.assigned_to_user_id]),
  ]);
  const person = (cid: string | null) => {
    const c = ((contacts.data ?? []) as Loose[]).find((x) => x.id === cid);
    return c ? { id: c.id, name: `${c.first_name} ${c.last_name}`, provisional: Boolean(c.provisional) } : null;
  };
  const d = deal.data as Loose;
  const choices: QueueItemRow["choices"] = {};
  if (i.queue_type === "no_deal_flow") {
    const lastName = String(i.payload?.insured?.last_name ?? "").replace(/[%_]/g, "");
    const [byName, recent] = await Promise.all([
      lastName ? db().from("contacts").select("id, first_name, last_name, dob").eq("tenant_id", t).is("merged_into_id", null).eq("provisional", false).ilike("last_name", lastName).limit(10) : { data: [] },
      db().from("deal_flow").select("id, insured_name, local_date").eq("tenant_id", t).eq("call_result", "application_submitted").gte("local_date", new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)).order("local_date", { ascending: false }).limit(25),
    ]);
    choices.contacts = ((byName.data ?? []) as Loose[]).map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`, dob: c.dob }));
    choices.deals = ((recent.data ?? []) as Loose[]).map((x) => ({ id: x.id, name: x.insured_name ?? "—", date: x.local_date }));
  } else if (i.queue_type === "no_policy") {
    const [policies, apps, carriers] = await Promise.all([
      i.carrier_id ? db().from("policy_current").select("carrier_id, policy_number, status_normalized").eq("tenant_id", t).eq("carrier_id", i.carrier_id).limit(200) : { data: [] },
      d?.lead_id ? db().from("tenant_applications").select("id, carrier_id, attempt_no, status").eq("tenant_id", t).eq("lead_id", d.lead_id).order("attempt_no") : { data: [] },
      db().from("carriers").select("id, name"),
    ]);
    const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
    choices.policies = ((policies.data ?? []) as Loose[]).map((p) => ({ carrierId: p.carrier_id, policyNumber: p.policy_number, label: `${p.policy_number} · ${p.status_normalized ?? "—"}` }));
    choices.applications = ((apps.data ?? []) as Loose[]).map((a) => ({ id: a.id, label: `Attempt ${a.attempt_no} · ${carrierName.get(a.carrier_id) ?? "no carrier"} · ${a.status}` }));
  }
  return {
    id: i.id, queueType: i.queue_type, status: i.status, ageFrom: i.age_from, createdAt: i.created_at, escalated: Boolean(i.escalated_at),
    assigneeId: i.assigned_to_user_id, assigneeName: users.get(i.assigned_to_user_id) ?? "—", assignedRole: i.assigned_role,
    carrierId: i.carrier_id, carrierName: (carrier.data as Loose)?.name ?? null, policyNumber: i.policy_number,
    contact: person(i.contact_id), related: person(i.related_contact_id),
    deal: d ? { id: d.id, insuredName: d.insured_name, date: d.local_date, premiumCents: d.monthly_premium_cents, carrier: d.carrier, leadId: d.lead_id } : null,
    payload: i.payload ?? {}, resolution: null, resolutionNote: null, resolvedAt: null, resolvedByName: null, choices,
  };
}

const nameOf = (p: { firstName?: string | null; lastName?: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(" ") || "—";

/**
 * What one item's page needs: the evidence, the choices its resolution API accepts, and (for the owner and
 * bookkeepers, who may open a file's rows) the carrier's row as sent. Null when it is not there any more, or
 * not this person's to see.
 */
export async function loadItemPage(scope: NeedsYouScope, kind: NeedsYouKind, id: string): Promise<ItemPage | null> {
  const t = scope.tenantId;
  const carrierName = async (carrierId: string | null) => (carrierId ? (await db().from("carriers").select("name").eq("id", carrierId).maybeSingle()).data?.name ?? "Carrier not known" : "Carrier not known");

  if (kind === "pick-client") {
    if (!scope.keeper) return null;
    const { data: r } = await db().from("policy_match_review").select("id, carrier_id, policy_number, carrier_row, shortlist, file_id, status").eq("tenant_id", t).eq("id", id).maybeSingle();
    if (!r || r.status !== "open") return null;
    const row = r.carrier_row ?? {};
    return {
      detail: {
        kind, reviewId: r.id, policyNumber: r.policy_number, carrierName: await carrierName(r.carrier_id),
        carrierRow: { name: nameOf(row), dob: row.dob ?? null, phone: row.phone ?? null, premiumCents: row.premiumCents ?? null, faceCents: row.faceCents ?? null, agentIdentifier: row.agentIdentifier ?? null, fileDate: row.fileDate ?? null },
        candidates: ((r.shortlist ?? []) as Loose[]).map((c, index) => ({ index, type: c.type, date: c.date, name: nameOf(c), dob: c.dob ?? null, phone: c.phone ?? null, premiumCents: c.premiumCents ?? null, faceCents: c.faceCents ?? null, fields: c.fields ?? {}, score: Number(c.score ?? 0), likely: Boolean(c.likely) })),
      },
      row: await rowAsSent(t, await policyRow(t, r.carrier_id, { policyNumber: r.policy_number, fileId: r.file_id }) ?? await policyRow(t, r.carrier_id, { policyNumber: r.policy_number })),
    };
  }

  if (kind === "no-sale" || kind === "no-carrier" || kind === "same-person" || kind === "existing-book" || kind === "commission-no-policy") {
    // This one item with the choices the Exceptions page offers it (loadQueues stops at the 500 oldest).
    const q = await oneQueueItem(scope, id);
    if (!q || QUEUE_KIND[q.queueType] !== kind) return null;
    const at = !scope.keeper ? null
      : kind === "no-sale" ? await policyRow(t, q.carrierId, { policyNumber: q.policyNumber })
        : kind === "commission-no-policy" ? await commissionRow(t, q.carrierId, q.policyNumber)
          : null;
    return { detail: { kind, queue: q }, row: await rowAsSent(t, at) };
  }

  if (kind === "money") {
    if (!scope.keeper || !scope.money) return null;
    const list = await loadDiscrepancies(t);
    if (!list.available) return null;
    const finding = list.items.find((entry) => entry.id === id);
    if (!finding || !["open", "disputed"].includes(finding.status)) return null;
    const line = finding.reportedLines.find((l) => l.rowNumber !== null);
    return { detail: { kind, finding, disputable: finding.status === "open" && DISPUTABLE.has(finding.type) }, row: await rowAsSent(t, line ? { fileId: line.fileId, rowNumber: line.rowNumber! } : null) };
  }

  if (kind === "credit") {
    if (!scope.keeper || !scope.credit) return null;
    const { data: r } = await db().from("agency_attribution_item").select("id, kind, status, writing_number_user_id, application_user_id, carrier_id, policy_number, agent_identifier, amount_cents, file_id, row_number").eq("tenant_id", t).eq("id", id).maybeSingle();
    if (!r || r.status !== "open") return null;
    const { data: producers } = await db().from("producer").select("user_id, display_name, status").eq("tenant_id", t).neq("status", "offboarded").order("display_name");
    const people: Person[] = ((producers ?? []) as Loose[]).map((p) => ({ userId: p.user_id, name: p.display_name }));
    const named = await userNames([r.writing_number_user_id, r.application_user_id]);
    const person = (userId: string | null) => (userId ? { userId, name: people.find((p) => p.userId === userId)?.name ?? named.get(userId) ?? "A producer" } : null);
    return {
      detail: { kind, id: r.id, kindOfRow: r.kind, policyNumber: r.policy_number, agentCode: r.agent_identifier, amountCents: Number(r.amount_cents), carrierName: r.carrier_id ? await carrierName(r.carrier_id) : null, writingNumber: person(r.writing_number_user_id), application: person(r.application_user_id), producers: people },
      row: await rowAsSent(t, r.file_id && r.row_number ? { fileId: r.file_id, rowNumber: Number(r.row_number) } : null),
    };
  }

  if (kind === "agent") {
    if (!scope.keeper) return null;
    const parsed = parseAgentItemId(id);
    if (!parsed) return null;
    const { count } = await db().from("policy_current").select("policy_number", { count: "exact", head: true }).eq("tenant_id", t).eq("carrier_id", parsed.carrierId).eq("agent_identifier", parsed.code).is("agent_user_id", null);
    if (!count) return null;
    const { data: members } = await db().from("tenant_users").select("user_id, role, accepted_at").eq("tenant_id", t);
    const writers = ((members ?? []) as Loose[]).filter((m) => m.accepted_at && WRITING_ROLES.includes(m.role));
    const named = await userNames(writers.map((m) => m.user_id));
    return {
      detail: { kind, carrierId: parsed.carrierId, carrierName: await carrierName(parsed.carrierId), code: parsed.code, policies: count, members: writers.map((m) => ({ userId: m.user_id, name: named.get(m.user_id) ?? "Someone" })).sort((a, b) => a.name.localeCompare(b.name)) },
      row: await rowAsSent(t, await policyRow(t, parsed.carrierId, { agentCode: parsed.code })),
    };
  }

  if (kind === "status-word") {
    if (!scope.keeper) return null;
    const { data: w } = await db().from("unmapped_status_queue").select("id, carrier_id, file_type, carrier_status_raw, row_count, first_seen_file_id, resolved_at").eq("tenant_id", t).eq("id", id).maybeSingle();
    if (!w || w.resolved_at) return null;
    return { detail: { kind, word: w.carrier_status_raw, carrierName: await carrierName(w.carrier_id), fileType: w.file_type, rows: Number(w.row_count ?? 0), firstSeenFileId: w.first_seen_file_id ?? null }, row: null };
  }

  if (kind === "rules") {
    if (!scope.keeper) return null;
    const read = await listRuleHolds(t, 1000);
    const hold = read.holds.find((h) => h.id === id);
    if (!hold) return null;
    const words = await holdWords(t, [hold]);
    return {
      detail: { kind, holdId: hold.id, leadId: hold.leadId, leadName: words.lead(hold.leadId), carrierName: await carrierName(hold.carrierId), policyNumber: hold.policyNumber, options: hold.options.map((o) => ({ ruleId: o.ruleId, ruleName: o.ruleName, version: o.version, stage: words.stage(o.toStageId) })) },
      row: await rowAsSent(t, await policyRow(t, hold.carrierId, { policyNumber: hold.policyNumber })),
    };
  }
  return null;
}
