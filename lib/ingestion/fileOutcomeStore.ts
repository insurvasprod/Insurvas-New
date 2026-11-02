import "server-only";

import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { mapLimit } from "@/lib/retention/batch";

import { fileStages, linkMethodLabel, needsCount, notInFile, rowOutcome, whereItIs, ROW_OUTCOMES, type FileStage, type FileStageFacts, type FileStageView, type RowOutcome, type WhereItIs } from "./fileStages";
import { unfinishedSteps, type CarrierFileRow } from "./registry";
import type { RawColumnView } from "./trace";
import { itemHref, KIND_META, QUEUE_KIND, waitsOnInsurvas, type NeedsYouKind } from "@/lib/needsYou/kinds";

/**
 * Book of business, round 2 · Files (owner 2026-11-02, docs/la4/BUILD-ROUND2.md): what a carrier file came
 * to, read from what the pipeline already wrote — the registry, the run's steps, snapshots and the change
 * log, the links, the review queue, the exception queues, the ledger and the cards the issue sync moved.
 * Nothing is stored per row: every outcome is derived here, so this writes nothing.
 *
 * Every read filters tenant_id (the service role has no RLS predicate). A table a later migration adds
 * is read as empty until it exists.
 */

// The LA-4 tables are newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const PAGE = 1000;
const CHUNK = 200;

/** Every row of a query, a thousand at a time (a 10,000-row file is ten reads). Empty before its migration. */
async function all(build: () => Loose, cap = 20_000): Promise<Loose[]> {
  const out: Loose[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) {
      if (isSchemaGap(error) || error.code === "42703") return out;
      throw new Error(`Could not read the file's outcome: ${error.message}`);
    }
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/** One query per chunk of keys, six at a time. */
async function chunked(keys: string[], build: (part: string[]) => Loose): Promise<Loose[]> {
  const unique = [...new Set(keys)];
  if (!unique.length) return [];
  const parts = Array.from({ length: Math.ceil(unique.length / CHUNK) }, (_, n) => unique.slice(n * CHUNK, n * CHUNK + CHUNK));
  const results = await mapLimit(parts, 6, (part) => build(part));
  const out: Loose[] = [];
  for (const { data, error } of results as Loose[]) {
    if (error) {
      if (isSchemaGap(error) || error.code === "42703") return out;
      throw new Error(`Could not read the file's outcome: ${error.message}`);
    }
    out.push(...(data ?? []));
  }
  return out;
}

const isPolicyFeed = (type: string | null) => type === "policies" || type === "new_business";
const personName = (c: Loose | undefined) => (c ? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null : null);

// ─── the list ──────────────────────────────────────────────────────────────────────────────────

/**
 * The exception item a policy file raises for one of its rows: "policy with no sale" (queue_item no_deal_flow).
 * queue_item has no file id, so an item belongs to the file of its carrier and of the file date it carries
 * (payload.file_date, refreshed each time a later file raises it again): the latest file that raised it. Tying
 * by policy number alone would hand the same item to every daily file of that carrier. Other queue kinds are
 * not a row's: "sale no carrier has" (no_policy) is a sale with no carrier policy at all, and "same person?"
 * (multi_policy) is about a client.
 */
export const ROW_QUEUE_TYPE = "no_deal_flow";

/** Whether a file is the one its row items are tied to: a current, read policy file with a date. */
const raisesRowItems = (file: { status: string; fileType: string | null; fileDate: string | null; carrierId: string | null }) =>
  file.status === "parsed" && isPolicyFeed(file.fileType) && Boolean(file.fileDate && file.carrierId);

/** Open row items per carrier and file date ("carrier|yyyy-mm-dd"). */
export async function noSaleCounts(tenantId: string): Promise<Map<string, number>> {
  const rows = await all(() => db().from("queue_item").select("id, carrier_id, file_date:payload->>file_date").eq("tenant_id", tenantId).eq("queue_type", ROW_QUEUE_TYPE).eq("status", "open").order("id"));
  const out = new Map<string, number>();
  for (const row of rows) if (row.carrier_id && row.file_date) out.set(`${row.carrier_id}|${row.file_date}`, (out.get(`${row.carrier_id}|${row.file_date}`) ?? 0) + 1);
  return out;
}

/** The facts the list already has for a file, plus its open reviews and the row items it raised. */
export function factsOf(file: CarrierFileRow, openReviews: number, noSaleItems = 0): FileStageFacts {
  return {
    status: file.status,
    fileType: file.fileType,
    carrierKnown: Boolean(file.carrierId),
    waitingForLayout: file.waitingForLayout,
    rowsKept: file.rowCount !== null,
    errorDetail: file.errorDetail ?? file.rawError,
    heldRows: file.heldRows,
    completed: file.completed,
    unfinishedStage: file.unfinished?.stage ?? null,
    openReviews,
    noSaleItems,
  };
}

/** Open policy_match_review rows per file: the policies each file left for a person to link. */
export async function openReviewCounts(tenantId: string, fileIds: string[]): Promise<Map<string, number>> {
  const rows = await chunked(fileIds, (part) => db().from("policy_match_review").select("file_id").eq("tenant_id", tenantId).eq("status", "open").in("file_id", part).limit(10_000));
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.file_id, (out.get(row.file_id) ?? 0) + 1);
  return out;
}

/** Each listed file's eight stages and where it is. */
export async function listFileStages(tenantId: string, files: CarrierFileRow[]): Promise<Record<string, FileStageView>> {
  const [reviews, noSale] = await Promise.all([openReviewCounts(tenantId, files.filter((f) => f.status === "parsed").map((f) => f.id)), noSaleCounts(tenantId)]);
  const out: Record<string, FileStageView> = {};
  const claimed = new Set<string>();
  for (const file of files) {
    // Newest first: of two current files with the same carrier and date, the newer one holds the items.
    const key = `${file.carrierId}|${file.fileDate}`;
    const items = raisesRowItems(file) && !claimed.has(key) ? noSale.get(key) ?? 0 : 0;
    if (raisesRowItems(file)) claimed.add(key);
    const stages = fileStages(factsOf(file, reviews.get(file.id) ?? 0, items));
    out[file.id] = { stages, where: whereItIs(stages, file.status === "superseded"), needs: needsCount(stages) };
  }
  return out;
}

// ─── Missing (the file monitor, LA-4.17 cadence + LA-4.19) ──────────────────────────────────────

export type MissingFileView = { id: string; carrierId: string; carrierName: string; cadence: string; due: string; daysLate: number; lastReceivedAt: string | null; reasoning: string };

export async function loadMissingFiles(tenantId: string, today = new Date().toISOString().slice(0, 10)): Promise<{ available: boolean; missing: MissingFileView[] }> {
  const { data, error } = await db().from("agent_findings").select("id, payload, reasoning").eq("tenant_id", tenantId).eq("agent_name", "file_monitor").eq("finding_type", "missing_file").eq("status", "open").order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (isSchemaGap(error)) return { available: false, missing: [] };
    throw new Error(`Could not read the missing files: ${error.message}`);
  }
  const rows = (data ?? []) as Loose[];
  const ids = [...new Set(rows.map((r) => r.payload?.carrier_id).filter(Boolean))] as string[];
  const { data: carriers } = ids.length ? await db().from("carriers").select("id, name").in("id", ids) : { data: [] };
  const name = new Map(((carriers ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return {
    available: true,
    missing: rows.map((r) => {
      const due = String(r.payload?.due ?? "");
      return {
        id: r.id, carrierId: r.payload?.carrier_id ?? "", carrierName: name.get(r.payload?.carrier_id) ?? "Carrier not known", cadence: r.payload?.cadence ?? "",
        due, daysLate: /^\d{4}-\d{2}-\d{2}/.test(due) ? Math.max(0, Math.round((day(today) - day(due)) / 86_400_000)) : 0,
        lastReceivedAt: r.payload?.last_received_at ?? null, reasoning: r.reasoning,
      };
    }).sort((a, b) => b.daysLate - a.daysLate),
  };
}

// ─── one file: its head ─────────────────────────────────────────────────────────────────────────

export type FileLink = { id: string; name: string; fileDate: string | null };

export type FileHead = {
  id: string;
  name: string;
  carrierId: string | null;
  carrierName: string | null;
  fileType: string | null;
  fileKind: string | null;
  fileDate: string | null;
  agency: string | null;
  source: string;
  emailFrom: string | null;
  receivedAt: string;
  parsedAt: string | null;
  completedAt: string | null;
  status: string;
  errorDetail: string | null;
  map: { name: string; version: number; layoutKey: string | null } | null;
  mapId: string | null;
  rowCount: number | null;
  parsedRows: number | null;
  heldRows: number;
  supersededBy: FileLink | null;
  replaces: FileLink | null;
  previous: FileLink | null;
  unfinished: { stage: string; error: string | null } | null;
  openReviews: number;
  rawColumns: RawColumnView[];
  facts: FileStageFacts;
  stages: FileStage[];
  where: WhereItIs;
};

const HEAD_COLUMNS = "id, original_filename, carrier_id, file_type, file_kind, file_date, path_agency, source, email_from, received_at, parsed_at, pipeline_completed_at, status, error_detail, raw_error, parse_block, parser_id, raw_extracted_at, row_count, parsed_row_count, held_row_count, superseded_by_file_id, raw_columns";

/** A file's head: what it is, where it came from, its neighbours and its eight stages. Null when not this agency's. */
export const loadFileHead = cache(async (tenantId: string, fileId: string): Promise<FileHead | null> => {
  const { data: f, error } = await db().from("file_registry").select(HEAD_COLUMNS).eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!f) return null;
  const link = (row: Loose | null | undefined): FileLink | null => (row ? { id: row.id, name: row.original_filename, fileDate: row.file_date } : null);
  const previousQuery = () => {
    let query = db().from("file_registry").select("id, original_filename, file_date").eq("tenant_id", tenantId).eq("carrier_id", f.carrier_id).eq("file_type", f.file_type).eq("status", "parsed").is("superseded_by_file_id", null).neq("id", f.id);
    query = f.file_date ? query.lt("file_date", f.file_date) : query.lt("received_at", f.received_at);
    return query.order("file_date", { ascending: false }).order("received_at", { ascending: false }).limit(1).maybeSingle();
  };
  const [carrier, map, replaced, supersededBy, previous, reviews, unfinished] = await Promise.all([
    f.carrier_id ? db().from("carriers").select("name").eq("id", f.carrier_id).maybeSingle() : { data: null },
    f.parser_id ? db().from("carrier_layout_map").select("name, version, layout_key").eq("id", f.parser_id).maybeSingle() : { data: null },
    db().from("file_registry").select("id, original_filename, file_date").eq("tenant_id", tenantId).eq("superseded_by_file_id", f.id).order("received_at", { ascending: false }).limit(1).maybeSingle(),
    f.superseded_by_file_id ? db().from("file_registry").select("id, original_filename, file_date").eq("tenant_id", tenantId).eq("id", f.superseded_by_file_id).maybeSingle() : { data: null },
    f.carrier_id && f.file_type ? previousQuery() : { data: null },
    f.status === "parsed" ? db().from("policy_match_review").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("file_id", f.id).eq("status", "open") : { count: 0 },
    f.status === "parsed" && !f.pipeline_completed_at ? unfinishedSteps(tenantId, [f.id]) : new Map(),
  ]);
  const rowItems = raisesRowItems({ status: f.status, fileType: f.file_type, fileDate: f.file_date, carrierId: f.carrier_id })
    ? await db().from("queue_item").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("carrier_id", f.carrier_id).eq("queue_type", ROW_QUEUE_TYPE).eq("status", "open").eq("payload->>file_date", f.file_date)
    : { count: 0 };
  const step = (unfinished as Map<string, { stage: string; error: string | null }>).get(f.id) ?? null;
  const openReviews = Number((reviews as Loose).count ?? 0);
  const facts: FileStageFacts = {
    status: f.status,
    fileType: f.file_type,
    carrierKnown: Boolean(f.carrier_id),
    waitingForLayout: f.parse_block === "no_layout_map",
    rowsKept: Boolean(f.raw_extracted_at),
    errorDetail: f.error_detail ?? f.raw_error ?? null,
    heldRows: Number(f.held_row_count ?? 0),
    completed: Boolean(f.pipeline_completed_at),
    unfinishedStage: step?.stage ?? null,
    openReviews,
    noSaleItems: Number((rowItems as Loose).count ?? 0),
  };
  const stages = fileStages(facts);
  return {
    id: f.id, name: f.original_filename, carrierId: f.carrier_id, carrierName: carrier.data?.name ?? null, fileType: f.file_type, fileKind: f.file_kind, fileDate: f.file_date,
    agency: f.path_agency ?? null, source: f.source, emailFrom: f.email_from ?? null, receivedAt: f.received_at, parsedAt: f.parsed_at ?? null, completedAt: f.pipeline_completed_at ?? null,
    status: f.status, errorDetail: f.error_detail ?? f.raw_error ?? null,
    map: map.data ? { name: map.data.name, version: map.data.version, layoutKey: map.data.layout_key ?? null } : null, mapId: f.parser_id ?? null,
    rowCount: f.raw_extracted_at ? Number(f.row_count ?? 0) : null, parsedRows: f.parsed_row_count ?? null, heldRows: Number(f.held_row_count ?? 0),
    supersededBy: link(supersededBy.data), replaces: link(replaced.data), previous: link(previous.data),
    unfinished: step, openReviews,
    rawColumns: ((f.raw_columns ?? []) as RawColumnView[]).filter((c) => c.header.trim() !== ""),
    facts, stages, where: whereItIs(stages, f.status === "superseded"),
  };
});

// ─── one file: every row's outcome ──────────────────────────────────────────────────────────────

export type CardMove = { from: string | null; to: string; at: string };

export type RowView = {
  rowNumber: number;
  rawRowId: string;
  outcome: RowOutcome;
  policyNumber: string | null;
  clientName: string | null;
  contactId: string | null;
  /** One line: what this row changed, or why it waits. */
  what: string;
  linkedBy: string | null;
  linkedAt: string | null;
  card: CardMove | null;
  changes: Array<{ field: string; from: string | null; to: string | null }>;
  lines: Array<{ type: string; amountCents: number }>;
  heldWord: string | null;
  reviewId: string | null;
  reviewChoices: number | null;
};

export type FileRows = {
  rows: RowView[];
  counts: Record<RowOutcome, number>;
  linkedByNumber: number;
  /** Rows whose policy has a client, and by which method (policy_match.method → rows). */
  linked: number;
  linkMethods: Record<string, number>;
  cardsMoved: number;
  changedPolicies: number;
  newPolicies: number;
  /** Queue items (exception queues) open on this file's policies. */
  queueItems: Array<{ id: string; queueType: string; policyNumber: string | null }>;
};

const EMPTY_COUNTS = (): Record<RowOutcome, number> => Object.fromEntries(ROW_OUTCOMES.map((o) => [o, 0])) as Record<RowOutcome, number>;

/** The column a layout reads the carrier's status word from, as a raw_rows payload key. */
async function statusKey(head: FileHead): Promise<string | null> {
  if (!head.mapId) return null;
  const { data } = await db().from("carrier_layout_map_entry").select("source_column, target_field").eq("map_id", head.mapId).eq("target_field", "carrier_status_raw").limit(1);
  const column = ((data ?? []) as Loose[])[0]?.source_column;
  return column ? head.rawColumns.find((c) => c.header === column)?.key ?? null : null;
}

/** The pipeline stages' names, for the card a move went to. */
async function stageNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await chunked(ids, (part) => db().from("tenant_pipeline_stages").select("id, name, tenant_pipelines!inner(tenant_id)").in("id", part).eq("tenant_pipelines.tenant_id", tenantId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The cards the issue sync moved while this file was processed: moves the stage sync wrote for the
 * applications behind this file's policies, between the file being read and its steps finishing.
 */
async function cardMoves(tenantId: string, head: FileHead, appByPolicy: Map<string, string>): Promise<Map<string, CardMove>> {
  const out = new Map<string, CardMove>();
  const apps = [...new Set(appByPolicy.values())];
  if (!apps.length || !head.parsedAt) return out;
  const from = new Date(new Date(head.parsedAt).getTime() - 60_000).toISOString();
  const to = new Date(new Date(head.completedAt ?? head.parsedAt).getTime() + 15 * 60_000).toISOString();
  const events = await chunked(apps, (part) => db().from("tenant_lead_stage_events").select("application_id, from_stage_id, to_stage_id, created_at").eq("tenant_id", tenantId).eq("source", "application_sync").in("application_id", part).gte("created_at", from).lte("created_at", to).order("created_at"));
  if (!events.length) return out;
  const names = await stageNames(tenantId, events.flatMap((e) => [e.from_stage_id, e.to_stage_id]).filter(Boolean));
  const policyByApp = new Map([...appByPolicy.entries()].map(([policy, app]) => [app, policy]));
  for (const e of events) {
    const policy = policyByApp.get(e.application_id);
    if (policy) out.set(policy, { from: e.from_stage_id ? names.get(e.from_stage_id) ?? null : null, to: names.get(e.to_stage_id) ?? "another stage", at: e.created_at });
  }
  return out;
}

/** Every row of one file and what it came to. Read-only; cached for the request. */
export const loadFileRows = cache(async (tenantId: string, fileId: string): Promise<FileRows | null> => {
  const head = await loadFileHead(tenantId, fileId);
  if (!head) return null;
  const empty: FileRows = { rows: [], counts: EMPTY_COUNTS(), linkedByNumber: 0, linked: 0, linkMethods: {}, cardsMoved: 0, changedPolicies: 0, newPolicies: 0, queueItems: [] };
  if (head.rowCount === null) return empty;

  const policyFeed = isPolicyFeed(head.fileType);
  const [raws, snaps, changes, firstSeen, reviews, lines] = await Promise.all([
    all(() => db().from("raw_rows").select("id, row_number").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number")),
    policyFeed ? all(() => db().from("policy_snapshot").select("raw_row_id, policy_number, status_normalized, carrier_status_raw, premium_cents, premium_mode").eq("tenant_id", tenantId).eq("file_id", fileId).order("policy_number")) : [],
    policyFeed ? all(() => db().from("policy_change").select("policy_number, field_name, old_value, new_value").eq("tenant_id", tenantId).eq("to_file_id", fileId).order("policy_number")) : [],
    policyFeed ? all(() => db().from("policy_event").select("policy_number").eq("tenant_id", tenantId).eq("file_id", fileId).eq("event_type", "first_seen").order("policy_number")) : [],
    policyFeed ? all(() => db().from("policy_match_review").select("id, policy_number, shortlist").eq("tenant_id", tenantId).eq("file_id", fileId).eq("status", "open").order("id")) : [],
    head.fileType === "commissions" ? all(() => db().from("commission_entry").select("raw_row_id, policy_number, entry_type, corrects_type, amount_cents").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number")) : [],
  ]);

  const snapByRow = new Map<string, Loose>(snaps.map((s) => [s.raw_row_id, s]));
  const changesBy = new Map<string, Array<{ field: string; from: string | null; to: string | null }>>();
  for (const c of changes) changesBy.set(c.policy_number, [...(changesBy.get(c.policy_number) ?? []), { field: c.field_name, from: c.old_value, to: c.new_value }]);
  const isNew = new Set(firstSeen.map((e) => e.policy_number as string));
  const reviewBy = new Map<string, Loose>(reviews.map((r) => [r.policy_number, r]));
  const linesBy = new Map<string, Array<{ type: string; amountCents: number; policy: string }>>();
  for (const l of lines) linesBy.set(l.raw_row_id, [...(linesBy.get(l.raw_row_id) ?? []), { type: l.entry_type === "reversal" && l.corrects_type ? `reversal of ${l.corrects_type}` : l.entry_type, amountCents: Number(l.amount_cents), policy: l.policy_number }]);

  const policies = [...new Set([...snaps.map((s) => s.policy_number as string), ...lines.map((l) => l.policy_number as string)])];
  const [current, matches, queue] = head.carrierId ? await Promise.all([
    chunked(policies, (part) => db().from("policy_current").select("policy_number, contact_id, application_id").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).in("policy_number", part)),
    policyFeed ? chunked(policies, (part) => db().from("policy_match").select("policy_number, method, created_at").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).is("superseded_by_id", null).in("policy_number", part)) : Promise.resolve([] as Loose[]),
    // Only the row items this file raised (see ROW_QUEUE_TYPE): the same rule the strip counts by.
    head.status === "parsed" && policyFeed && head.fileDate
      ? chunked(policies, (part) => db().from("queue_item").select("id, queue_type, policy_number").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).eq("queue_type", ROW_QUEUE_TYPE).eq("status", "open").eq("payload->>file_date", head.fileDate).in("policy_number", part))
      : Promise.resolve([] as Loose[]),
  ]) : [[], [], []];
  const currentBy = new Map<string, Loose>(current.map((c) => [c.policy_number, c]));
  const matchBy = new Map<string, Loose>(matches.map((m) => [m.policy_number, m]));
  const queueBy = new Set(queue.map((q) => q.policy_number as string));
  const contacts = await chunked(current.map((c) => c.contact_id).filter(Boolean), (part) => db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", part));
  const contactBy = new Map<string, Loose>(contacts.map((c) => [c.id, c]));
  const appByPolicy = new Map<string, string>(current.filter((c) => c.application_id && snaps.length).map((c) => [c.policy_number, c.application_id]));
  const moves = policyFeed ? await cardMoves(tenantId, head, appByPolicy) : new Map<string, CardMove>();

  // A held row's status word, read from the row as sent (a few hundred at most).
  const unproduced = raws.filter((r) => !snapByRow.has(r.id) && !linesBy.has(r.id));
  const heldWord = new Map<string, string>();
  if (head.heldRows > 0 && unproduced.length) {
    const key = await statusKey(head);
    if (key) {
      const payloads = await chunked(unproduced.slice(0, 1000).map((r) => r.id), (part) => db().from("raw_rows").select("id, payload").eq("tenant_id", tenantId).eq("file_id", fileId).in("id", part));
      for (const p of payloads) {
        const word = String(p.payload?.[key] ?? "").trim();
        if (word) heldWord.set(p.id, word);
      }
    }
  }

  const counts = EMPTY_COUNTS();
  let linkedByNumber = 0;
  const linkMethods: Record<string, number> = {};
  const rows: RowView[] = raws.map((r) => {
    const snap = snapByRow.get(r.id);
    const rowLines = linesBy.get(r.id) ?? [];
    const policy: string | null = snap?.policy_number ?? rowLines[0]?.policy ?? null;
    const cur = policy ? currentBy.get(policy) : undefined;
    const match = policy ? matchBy.get(policy) : undefined;
    const review = policy ? reviewBy.get(policy) : undefined;
    const rowChanges = policy && snap ? changesBy.get(policy) ?? [] : [];
    const waits = Boolean(review) || (policy !== null && queueBy.has(policy));
    const outcome = rowOutcome({ policyNumber: snap ? policy : null, commissionLines: rowLines.length, waitsForPerson: waits, isNew: policy !== null && isNew.has(policy), changedFields: rowChanges.length, fileHasHeldRows: head.heldRows > 0 });
    counts[outcome] += 1;
    if (match && (match.method === "policy_number_exact" || match.method === "submission_record")) linkedByNumber += 1;
    if (match && snap) linkMethods[match.method] = (linkMethods[match.method] ?? 0) + 1;
    const word = heldWord.get(r.id) ?? null;
    const shortlist = Array.isArray(review?.shortlist) ? review.shortlist.length : null;
    const what = outcome === "needs_you"
      ? review ? (shortlist ? `${shortlist} ${shortlist === 1 ? "sale could be it" : "sales could be it"}` : "No sale has this number") : "No sale has this policy yet: a new client was made from the row"
      : outcome === "held" ? (word ? `The word “${word}” isn't mapped yet` : "Held until its status word is mapped")
        : outcome === "not_read" ? "Nothing read from this row"
          : outcome === "commission" ? `${rowLines.length} commission ${rowLines.length === 1 ? "line" : "lines"}`
            : outcome === "new" ? `New policy${snap?.status_normalized ? ` · ${String(snap.status_normalized).replaceAll("_", " ")}` : ""}`
              : outcome === "changed" ? rowChanges.map((c) => c.field).join(", ")
                : "No change";
    return {
      rowNumber: r.row_number, rawRowId: r.id, outcome, policyNumber: policy, clientName: personName(cur?.contact_id ? contactBy.get(cur.contact_id) : undefined), contactId: cur?.contact_id ?? null,
      what, linkedBy: match ? linkMethodLabel(match.method) : review ? "Waits for you" : null, linkedAt: match?.created_at ?? null,
      card: policy ? moves.get(policy) ?? null : null, changes: rowChanges, lines: rowLines.map(({ type, amountCents }) => ({ type, amountCents })),
      heldWord: word, reviewId: review?.id ?? null, reviewChoices: shortlist,
    };
  });
  return {
    rows, counts, linkedByNumber, linked: Object.values(linkMethods).reduce((sum, k) => sum + k, 0), linkMethods, cardsMoved: moves.size, changedPolicies: changesBy.size, newPolicies: isNew.size,
    queueItems: queue.map((q) => ({ id: q.id, queueType: q.queue_type, policyNumber: q.policy_number })),
  };
});

// ─── one file: Changes and Not in this file ─────────────────────────────────────────────────────

export type NotInFileRow = { policyNumber: string; clientName: string | null; lastStatus: string | null; lastSeen: string | null };

export async function loadNotInFile(tenantId: string, head: FileHead): Promise<{ comparedWith: FileLink | null; policies: NotInFileRow[] }> {
  if (!head.previous || !isPolicyFeed(head.fileType) || head.status !== "parsed" || !head.carrierId) return { comparedWith: head.previous, policies: [] };
  const [before, now] = await Promise.all([
    all(() => db().from("policy_snapshot").select("policy_number, status_normalized, snapshot_date").eq("tenant_id", tenantId).eq("file_id", head.previous!.id).order("policy_number")),
    all(() => db().from("policy_snapshot").select("policy_number").eq("tenant_id", tenantId).eq("file_id", head.id).order("policy_number")),
  ]);
  if (!now.length) return { comparedWith: head.previous, policies: [] };
  const gone = notInFile(before.map((s) => s.policy_number), now.map((s) => s.policy_number));
  const last = new Map<string, Loose>(before.map((s) => [s.policy_number, s]));
  const current = await chunked(gone, (part) => db().from("policy_current").select("policy_number, contact_id").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).in("policy_number", part));
  const contacts = await chunked(current.map((c) => c.contact_id).filter(Boolean), (part) => db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", part));
  const contactBy = new Map<string, Loose>(contacts.map((c) => [c.id, c]));
  const contactOf = new Map<string, string>(current.filter((c) => c.contact_id).map((c) => [c.policy_number, c.contact_id]));
  return {
    comparedWith: head.previous,
    policies: gone.map((policy) => ({ policyNumber: policy, clientName: personName(contactBy.get(contactOf.get(policy) ?? "")), lastStatus: last.get(policy)?.status_normalized ?? null, lastSeen: last.get(policy)?.snapshot_date ?? null })),
  };
}

// ─── one file: Commissions ──────────────────────────────────────────────────────────────────────

export type CommissionGroup = {
  key: string;
  policyNumber: string | null;
  clientName: string | null;
  account: boolean;
  description: string | null;
  types: string[];
  lines: number;
  paidCents: number;
  expectedCents: number | null;
  result: { label: string; tone: "good" | "warning" | "info" | "neutral" | "danger" };
  /** The open money finding (commission_discrepancy) behind a "Needs you" result. */
  findingId: string | null;
  rowNumber: number;
};

export type FileCommissions = {
  available: boolean;
  linesCents: number;
  postedRows: number;
  waiting: number;
  needsYou: number;
  groups: CommissionGroup[];
};

const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A commission file's lines, by policy, each against what was expected and any open money finding. */
export const loadFileCommissions = cache(async (tenantId: string, fileId: string): Promise<FileCommissions | null> => {
  const head = await loadFileHead(tenantId, fileId);
  if (!head) return null;
  const none: FileCommissions = { available: true, linesCents: 0, postedRows: 0, waiting: 0, needsYou: 0, groups: [] };
  if (head.fileType !== "commissions" || !head.carrierId) return none;
  const [lines, accounts] = await Promise.all([
    all(() => db().from("commission_entry").select("id, policy_number, row_number, entry_type, corrects_type, amount_cents").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number")),
    all(() => db().from("commission_account_entry").select("id, row_number, entry_type, amount_cents, description").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number")),
  ]);
  const policies = [...new Set(lines.map((l) => l.policy_number as string))];
  const [current, expected, findings] = await Promise.all([
    chunked(policies, (part) => db().from("policy_current").select("policy_number, contact_id").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).in("policy_number", part)),
    chunked(policies, (part) => db().from("expected_commission").select("policy_number, policy_year, confidence, expected_amount_cents, expected_advance_cents").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).eq("policy_year", 1).in("policy_number", part)),
    chunked(policies, (part) => db().from("commission_discrepancy").select("id, policy_number, discrepancy_type, difference_cents, status").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).in("status", ["open", "disputed"]).in("policy_number", part)),
  ]);
  const contacts = await chunked(current.map((c) => c.contact_id).filter(Boolean), (part) => db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", part));
  const contactBy = new Map<string, Loose>(contacts.map((c) => [c.id, c]));
  const currentBy = new Map<string, Loose>(current.map((c) => [c.policy_number, c]));
  const expectedBy = new Map<string, Loose>(expected.map((e) => [e.policy_number, e]));
  const findingBy = new Map<string, Loose>(findings.map((d) => [d.policy_number, d]));

  const byPolicy = new Map<string, Loose[]>();
  for (const l of lines) byPolicy.set(l.policy_number, [...(byPolicy.get(l.policy_number) ?? []), l]);
  let waiting = 0;
  let needsYou = 0;
  const groups: CommissionGroup[] = [...byPolicy.entries()].map(([policy, group]) => {
    const paid = group.reduce((sum, l) => sum + Number(l.amount_cents), 0);
    const exp = expectedBy.get(policy);
    const advances = group.some((l) => (l.corrects_type ?? l.entry_type) === "advance");
    const expectedCents = exp && exp.confidence !== "no_rate_card" ? Number((advances ? exp.expected_advance_cents : null) ?? exp.expected_amount_cents ?? 0) : null;
    const finding = findingBy.get(policy);
    const types = [...new Set(group.map((l) => (l.entry_type === "reversal" && l.corrects_type ? `reversal of ${l.corrects_type}` : l.entry_type).replaceAll("_", " ")))];
    let result: CommissionGroup["result"];
    if (!currentBy.has(policy)) { waiting += group.length; result = { label: "Waits for the policy", tone: "neutral" }; }
    else if (finding) {
      needsYou += 1;
      const diff = finding.difference_cents === null ? "" : ` ${money(Math.abs(Number(finding.difference_cents)))}`;
      result = { label: `${String(finding.discrepancy_type).replace("_paid", "").replaceAll("_", " ").replace(/^./, (c: string) => c.toUpperCase())}${diff} → Needs you`, tone: "warning" };
    } else if (exp?.confidence === "no_rate_card") result = { label: "No rate yet", tone: "info" };
    else if (group.length > 1 && types.length === 1) result = { label: "Lines summed", tone: "good" };
    else if (expectedCents !== null && Math.abs(expectedCents - paid) <= 100) result = { label: "Matches", tone: "good" };
    else result = { label: "Posted", tone: "good" };
    return {
      key: policy, policyNumber: policy, clientName: personName(contactBy.get(currentBy.get(policy)?.contact_id ?? "")), account: false, description: null,
      types, lines: group.length, paidCents: paid, expectedCents, result, findingId: finding?.id ?? null, rowNumber: Math.min(...group.map((l) => Number(l.row_number))),
    };
  });
  for (const a of accounts) {
    groups.push({ key: a.id, policyNumber: null, clientName: null, account: true, description: a.description ?? null, types: [String(a.entry_type).replaceAll("_", " ")], lines: 1, paidCents: Number(a.amount_cents), expectedCents: null, result: { label: "Carrier account", tone: "neutral" }, findingId: null, rowNumber: Number(a.row_number) });
  }
  groups.sort((a, b) => a.rowNumber - b.rowNumber);
  const postedRows = new Set([...lines.map((l) => l.row_number), ...accounts.map((a) => a.row_number)]).size;
  return { available: true, linesCents: [...lines, ...accounts].reduce((sum, l) => sum + Number(l.amount_cents), 0), postedRows, waiting, needsYou, groups };
});

// ─── one file: what it left for a person ────────────────────────────────────────────────────────

export type NeedItem = { key: string; kind: string; tone: "warning" | "info" | "danger" | "neutral"; about: string; why: string; href: string | null; waitingOn: "you" | "Insurvas" };

const need = (kind: NeedsYouKind, id: string, about: string, why: string): NeedItem => ({
  key: `${kind}:${id}`, kind: KIND_META[kind].label, tone: KIND_META[kind].tone, about, why, href: itemHref(kind, id), waitingOn: waitsOnInsurvas({ kind }) ? "Insurvas" : "you",
});

/**
 * Everything this file left for a person, each opening its own Needs you item page: the file's open match
 * reviews (pick the client), the "policy with no sale" items it raised (ROW_QUEUE_TYPE), the status words it
 * was held on, and a commission file's money findings. The same items the strip counts.
 */
export async function loadFileNeeds(tenantId: string, head: FileHead, rows: FileRows | null, commissions: FileCommissions | null): Promise<NeedItem[]> {
  const items: NeedItem[] = [];
  for (const row of rows?.rows ?? []) {
    if (row.reviewId) items.push(need("pick-client", row.reviewId, `${row.policyNumber} · row ${row.rowNumber}`, row.what));
  }
  const rowOf = new Map((rows?.rows ?? []).filter((r) => r.policyNumber).map((r) => [r.policyNumber as string, r.rowNumber]));
  for (const item of rows?.queueItems ?? []) {
    const kind = QUEUE_KIND[item.queueType as keyof typeof QUEUE_KIND];
    if (kind) items.push(need(kind, item.id, `${item.policyNumber ?? head.name}${item.policyNumber && rowOf.has(item.policyNumber) ? ` · row ${rowOf.get(item.policyNumber)}` : ""}`, "No sale has this policy yet: a new client was made from the row"));
  }
  // The status words this file was held on that Insurvas hasn't mapped yet.
  if (head.heldRows > 0 && head.carrierId) {
    const { data: finding } = await db().from("agent_findings").select("payload").eq("tenant_id", tenantId).eq("file_id", head.id).eq("finding_type", "unmapped_status").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const held = ((finding?.payload?.held ?? []) as Array<{ raw: string; rows: number }>);
    const words = held.map((h) => h.raw);
    const { data: open } = words.length ? await db().from("unmapped_status_queue").select("id, carrier_status_raw").eq("tenant_id", tenantId).eq("carrier_id", head.carrierId).is("resolved_at", null).in("carrier_status_raw", words) : { data: [] };
    const idOf = new Map<string, string>(((open ?? []) as Loose[]).map((o) => [o.carrier_status_raw, o.id]));
    const rowsOf = (raw: string) => (rows?.rows ?? []).filter((r) => r.heldWord === raw).map((r) => r.rowNumber);
    for (const h of held.filter((x) => idOf.has(x.raw))) {
      const at = rowsOf(h.raw);
      items.push(need("status-word", idOf.get(h.raw)!, `“${h.raw}” · ${at.length ? `${at.length === 1 ? "row" : "rows"} ${at.slice(0, 4).join(", ")}${at.length > 4 ? "…" : ""}` : `${h.rows} ${h.rows === 1 ? "row" : "rows"}`}`, "Waiting on Insurvas to map it"));
    }
  }
  for (const group of commissions?.groups ?? []) {
    if (group.findingId) items.push(need("money", group.findingId, `${group.policyNumber} · row ${group.rowNumber}`, group.result.label.replace(" → Needs you", "")));
  }
  return items;
}

// ─── one row ────────────────────────────────────────────────────────────────────────────────────

export type RowStory = {
  row: RowView | null;
  snapshot: { statusRaw: string | null; status: string | null; premiumCents: number | null; premiumMode: string | null; paidTo: string | null } | null;
};

/**
 * One row's outcome for its page, read for that row and its policy alone (a few small reads), so paging
 * row by row through a 10,000-row file never rebuilds the whole file. The same rules as loadFileRows.
 */
export async function loadRowStory(tenantId: string, fileId: string, rowNumber: number): Promise<RowStory | null> {
  const head = await loadFileHead(tenantId, fileId);
  if (!head) return null;
  const { data: raw } = await db().from("raw_rows").select("id, row_number, payload").eq("tenant_id", tenantId).eq("file_id", fileId).eq("row_number", rowNumber).maybeSingle();
  if (!raw) return { row: null, snapshot: null };
  const policyFeed = isPolicyFeed(head.fileType);
  const [snapQ, linesQ] = await Promise.all([
    policyFeed ? db().from("policy_snapshot").select("policy_number, carrier_status_raw, status_normalized, premium_cents, premium_mode, paid_to_date").eq("tenant_id", tenantId).eq("file_id", fileId).eq("raw_row_id", raw.id).maybeSingle() : { data: null },
    head.fileType === "commissions" ? db().from("commission_entry").select("policy_number, entry_type, corrects_type, amount_cents").eq("tenant_id", tenantId).eq("file_id", fileId).eq("raw_row_id", raw.id) : { data: [] },
  ]);
  const snap = snapQ.data as Loose;
  const lines = (linesQ.data ?? []) as Loose[];
  const policy: string | null = snap?.policy_number ?? lines[0]?.policy_number ?? null;
  const carrierId = head.carrierId;
  const none = { data: null };
  const [event, changes, review, queue, match, current] = policy && carrierId ? await Promise.all([
    snap ? db().from("policy_event").select("id").eq("tenant_id", tenantId).eq("file_id", fileId).eq("event_type", "first_seen").eq("policy_number", policy).limit(1) : { data: [] },
    snap ? db().from("policy_change").select("field_name, old_value, new_value").eq("tenant_id", tenantId).eq("to_file_id", fileId).eq("policy_number", policy) : { data: [] },
    snap ? db().from("policy_match_review").select("id, shortlist").eq("tenant_id", tenantId).eq("file_id", fileId).eq("policy_number", policy).eq("status", "open").maybeSingle() : none,
    snap && head.status === "parsed" && head.fileDate ? db().from("queue_item").select("id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("queue_type", ROW_QUEUE_TYPE).eq("status", "open").eq("payload->>file_date", head.fileDate).eq("policy_number", policy).limit(1) : { data: [] },
    snap ? db().from("policy_match").select("method, created_at").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policy).is("superseded_by_id", null).maybeSingle() : none,
    db().from("policy_current").select("contact_id, application_id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policy).maybeSingle(),
  ]) : [{ data: [] }, { data: [] }, none, { data: [] }, none, none];
  const cur = (current as Loose).data;
  const [contact, moves] = await Promise.all([
    cur?.contact_id ? db().from("contacts").select("first_name, last_name").eq("tenant_id", tenantId).eq("id", cur.contact_id).maybeSingle() : none,
    snap && cur?.application_id && policy ? cardMoves(tenantId, head, new Map([[policy, cur.application_id as string]])) : new Map<string, CardMove>(),
  ]);
  let heldWord: string | null = null;
  if (!snap && !lines.length && head.heldRows > 0) {
    const key = await statusKey(head);
    const word = key ? String(raw.payload?.[key] ?? "").trim() : "";
    heldWord = word || null;
  }
  const rev = (review as Loose).data;
  const m = (match as Loose).data;
  const rowChanges = (((changes as Loose).data ?? []) as Loose[]).map((c) => ({ field: c.field_name, from: c.old_value, to: c.new_value }));
  const isNew = (((event as Loose).data ?? []) as Loose[]).length > 0;
  const waits = Boolean(rev) || (((queue as Loose).data ?? []) as Loose[]).length > 0;
  const outcome = rowOutcome({ policyNumber: snap ? policy : null, commissionLines: lines.length, waitsForPerson: waits, isNew, changedFields: rowChanges.length, fileHasHeldRows: head.heldRows > 0 });
  const shortlist = Array.isArray(rev?.shortlist) ? rev.shortlist.length : null;
  const row: RowView = {
    rowNumber: raw.row_number, rawRowId: raw.id, outcome, policyNumber: policy, clientName: personName((contact as Loose).data ?? undefined), contactId: cur?.contact_id ?? null,
    what: outcome === "needs_you" ? (rev ? (shortlist ? `${shortlist} ${shortlist === 1 ? "sale could be it" : "sales could be it"}` : "No sale has this number") : "No sale has this policy yet: a new client was made from the row") : outcome,
    linkedBy: m ? linkMethodLabel(m.method) : rev ? "Waits for you" : null, linkedAt: m?.created_at ?? null,
    card: policy ? (moves as Map<string, CardMove>).get(policy) ?? null : null, changes: rowChanges,
    lines: lines.map((l) => ({ type: l.entry_type === "reversal" && l.corrects_type ? `reversal of ${l.corrects_type}` : l.entry_type, amountCents: Number(l.amount_cents) })),
    heldWord, reviewId: rev?.id ?? null, reviewChoices: shortlist,
  };
  return {
    row,
    snapshot: snap ? { statusRaw: snap.carrier_status_raw, status: snap.status_normalized, premiumCents: snap.premium_cents === null ? null : Number(snap.premium_cents), premiumMode: snap.premium_mode, paidTo: snap.paid_to_date } : null,
  };
}

// ─── the problem rows, as a CSV ─────────────────────────────────────────────────────────────────

export type ProblemRow = { file: string; carrier: string; fileDate: string; rowNumber: number | null; policyNumber: string; outcome: string; why: string };

const PROBLEM_FILES = 25;

/** The rows that wait on a person or are held, across the agency's current files (or one file). */
export async function problemRows(tenantId: string, files: CarrierFileRow[], outcome?: RowOutcome | null): Promise<ProblemRow[]> {
  const out: ProblemRow[] = [];
  const reviews = await openReviewCounts(tenantId, files.filter((f) => f.status === "parsed").map((f) => f.id));
  const worth = files.filter((f) => f.status !== "superseded" && (f.status === "failed" || f.heldRows > 0 || (reviews.get(f.id) ?? 0) > 0 || Boolean(f.unfinished) || outcome)).slice(0, PROBLEM_FILES);
  for (const file of worth) {
    const base = { file: file.originalFilename, carrier: file.carrierName ?? "Not known", fileDate: file.fileDate ?? "" };
    if (file.status === "failed") {
      out.push({ ...base, rowNumber: null, policyNumber: "", outcome: "File failed", why: file.errorDetail ?? file.rawError ?? "The file couldn't be read" });
      continue;
    }
    const rows = await loadFileRows(tenantId, file.id);
    for (const row of rows?.rows ?? []) {
      if (outcome ? row.outcome !== outcome : row.outcome !== "needs_you" && row.outcome !== "held") continue;
      out.push({ ...base, rowNumber: row.rowNumber, policyNumber: row.policyNumber ?? "", outcome: row.outcome.replace("_", " "), why: row.what });
    }
  }
  return out;
}
