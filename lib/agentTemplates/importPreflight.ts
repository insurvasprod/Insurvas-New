import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getUsPhone10Digits } from "@/lib/compliance/scrub";
import { linkLeadsToContacts } from "@/lib/contacts/leadLink";
import { linkScreeningAuditsToLeads, screenPartnerPhone } from "@/lib/compliance/screening";
import { assertOutboundLimit } from "@/lib/metering/outbound";
import { parseLeadCsvRows, sanitizeImportMapping, type ImportDateOrder, type LeadImportRow } from "@/lib/agentTemplates/csv";
import {
  EMPTY_BUCKETS,
  type BucketCounts,
  type BucketRows,
  type DncBreakdown,
  type ReviewBucket,
} from "@/lib/agentTemplates/importReviewModel";
import type { AgentTemplate } from "@/lib/agentTemplates/service";
import { getTenantTemplateForProductVersion, validateImportValues } from "@/lib/agentTemplates/service";
import { friendlyImportCommitError } from "@/lib/agentTemplates/errors";
import { commitLeadImport, ImportCommitRefusal, projectedUsableCostCents, type ImportItem, type ScrubRejection } from "@/lib/agentTemplates/importCommit";

type DbError = { message: string; code?: string };
type Result<T> = { data: T; error: DbError | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  limit(count: number): Query<T>;
  insert(value: unknown): Query<T>;
  update(value: unknown): Query<T>;
  maybeSingle(): Promise<Result<T | null>>;
};
type Db = {
  from(table: string): Query<Record<string, unknown>>;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
};

/**
 * Module 2 §6 · the decision step between validating a file and committing it.
 *
 * The pipeline the documentation draws is eight steps, and steps ④⑤⑥ all happen *before* ⑧:
 *
 *     ④ validate    show him what is wrong BEFORE he commits
 *     ⑤ dedupe      against this file, and against everything he already has
 *     ⑥ SCRUB       federal DNC · litigator · state DNC · his own list
 *     ⑧ commit      transactional — all of it or none of it
 *
 * So the scrub runs once, here, and its answers are STAGED. The commit reuses them rather than
 * screening again — which matters for more than speed: the scrub is metered against the plan
 * (LA-2.22), and screening twice would bill Ray twice for one file.
 *
 * Staged in `agent_lead_import_batches`, which already carries the idempotency key for this file.
 * `status = 'processing'` is the honest state for a plan awaiting its decision: the request has
 * started and has not finished.
 *
 * LA-2.2-10 · the scrub is a RESUMABLE JOB. Each number is about ten round trips, and a 20,000-row
 * file screened in one request ran for over six minutes before the dev server reset and nothing was
 * staged. Now the file is validated and its distinct numbers are written to the batch row as a
 * `screening` job; each request screens the next slice within a time budget and writes its answers
 * back (the progress lives in the database, not in a request). The review screen drives and polls
 * it. Only when every number has an answer is the plan built and staged — nothing is staged before.
 * A small file finishes inside the first request, exactly as before.
 */

/** What a row turned out to be. Each one is a different decision for the person importing. */
export type PreflightOutcome =
  | "ready"
  | "duplicate_in_file"
  | "duplicate_existing"
  | "dnc"
  | "litigator"
  | "invalid_phone"
  | "unreadable";

export type PreflightRow = {
  rowNumber: number;
  name: string;
  phone: string | null;
  state: string | null;
  outcome: PreflightOutcome;
  detail: string | null;
};

/** Where a do-not-call hit came from: the tenant's own suppression list, or the registry vendor. */
export type DncSource = "tenant" | "registry";

type ScreenedAnswer = {
  outcome: string;
  resultId: string | null;
  version: number | null;
  checkedAt: string | null;
  warning: string | null;
  dncSource?: DncSource | null;
  /** LA-2.3-9: the screening_audit row, linked to the lead once the commit creates or attaches it. */
  auditId?: string | null;
};

export type PreflightPlan = {
  kind: "preflight";
  csvHash: string;
  /** The idempotency key this plan was staged under — the file AND everything chosen about it. */
  reuseKey?: string;
  fileName?: string | null;
  vendorId: string | null;
  campaignId: string | null;
  mapping: Record<string, string | null> | null;
  /** How slash dates were read at preflight; the commit reads them the same way. */
  dateOrder?: ImportDateOrder | null;
  /**
   * The form definition the file was read against. The commit reads it against the same one, so a
   * form saved between review and commit cannot make every reviewed row unreadable (LA-2.2-9).
   */
  definitionVersion?: number | null;
  /** What the file cost, in integer cents. Null when nobody entered a cost. */
  costCents?: number | null;
  /** Rows bought, for the campaign's `records_purchased`. Defaults to the file's row count. */
  recordsPurchased?: number | null;
  /** Screening answers keyed by ten-digit phone, so the commit never screens the same number twice. */
  screened: Record<string, ScreenedAnswer>;
  counts: Record<PreflightOutcome, number>;
  /** The review table's rows. Plans staged before these existed have only `counts`. */
  buckets?: BucketCounts;
  /** Every row number in each bucket, so "View list" can show them from the file in the tab. */
  rows?: BucketRows;
  /** Why an unreadable or invalid row was left out, keyed by row number. */
  rowDetails?: Record<string, string>;
  dncBreakdown?: DncBreakdown;
  /**
   * New leads with no state (LA-2.4-8). They import, and have no timezone, so the dialer never
   * serves them until a state is added — flagged here, before the commit, not after.
   */
  noState?: number[];
  totalRows: number;
  /** A bounded sample per bucket, for plans staged before `rows` existed. */
  samples: Record<PreflightOutcome, PreflightRow[]>;
};

/** The staged scrub before it has finished: the file's numbers and the answers so far. */
export type ScreeningJob = {
  kind: "screening";
  csvHash: string;
  reuseKey: string;
  fileName: string | null;
  vendorId: string | null;
  campaignId: string;
  mapping: Record<string, string | null> | null;
  dateOrder?: ImportDateOrder | null;
  definitionVersion: number | null;
  costCents: number | null;
  recordsPurchased: number | null;
  totalRows: number;
  /** Every distinct number the file needs screened, in file order. */
  phones: string[];
  screened: Record<string, ScreenedAnswer>;
  /** Bumped by every write, so two tabs driving one job cannot overwrite each other's answers. */
  step: number;
  startedAt: string;
  updatedAt: string;
  /** Numbers the last step could not get an answer for. They stay pending and are asked again. */
  unavailable: number;
  lastUnavailable: string | null;
};

export type ScreeningProgress = {
  batchId: string;
  fileName: string | null;
  totalRows: number;
  screened: number;
  total: number;
  unavailable: number;
  message: string | null;
  startedAt: string;
  updatedAt: string;
};

/** What the person importing decided to do with each bucket. */
export type ImportDecisions = {
  /** Two rows for the same number inside one file. */
  duplicatesInFile: "first" | "skip";
  /** The number already exists as one of Ray's leads. */
  existingLeads: "attach" | "skip";
  /**
   * A federal, state or internal DNC hit.
   *
   * `suppress` imports the record and suppresses the number, so the row survives as evidence for a
   * vendor credit claim and can never be dialled. There is deliberately no option that makes a DNC
   * number dialable: Module 2 §8.1 permits it only "with a documented prior relationship or written
   * consent", and a checkbox on an import screen is neither.
   */
  dnc: "exclude" | "suppress";
};

export const DEFAULT_DECISIONS: ImportDecisions = {
  // The first occurrence is kept, because skipping both loses a lead Ray paid for.
  duplicatesInFile: "first",
  // LA-2.20 decided this: one person, many campaign sources. Skipping would lose the cost
  // attribution for a lead this vendor genuinely sold.
  existingLeads: "attach",
  dnc: "exclude",
};

/** A refusal the screen should show as it is, with the batch it is about. */
export class ImportConflictError extends Error {
  constructor(message: string, readonly batchId: string | null = null) {
    super(message);
  }
}

/** A write that needs a migration the database does not have yet. */
export class ImportNeedsDatabaseUpdateError extends Error {}

export const DATABASE_UPDATE_MESSAGE = "This setting needs a database update that has not been applied yet.";

const EMPTY_COUNTS: Record<PreflightOutcome, number> = {
  ready: 0, duplicate_in_file: 0, duplicate_existing: 0, dnc: 0, litigator: 0, invalid_phone: 0, unreadable: 0,
};

const SAMPLE_LIMIT = 25;
/** Each screening is ~10 sequential round trips; the same bound importAgentLeads uses. */
const SCREENING_CONCURRENCY = 20;
/** Numbers handed to one bounded fan-out; the step loops over these until its budget runs out. */
const SCREENING_SLICE = SCREENING_CONCURRENCY;
/** How long the first request screens before handing the job to the review screen. */
const INLINE_BUDGET_MS = 8_000;
/** How long each later step screens. Well inside the route's maxDuration. */
export const STEP_BUDGET_MS = 20_000;
/** The most numbers one step screens, whatever the budget. */
export const MAX_STEP_NUMBERS = 2_000;
/** Numbers per dedupe call. One call answers all of them; the chunk only bounds the request body. */
const LOOKUP_CHUNK = 5_000;
/** Numbers per fallback IN-query, which travels in a URL. */
const FALLBACK_CHUNK = 150;

export function hashCsv(csv: string) {
  return createHash("sha256").update(csv, "utf8").digest("hex");
}

/**
 * The key a staged plan is reused under.
 *
 * It used to be the file's hash alone, so staging the same file again with a DIFFERENT campaign —
 * the obvious correction after picking the wrong one — silently reused the old plan, and the leads
 * were committed to the campaign the person had just moved away from: the wrong campaign's money.
 * Everything that changes what the commit writes is in the key.
 */
export function preflightKey(input: {
  csvHash: string;
  campaignId: string;
  vendorId: string | null;
  mapping: Record<string, string | null> | null;
  costCents: number | null;
  recordsPurchased: number | null;
  /** In the key only when set, so batches staged before date orders existed still match. */
  dateOrder?: ImportDateOrder | null;
}) {
  const mapping = input.mapping
    ? Object.fromEntries(Object.entries(input.mapping).sort(([left], [right]) => left.localeCompare(right)))
    : null;
  const fingerprint = JSON.stringify([
    input.csvHash, input.campaignId, input.vendorId, mapping, input.costCents, input.recordsPurchased,
    ...(input.dateOrder ? [input.dateOrder] : []),
  ]);
  return `preflight:${createHash("sha256").update(fingerprint, "utf8").digest("hex")}`;
}

function leadName(values: Record<string, unknown>) {
  const first = typeof values.first_name === "string" ? values.first_name : "";
  const last = typeof values.last_name === "string" ? values.last_name : "";
  const full = typeof values.full_name === "string" ? values.full_name : "";
  return (full || [first, last].filter(Boolean).join(" ") || "Unnamed").trim();
}

function phoneOf(values: Record<string, unknown>) {
  try {
    return getUsPhone10Digits(values.phone ?? values.phone_number);
  } catch {
    return null;
  }
}

function isMissingSchema(error: DbError | null | undefined) {
  if (!error) return false;
  return ["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
    || /could not find the (function|column)/i.test(error.message);
}

/** Promise.all with at most `limit` in flight; the first rejection stops new tasks starting. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The template a batch was read against. A form saved after the file was checked must not change
 * what its rows mean: the batch pins the definition version, and every later read of the file —
 * finishing the scrub, committing — uses that version, not the current one.
 */
async function pinnedTemplate(tenantId: string, current: AgentTemplate, definitionVersion: number | null | undefined): Promise<AgentTemplate> {
  if (!definitionVersion || definitionVersion === current.assignment.definition_version) return current;
  try {
    const pinned = await getTenantTemplateForProductVersion(tenantId, current.template.product_code, definitionVersion);
    return { ...pinned, latest: null };
  } catch {
    // The revision is gone (it never is in practice: revisions are append-only). Reading against
    // the current form is the only thing left, and the commit re-validates every row against it.
    return current;
  }
}

/**
 * Which of these numbers already belong to one of the tenant's leads, and to which lead.
 *
 * Both callers used to read EVERY lead the tenant has (`select id, values … eq tenant_id`) and build
 * the set in TypeScript. The service client is a plain supabase-js client with no range paging, so
 * that read was capped by PostgREST's max-rows (1,000 on a hosted project unless raised) and on a
 * tenant with ~214k leads the dedupe quietly checked the first thousand and missed everyone else.
 *
 * `import_existing_lead_phones` (20260924330000) returns one jsonb object for just the numbers in
 * the file, so no row cap applies. Before that migration, an IN-query on the two phone keys stands
 * in; it finds leads whose phone is stored as ten or eleven digits — which is how every import
 * stores it — but not a phone saved with punctuation by another intake path.
 */
async function existingLeadsByPhone(db: Db, tenantId: string, phones: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (phones.length === 0) return found;
  for (let start = 0; start < phones.length; start += LOOKUP_CHUNK) {
    const chunk = phones.slice(start, start + LOOKUP_CHUNK);
    const result = await db.rpc("import_existing_lead_phones", { p_tenant_id: tenantId, p_phones: chunk });
    if (result.error) {
      if (isMissingSchema(result.error)) return existingLeadsByPhoneFallback(db, tenantId, phones);
      throw new Error(`Could not check existing leads: ${result.error.message}`);
    }
    const map = (result.data ?? {}) as Record<string, unknown>;
    for (const [phone, leadId] of Object.entries(map)) if (typeof leadId === "string") found.set(phone, leadId);
  }
  return found;
}

async function existingLeadsByPhoneFallback(db: Db, tenantId: string, phones: string[]): Promise<Map<string, string>> {
  const earliest = new Map<string, { id: string; createdAt: string }>();
  for (let start = 0; start < phones.length; start += FALLBACK_CHUNK) {
    const chunk = phones.slice(start, start + FALLBACK_CHUNK);
    const variants = chunk.flatMap((phone) => [phone, `1${phone}`]);
    for (const column of ["values->>phone", "values->>phone_number"]) {
      const result = await db
        .from("agent_leads")
        .select("id, values, created_at")
        .eq("tenant_id", tenantId)
        .in(column, variants)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (result.error) throw new Error(`Could not check existing leads: ${result.error.message}`);
      for (const lead of (result.data as unknown as Array<{ id: string; values: Record<string, unknown> | null; created_at: string }>) ?? []) {
        const digits = phoneOf(lead.values ?? {});
        if (!digits) continue;
        const seen = earliest.get(digits);
        if (!seen || lead.created_at < seen.createdAt) earliest.set(digits, { id: lead.id, createdAt: lead.created_at });
      }
    }
  }
  return new Map([...earliest].map(([phone, lead]) => [phone, lead.id]));
}

/** The review buckets for any plan, including one staged before the buckets were recorded. */
export function planBuckets(plan: PreflightPlan): { buckets: BucketCounts; rows: BucketRows | null; dncBreakdown: DncBreakdown } {
  if (plan.buckets) {
    return {
      buckets: { ...EMPTY_BUCKETS, ...plan.buckets },
      rows: plan.rows ?? null,
      dncBreakdown: plan.dncBreakdown ?? { new: plan.buckets.dnc_tenant + plan.buckets.dnc_registry, existing: 0, repeat: 0 },
    };
  }
  // An older plan knew only "on a do-not-call list", not which list, so it keeps that one label.
  return {
    buckets: {
      ...EMPTY_BUCKETS,
      ready: plan.counts.ready ?? 0,
      duplicate_existing: plan.counts.duplicate_existing ?? 0,
      duplicate_in_file: plan.counts.duplicate_in_file ?? 0,
      dnc: plan.counts.dnc ?? 0,
      litigator: plan.counts.litigator ?? 0,
      invalid_phone: plan.counts.invalid_phone ?? 0,
      unreadable: plan.counts.unreadable ?? 0,
    },
    rows: null,
    dncBreakdown: { new: plan.counts.dnc ?? 0, existing: 0, repeat: 0 },
  };
}

type BatchRow = { id: string; status: string; response: unknown };

async function readBatchByKey(db: Db, tenantId: string, key: string) {
  const existing = await db
    .from("agent_lead_import_batches")
    .select("id, status, response")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", key)
    .maybeSingle();
  return existing.error ? null : (existing.data as unknown as BatchRow | null);
}

/** A refusal while staging, in words (LA-2.2-9): never the raw PostgREST or Postgres text. */
function stagingError(error: DbError, fallback: string): Error {
  return friendlyImportCommitError(error) ?? new Error(error.message || fallback);
}

const ALREADY_IMPORTED =
  "This file was already imported into this campaign with these settings, so it was not staged again. Choose a different campaign or file to import it again.";

export function screeningProgress(batchId: string, job: ScreeningJob): ScreeningProgress {
  return {
    batchId,
    fileName: job.fileName,
    totalRows: job.totalRows,
    screened: job.phones.filter((phone) => job.screened[phone]).length,
    total: job.phones.length,
    unavailable: job.unavailable,
    message: job.lastUnavailable,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  };
}

export type PreflightStart = { batchId: string; plan: PreflightPlan | null; progress: ScreeningProgress | null };

/**
 * Runs step ④, starts ⑤⑥, and writes nothing to `agent_leads`.
 *
 * Returns the batch id the review screen loads, and — when the scrub finished inside this request —
 * the buckets it renders. A larger file comes back with its screening progress instead, and the
 * review screen carries the job on (`advancePreflightScreening`).
 */
export async function preflightImport(input: {
  tenantId: string;
  userId: string;
  template: AgentTemplate;
  csv: string;
  stages: Array<{ id: string; name: string; pipeline_id?: string; is_archived?: boolean }>;
  vendorId: string | null;
  campaignId: string;
  mapping?: Record<string, string | null>;
  fileName?: string | null;
  costCents?: number | null;
  recordsPurchased?: number | null;
  dateOrder?: ImportDateOrder | null;
}): Promise<PreflightStart> {
  // The inline scrub gets what is left of its budget after reading and staging the file, so a slow
  // database answers with the staged job (202) instead of running past the request limit.
  const requestStarted = Date.now();
  const inlineBudget = () => Math.max(0, INLINE_BUDGET_MS - (Date.now() - requestStarted));
  const db = getSupabaseServiceClient() as unknown as Db;
  const csvHash = hashCsv(input.csv);
  const mapping = input.mapping ? sanitizeImportMapping(input.mapping, input.template.template.fields) : null;
  const costCents = input.costCents ?? null;
  const dateOrder = input.dateOrder ?? null;
  const reuseKey = preflightKey({
    csvHash,
    campaignId: input.campaignId,
    vendorId: input.vendorId,
    mapping,
    costCents,
    recordsPurchased: input.recordsPurchased ?? null,
    dateOrder,
  });

  // Reuse the existing plan for this exact file AND these choices, rather than screening again.
  // Re-uploading the same spreadsheet is the most ordinary thing in the world and must not cost a
  // second scrub. A scrub still running is picked up where it stopped.
  let restageId: string | null = null;
  const existing = await readBatchByKey(db, input.tenantId, reuseKey);
  if (existing) {
    const plan = existing.response as PreflightPlan | ScreeningJob | null;
    // Committed already. The unique key would refuse a second row with a raw 23505; this says what
    // actually happened instead.
    if (existing.status === "completed") throw new ImportConflictError(ALREADY_IMPORTED, String(existing.id));
    if (existing.status === "processing" && plan?.kind === "preflight")
      return { batchId: String(existing.id), plan, progress: null };
    if (existing.status === "processing" && plan?.kind === "screening")
      return continueJob(db, { ...input, batchId: String(existing.id), job: plan, budgetMs: inlineBudget() });
    // A failed attempt, or a claim that never got a plan: re-stage onto the same row.
    restageId = String(existing.id);
  }

  const { rows, errors } = parseLeadCsvRows(
    input.csv,
    input.template.template.fields,
    input.stages,
    mapping ?? undefined,
    dateOrder,
  );
  const totalRows = rows.length + errors.length;

  // Field-level validation on top of parsing: a row can be structurally readable and still fail the
  // template's own rules. Only readable rows are screened.
  const readable = rows.filter((row) => !validateImportValues(input.template.template.fields, row.values));

  // The scrub allowance is preflighted for the rows that will actually be screened, which is the
  // distinct phone count rather than the row count: two rows for one number are one lookup.
  const distinctPhones = [...new Set(readable.map((row) => phoneOf(row.values)).filter((value): value is string => Boolean(value)))];
  // Only when there is something to meter. A file where no row survives parsing uses no allowance,
  // and it must still reach the review screen — that is where each row says why it was refused.
  // Asking the meter for zero is refused as a caller bug, which used to fail such a file with
  // "Outbound limit quantity must be a positive integer" and no way to see what was wrong with it.
  if (readable.length > 0) await assertOutboundLimit(input.tenantId, "monthly_leads_imported", readable.length);
  if (distinctPhones.length > 0) await assertOutboundLimit(input.tenantId, "dnc_scrub_lookups", distinctPhones.length);

  const now = new Date().toISOString();
  const recordsPurchased = input.recordsPurchased ?? (costCents !== null ? totalRows : null);
  const job: ScreeningJob = {
    kind: "screening",
    csvHash,
    reuseKey,
    fileName: input.fileName ?? null,
    vendorId: input.vendorId,
    campaignId: input.campaignId,
    mapping,
    ...(dateOrder ? { dateOrder } : {}),
    definitionVersion: input.template.assignment.definition_version ?? null,
    costCents,
    recordsPurchased,
    totalRows,
    phones: distinctPhones,
    screened: {},
    step: 0,
    startedAt: now,
    updatedAt: now,
    unavailable: 0,
    lastUnavailable: null,
  };

  // The batch's own columns (20260924330000), so the lead lists can report what a file cost without
  // opening its plan. Before that migration they do not exist, and the plan alone carries them.
  const columns = {
    file_name: input.fileName ?? null,
    row_count: totalRows,
    cost_cents: costCents,
    records_purchased: recordsPurchased,
    vendor_id: input.vendorId,
    campaign_id: input.campaignId,
  };
  const base = { status: "processing", response: job, error_message: null };

  let batchId: string;
  if (restageId) {
    let updated = await db.from("agent_lead_import_batches").update({ ...base, ...columns }).eq("tenant_id", input.tenantId).eq("id", restageId);
    if (isMissingSchema(updated.error))
      updated = await db.from("agent_lead_import_batches").update(base).eq("tenant_id", input.tenantId).eq("id", restageId);
    if (updated.error) throw stagingError(updated.error, "Could not stage this import for review");
    batchId = restageId;
  } else {
    const row = {
      tenant_id: input.tenantId,
      idempotency_key: reuseKey,
      created_by: input.userId,
      status: "processing",
      response: job,
    };
    let inserted = await db.from("agent_lead_import_batches").insert({ ...row, ...columns }).select("id").maybeSingle();
    if (isMissingSchema(inserted.error))
      inserted = await db.from("agent_lead_import_batches").insert(row).select("id").maybeSingle();
    if (inserted.error?.code === "23505") {
      // Two tabs staged the same file at once, or it was committed in between. Answer with what is
      // there rather than a unique-violation.
      const winner = await readBatchByKey(db, input.tenantId, reuseKey);
      if (winner?.status === "completed") throw new ImportConflictError(ALREADY_IMPORTED, String(winner.id));
      const winnerPlan = winner?.response as PreflightPlan | ScreeningJob | null;
      if (winner && winnerPlan?.kind === "preflight") return { batchId: String(winner.id), plan: winnerPlan, progress: null };
      if (winner && winnerPlan?.kind === "screening") return { batchId: String(winner.id), plan: null, progress: screeningProgress(String(winner.id), winnerPlan) };
      throw new ImportConflictError("This file is already being checked in another tab. Wait a moment and try again.");
    }
    if (inserted.error || !inserted.data)
      throw inserted.error ? stagingError(inserted.error, "Could not stage this import for review") : new Error("Could not stage this import for review");
    batchId = String(inserted.data.id);
  }

  return continueJob(db, { ...input, batchId, job, budgetMs: inlineBudget() });
}

/** One step of the job, and the plan when that step answered the last number and the file is here. */
async function continueJob(
  db: Db,
  input: {
    tenantId: string;
    userId: string;
    template: AgentTemplate;
    stages: Array<{ id: string; name: string; pipeline_id?: string; is_archived?: boolean }>;
    batchId: string;
    job: ScreeningJob;
    budgetMs: number;
    csv?: string | null;
    limit?: number;
  },
): Promise<PreflightStart> {
  let job = input.job;
  if (job.phones.some((phone) => !job.screened[phone])) {
    const stepped = await screenNextSlice(db, { ...input, job });
    // Another tab wrote this step first. Its answers are in the row; report them, not ours.
    if (stepped === "lost") {
      const current = await readBatchById(db, input.tenantId, input.batchId);
      const response = current?.response as PreflightPlan | ScreeningJob | null;
      if (response?.kind === "preflight") return { batchId: input.batchId, plan: response, progress: null };
      if (response?.kind === "screening") return { batchId: input.batchId, plan: null, progress: screeningProgress(input.batchId, response) };
      throw new ImportConflictError("This list was imported or withdrawn while it was being checked.", input.batchId);
    }
    job = stepped;
  }
  const finished = job.phones.every((phone) => job.screened[phone]);
  if (!finished || !input.csv) return { batchId: input.batchId, plan: null, progress: screeningProgress(input.batchId, job) };

  const template = await pinnedTemplate(input.tenantId, input.template, job.definitionVersion);
  const plan = await buildPlan(db, { tenantId: input.tenantId, template, stages: input.stages, csv: input.csv, job });
  const staged = await db
    .from("agent_lead_import_batches")
    .update({ response: plan })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.batchId)
    .eq("status", "processing")
    .eq("response->>step", String(job.step))
    .select("id");
  if (staged.error) throw stagingError(staged.error, "Could not stage this import for review");
  if (!Array.isArray(staged.data) || staged.data.length === 0) {
    // Staged by another tab a moment earlier — the same answers, so the same plan.
    const current = await readBatchById(db, input.tenantId, input.batchId);
    const response = current?.response as PreflightPlan | null;
    if (response?.kind === "preflight") return { batchId: input.batchId, plan: response, progress: null };
    throw new ImportConflictError("This list was imported or withdrawn while it was being checked.", input.batchId);
  }
  return { batchId: input.batchId, plan, progress: null };
}

async function readBatchById(db: Db, tenantId: string, batchId: string) {
  const row = await db.from("agent_lead_import_batches").select("id, status, response").eq("tenant_id", tenantId).eq("id", batchId).maybeSingle();
  return row.error ? null : (row.data as unknown as BatchRow | null);
}

/**
 * Step ⑥ for the next numbers without an answer, a bounded number at a time, until the budget runs
 * out. Unbounded, a 20,000-number file opened 20,000 screenings at once — about ten round trips
 * each — and swamped the pool.
 *
 * An `unavailable` answer is never stored: the number stays pending and is asked again on the next
 * step. An unknown answer must never become a dialable lead, so a vendor outage leaves the job
 * unfinished — and nothing staged — rather than letting a number through (LA-2.3-7).
 */
async function screenNextSlice(
  db: Db,
  input: { tenantId: string; userId: string; batchId: string; job: ScreeningJob; budgetMs: number; limit?: number },
): Promise<ScreeningJob | "lost"> {
  const job = input.job;
  const limit = Math.max(1, Math.min(MAX_STEP_NUMBERS, input.limit ?? MAX_STEP_NUMBERS));
  const pending = job.phones.filter((phone) => !job.screened[phone]);
  const deadline = Date.now() + input.budgetMs;
  const screened: ScreeningJob["screened"] = { ...job.screened };
  let asked = 0;
  let unavailable = 0;
  let lastUnavailable: string | null = null;
  while (asked < pending.length && asked < limit && Date.now() < deadline) {
    const distinctPhones = pending.slice(asked, asked + Math.min(SCREENING_SLICE, limit - asked));
    asked += distinctPhones.length;
    // A screening that throws (a timed-out read of the tenant's own list, seen live) is an unknown
    // answer for that number, like `unavailable`: it stays pending, and the rest of the slice keeps
    // the answers it got instead of the whole step failing.
    const decisions = await mapWithConcurrency(distinctPhones, SCREENING_CONCURRENCY, (phone) =>
      screenPartnerPhone({ tenantId: input.tenantId, partnerId: null, userId: input.userId, phone })
        .catch(() => ({ outcome: "unavailable" as const, message: "The scrub could not be completed for this number just now.", resultId: null, version: null, checkedAt: null, warning: null })),
    );
    distinctPhones.forEach((phone, index) => {
      const decision = decisions[index];
      if (decision.outcome === "unavailable") {
        unavailable += 1;
        lastUnavailable = decision.message || "A scrub vendor is unavailable.";
        return;
      }
      screened[phone] = {
        outcome: decision.outcome,
        resultId: decision.resultId,
        version: decision.version,
        checkedAt: decision.checkedAt,
        warning: decision.warning?.message ?? null,
        // The tenant's own list is checked first and answers without a stored screening result; a
        // registry answer always has one. That is the only difference the decision exposes.
        dncSource: decision.outcome === "dnc" ? (decision.resultId ? "registry" : "tenant") : null,
        auditId: decision.auditId,
      };
    });
  }
  const next: ScreeningJob = { ...job, screened, step: job.step + 1, updatedAt: new Date().toISOString(), unavailable, lastUnavailable };
  // Written only over the step it read. A second tab that read the same step finds its write
  // refused and reports the row as it is — its lookups hit the 24-hour cache, so nothing is billed
  // twice for the overlap.
  const written = await db
    .from("agent_lead_import_batches")
    .update({ response: next })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.batchId)
    .eq("status", "processing")
    .eq("response->>step", String(job.step))
    .select("id");
  if (written.error) throw stagingError(written.error, "Could not save the screening progress");
  return Array.isArray(written.data) && written.data.length > 0 ? next : "lost";
}

export type ScreeningStep =
  | { state: "staged"; plan: PreflightPlan }
  | { state: "screening"; progress: ScreeningProgress; needsFile: boolean }
  | { state: "committed" }
  | { state: "missing" };

/**
 * The review screen's poll: screen the next slice of a batch's job, and stage its plan once every
 * number has an answer and the file has been sent with the request (the plan needs the rows).
 */
export async function advancePreflightScreening(input: {
  tenantId: string;
  userId: string;
  template: AgentTemplate;
  stages: Array<{ id: string; name: string; pipeline_id?: string; is_archived?: boolean }>;
  batchId: string;
  csv?: string | null;
  limit?: number;
}): Promise<ScreeningStep> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const row = await readBatchById(db, input.tenantId, input.batchId);
  if (!row) return { state: "missing" };
  if (row.status === "completed") return { state: "committed" };
  const response = row.response as PreflightPlan | ScreeningJob | null;
  if (response?.kind === "preflight") return { state: "staged", plan: response };
  if (response?.kind !== "screening" || row.status !== "processing") return { state: "missing" };
  if (input.csv && hashCsv(input.csv) !== response.csvHash)
    throw new Error("The file in this tab is not the file being checked. Upload it again from the import screen.");
  const result = await continueJob(db, { ...input, job: response, budgetMs: STEP_BUDGET_MS });
  if (result.plan) return { state: "staged", plan: result.plan };
  const progress = result.progress!;
  return { state: "screening", progress, needsFile: progress.screened === progress.total && !input.csv };
}

/**
 * Steps ④⑤ and the buckets, once every number has its answer: the plan the review screen renders.
 * Existing leads are looked up now, at the end of the scrub, not when it started.
 */
async function buildPlan(
  db: Db,
  input: {
    tenantId: string;
    template: AgentTemplate;
    stages: Array<{ id: string; name: string; pipeline_id?: string; is_archived?: boolean }>;
    csv: string;
    job: ScreeningJob;
  },
): Promise<PreflightPlan> {
  const { job } = input;
  const { rows, errors } = parseLeadCsvRows(
    input.csv,
    input.template.template.fields,
    input.stages,
    job.mapping ?? undefined,
    job.dateOrder ?? null,
  );
  const totalRows = rows.length + errors.length;

  const counts: Record<PreflightOutcome, number> = { ...EMPTY_COUNTS };
  const samples: Record<PreflightOutcome, PreflightRow[]> = {
    ready: [], duplicate_in_file: [], duplicate_existing: [], dnc: [], litigator: [], invalid_phone: [], unreadable: [],
  };
  const buckets: BucketCounts = { ...EMPTY_BUCKETS };
  const bucketRows: Record<ReviewBucket, number[]> = {
    ready: [], duplicate_existing: [], duplicate_in_file: [], dnc_tenant: [], dnc_registry: [], dnc: [],
    litigator: [], invalid_phone: [], unreadable: [],
  };
  const rowDetails: Record<string, string> = {};
  const dncBreakdown: DncBreakdown = { new: 0, existing: 0, repeat: 0 };
  const noState: number[] = [];
  const record = (row: PreflightRow, bucket: ReviewBucket) => {
    counts[row.outcome] += 1;
    if (samples[row.outcome].length < SAMPLE_LIMIT) samples[row.outcome].push(row);
    buckets[bucket] += 1;
    bucketRows[bucket].push(row.rowNumber);
    if ((bucket === "unreadable" || bucket === "invalid_phone") && row.detail) rowDetails[String(row.rowNumber)] = row.detail;
  };

  // Rows the parser could not map. A phone that is not a US number is its own bucket — the row was
  // read fine, it simply has nothing to dial — and no longer blocks the rest of the file.
  for (const error of errors) {
    const outcome = error.kind === "invalid_phone" ? "invalid_phone" : "unreadable";
    record({ rowNumber: error.rowNumber, name: "—", phone: null, state: null, outcome, detail: error.message }, outcome);
  }

  const readable: LeadImportRow[] = [];
  for (const row of rows) {
    const invalid = validateImportValues(input.template.template.fields, row.values);
    if (invalid) {
      record({
        rowNumber: row.rowNumber, name: leadName(row.values), phone: phoneOf(row.values),
        state: typeof row.values.state === "string" ? row.values.state : null,
        outcome: "unreadable", detail: invalid,
      }, "unreadable");
      continue;
    }
    readable.push(row);
  }

  const distinctPhones = [...new Set(readable.map((row) => phoneOf(row.values)).filter((value): value is string => Boolean(value)))];
  // Step ⑤, the half that needs the database: which of these numbers he already has.
  const existingByPhone = await existingLeadsByPhone(db, input.tenantId, distinctPhones);
  const screened = job.screened;

  // The job staged every number the file had when it started; the pinned template reads the file
  // the same way, so a number without an answer here means the file is not the one screened.
  const unanswered = distinctPhones.find((phone) => !screened[phone]);
  if (unanswered)
    throw new Error("Screening could not be completed, so nothing was staged. Upload the file again to check it from the start.");

  const seenInFile = new Set<string>();
  const seenDnc = new Set<string>();
  for (const row of readable) {
    const phone = phoneOf(row.values);
    const base = {
      rowNumber: row.rowNumber,
      name: leadName(row.values),
      phone,
      state: typeof row.values.state === "string" ? row.values.state : null,
    };
    if (!phone) {
      record({ ...base, outcome: "invalid_phone", detail: "No usable US phone number." }, "invalid_phone");
      continue;
    }
    const answer = screened[phone];
    // Order matters. A litigator hit outranks everything, then DNC, then the duplicate questions —
    // the same precedence `is_phone_suppressed` uses, so a number that is both a duplicate and a
    // litigator is reported as the thing that can never be dialled rather than as a duplicate.
    if (answer?.outcome === "tcpa_litigator") {
      record({ ...base, outcome: "litigator", detail: "Matched a TCPA litigator list. Never dialable." }, "litigator");
      continue;
    }
    if (answer?.outcome === "invalid_phone") {
      record({ ...base, outcome: "invalid_phone", detail: "The number is not real." }, "invalid_phone");
      continue;
    }
    if (answer?.outcome === "dnc") {
      record(
        { ...base, outcome: "dnc", detail: answer.warning ?? "On a do-not-call list." },
        answer.dncSource === "tenant" ? "dnc_tenant" : "dnc_registry",
      );
      // What "import and suppress" would do with this row, so the review can add it up exactly.
      if (existingByPhone.has(phone)) dncBreakdown.existing += 1;
      else if (seenDnc.has(phone)) dncBreakdown.repeat += 1;
      else { seenDnc.add(phone); dncBreakdown.new += 1; }
      continue;
    }
    if (existingByPhone.has(phone)) {
      record({ ...base, outcome: "duplicate_existing", detail: "Already one of your leads (same phone)." }, "duplicate_existing");
      continue;
    }
    if (seenInFile.has(phone)) {
      record({ ...base, outcome: "duplicate_in_file", detail: "This number appears earlier in the file." }, "duplicate_in_file");
      continue;
    }
    seenInFile.add(phone);
    record({ ...base, outcome: "ready", detail: null }, "ready");
    // LA-2.4-8: no state, no timezone, never served. Said here, before the commit.
    if (!base.state) noState.push(row.rowNumber);
  }
  for (const list of Object.values(bucketRows)) list.sort((left, right) => left - right);

  return {
    kind: "preflight",
    csvHash: job.csvHash,
    reuseKey: job.reuseKey,
    fileName: job.fileName,
    vendorId: job.vendorId,
    campaignId: job.campaignId,
    mapping: job.mapping,
    ...(job.dateOrder ? { dateOrder: job.dateOrder } : {}),
    definitionVersion: job.definitionVersion,
    costCents: job.costCents,
    recordsPurchased: job.recordsPurchased,
    screened: Object.fromEntries(distinctPhones.map((phone) => [phone, screened[phone]])),
    counts,
    buckets,
    rows: bucketRows,
    rowDetails,
    dncBreakdown,
    noState,
    totalRows,
    samples,
  };
}

/** Loads a staged plan for the review screen. Tenant-scoped, so a batch id is not a capability. */
export async function loadPreflight(tenantId: string, batchId: string): Promise<PreflightPlan | null> {
  return (await loadImportReview(tenantId, batchId)).plan;
}

/**
 * The review screen's one read: the staged plan when there is one, the scrub's progress while it is
 * still running, and otherwise which of the two reasons below explains its absence.
 *
 * `completed` wins over a plan still sitting in `response`: the batch-aware commit marks the row
 * completed inside the import transaction, a moment before the summary replaces the plan, and in
 * that moment the plan must not be offered for a second commit.
 */
export async function loadImportReview(
  tenantId: string,
  batchId: string,
): Promise<{ state: "staged" | "committed" | "missing" | "screening"; plan: PreflightPlan | null; progress?: ScreeningProgress | null }> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const row = await db
    .from("agent_lead_import_batches")
    .select("id, status, response")
    .eq("tenant_id", tenantId)
    .eq("id", batchId)
    .maybeSingle();
  if (row.error || !row.data) return { state: "missing", plan: null };
  if (row.data.status === "completed") return { state: "committed", plan: null };
  const plan = row.data.response as PreflightPlan | ScreeningJob | null;
  if (plan?.kind === "screening")
    return row.data.status === "processing" ? { state: "screening", plan: null, progress: screeningProgress(batchId, plan) } : { state: "missing", plan: null };
  return plan?.kind === "preflight" ? { state: "staged", plan } : { state: "committed", plan: null };
}

/**
 * Why a batch id did not produce a plan — which is not one question but two.
 *
 * A batch that was never staged, or belongs to another tenant, is genuinely not found. A batch that
 * was *imported* is a finished job, and showing the framework's 404 for it reads as though the
 * import was lost rather than finished.
 */
export async function importBatchState(tenantId: string, batchId: string): Promise<"staged" | "committed" | "missing" | "screening"> {
  return (await loadImportReview(tenantId, batchId)).state;
}

export type CommitSummary = {
  imported: number;
  attachedToExisting: number;
  skippedDuplicates: number;
  suppressed: number;
  excluded: number;
  rejectionsRecorded: number;
  campaignId: string;
  /**
   * Whether the dialer will serve these leads: the campaign was marked scrubbed AND is active.
   * `campaigns_servable` needs both (20260913290000), and a row count cannot say which is missing.
   */
  servable: boolean;
  campaignStatus: string | null;
  /** Cents added to the campaign's total spend by this commit. Zero when the box was unticked. */
  spendAddedCents: number;
  recordsAdded: number;
  /** Consent certificates filed from the file's certificate columns (LA-2.6-1). */
  certificatesFiled: number;
  /** New leads imported with no state: never served until a state is added (LA-2.4-8). */
  noState: number;
  /** Something after the leads could not be written (before 20260925709610 only). */
  warning: string | null;
};

/**
 * Step ⑧ — commits the staged plan, with the decisions the person actually made.
 *
 * The CSV is re-sent and re-parsed rather than stored in the plan. Parsing is deterministic, so
 * re-reading the file is cheap and exact, and it keeps twenty thousand lead records out of a jsonb
 * column. The `csvHash` guard is the reason that is safe: decisions made about one file can never
 * be applied to a different one. The file is read against the form definition the review read it
 * against (the plan's pinned `definitionVersion`), not whatever the form is now.
 *
 * No number is screened again. Every answer comes from the staged plan, so a file screened at
 * preflight is billed against the plan's scrub allowance once (LA-2.22) and the outcome the person
 * was shown is the outcome that is acted on.
 *
 * One transaction (LA-2.2-9): the ledger, the leads, the spend, the calling zones and the
 * certificates land together or not at all — see importCommit.ts.
 */
export async function commitImport(input: {
  tenantId: string;
  userId: string;
  template: AgentTemplate;
  csv: string;
  stages: Array<{ id: string; name: string; pipeline_id?: string; is_archived?: boolean }>;
  batchId: string;
  decisions: ImportDecisions;
  /** "Add to {campaign}'s spend", ticked by default on the review screen. */
  addToCampaignSpend: boolean;
}): Promise<CommitSummary> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const review = await loadImportReview(input.tenantId, input.batchId);
  if (review.state === "committed")
    throw new ImportConflictError("This list has already been imported. Nothing was imported again.", input.batchId);
  if (review.state === "screening")
    throw new ImportConflictError("This list is still being screened. Wait for the check to finish, then import it.", input.batchId);
  const plan = review.plan;
  if (!plan) throw new Error("This import has no staged review. Upload the file again.");
  if (plan.csvHash !== hashCsv(input.csv))
    throw new Error(
      "The file has changed since it was reviewed. Upload it again so the decisions match what is in it.",
    );
  // Every import carries a campaign now. A plan staged before that rule has none, and committing it
  // would create leads no cost report can see.
  const campaignId = plan.campaignId;
  if (!campaignId) throw new Error("Choose a campaign for this list. Upload the file again and pick one.");

  const template = await pinnedTemplate(input.tenantId, input.template, plan.definitionVersion);
  const { rows } = parseLeadCsvRows(
    input.csv,
    template.template.fields,
    input.stages,
    plan.mapping ? sanitizeImportMapping(plan.mapping, template.template.fields) : undefined,
    // Read exactly as the preflight read them, or the rows committed are not the rows reviewed.
    plan.dateOrder ?? null,
  );
  const stageById = new Map(
    input.stages.filter((stage) => !stage.is_archived).map((stage) => [stage.id, stage]),
  );

  // Existing leads are re-read at commit, not taken from the plan. The plan may be minutes old and
  // a lead created in between is still a duplicate — committing it as new would produce exactly the
  // double record the dedupe step exists to prevent.
  const filePhones = [...new Set(rows.map((row) => phoneOf(row.values)).filter((value): value is string => Boolean(value)))];
  const existingByPhone = await existingLeadsByPhone(db, input.tenantId, filePhones);

  const summary: CommitSummary = {
    imported: 0, attachedToExisting: 0, skippedDuplicates: 0, suppressed: 0, excluded: 0, rejectionsRecorded: 0,
    campaignId, servable: false, campaignStatus: null, spendAddedCents: 0, recordsAdded: 0,
    certificatesFiled: 0, noState: 0, warning: null,
  };
  const items: ImportItem[] = [];
  const rejections: ScrubRejection[] = [];
  const suppressions: Array<{ phone: string; reason: string }> = [];
  const seenInFile = new Set<string>();
  /** How many times each number has appeared so far in this file, for the ledger's occurrence. */
  const appearances = new Map<string, number>();

  for (const row of rows) {
    const invalid = validateImportValues(template.template.fields, row.values);
    // Already shown as unreadable on the review screen, so excluding it is the decision the person
    // has already seen and accepted.
    if (invalid) { summary.excluded += 1; continue; }

    const phone = phoneOf(row.values);
    if (!phone) { summary.excluded += 1; continue; }
    const answer = plan.screened[phone];

    if (answer?.outcome === "tcpa_litigator") {
      // Never importable, never a decision. Recorded as claimable evidence, because Ray paid for it.
      summary.excluded += 1;
      rejections.push({ phone_digits: phone, outcome: "tcpa_litigator", detail: "Matched a TCPA litigator list", source_key: `csv:${row.rowNumber}` });
      continue;
    }
    if (answer?.outcome === "invalid_phone") {
      summary.excluded += 1;
      rejections.push({ phone_digits: phone, outcome: "invalid", detail: "Not a real number", source_key: `csv:${row.rowNumber}` });
      continue;
    }
    if (answer?.outcome === "dnc") {
      rejections.push({ phone_digits: phone, outcome: "dnc", detail: answer.warning ?? "On a do-not-call list", source_key: `csv:${row.rowNumber}` });
      if (input.decisions.dnc === "exclude") { summary.excluded += 1; continue; }
      // `suppress` keeps the record and makes the number permanently undialable. The suppression is
      // written after the commit, so a failed commit cannot leave a suppression for a lead that was
      // never imported.
      suppressions.push({ phone, reason: "On a do-not-call list when imported" });
      summary.suppressed += 1;
    }

    const existingId = existingByPhone.get(phone);
    if (existingId) {
      if (input.decisions.existingLeads === "skip") { summary.skippedDuplicates += 1; continue; }
      // One lead, many campaign sources — LA-2.20's answer to "same person, new campaign". The
      // import function adds the source but does not put a lead with queue history back in the
      // dialer (20260924330100). This vendor's certificate for the person is filed as well.
      items.push({ lead_id: existingId, campaign_id: campaignId, source_key: `csv:${row.rowNumber}`, consent: row.consent ?? null });
      summary.attachedToExisting += 1;
      continue;
    }
    if (seenInFile.has(phone)) {
      summary.skippedDuplicates += 1;
      // User decision (Pool audit, 2026-09-25): a number repeated inside one file is a row the
      // vendor billed twice — not usable, and claimable. The second appearance is occurrence 2, the
      // third 3, so a number sold three times is two ledger rows (20260925703100). A duplicate of a
      // lead the agency already had is attached above and is neither.
      const occurrence = (appearances.get(phone) ?? 1) + 1;
      appearances.set(phone, occurrence);
      rejections.push({ phone_digits: phone, outcome: "duplicate_in_file", detail: "Repeated inside this file", source_key: `csv:${row.rowNumber}`, occurrence });
      continue;
    }
    seenInFile.add(phone);

    const stage = stageById.get(row.stageId);
    if (!stage?.pipeline_id) { summary.excluded += 1; continue; }
    items.push({
      tenant_id: input.tenantId,
      tenant_template_id: template.tenant_template_id,
      template_id: template.assignment.template_id,
      template_version: template.assignment.template_version,
      definition_version: template.assignment.definition_version,
      product_line: template.template.product_code,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      values: row.values,
      campaign_id: campaignId,
      screening_result_id: answer?.resultId ?? null,
      screening_version: answer?.version ?? null,
      screening_outcome: answer?.outcome ?? null,
      screening_warning: answer?.warning ?? null,
      screening_checked_at: answer?.checkedAt ?? null,
      created_by: input.userId,
      source_key: `csv:${row.rowNumber}`,
      dial_timezone: row.dialTimezone ?? null,
      consent: row.consent ?? null,
    });
    summary.imported += 1;
    if (!row.values.state) summary.noState += 1;
  }

  // What each lead source costs. When the file's own cost was entered it is spread over the rows
  // this commit attributes to the campaign — the most exact figure there is. Otherwise, as before,
  // the campaign's cost per USABLE record with this file's own scrub losses already in the divisor:
  // they are written in the same transaction as the leads now, so they are counted here rather than
  // read back after landing (projectedUsableCostCents).
  let costCents = 0;
  if (items.length > 0) {
    if (plan.costCents !== null && plan.costCents !== undefined) {
      costCents = Math.round(plan.costCents / items.length);
    } else {
      const campaign = await db
        .from("tenant_campaign_costs")
        .select("campaign_id, total_spend_cents, credits_received_cents, records_purchased, records_rejected, cost_per_record_cents, cost_per_usable_record_cents")
        .eq("tenant_id", input.tenantId)
        .eq("campaign_id", campaignId)
        .maybeSingle();
      // "Choose a valid campaign" is only true of the second case. When the READ itself fails —
      // `tenant_campaign_costs` not deployed, a permission problem — the campaign is fine and that
      // message sends the person hunting for a campaign fault that does not exist.
      if (campaign.error)
        throw new Error(
          `Could not read the cost for this campaign, so nothing was imported: ${campaign.error.message}`,
        );
      if (!campaign.data) throw new Error("Choose a valid campaign");
      costCents = projectedUsableCostCents(campaign.data as Parameters<typeof projectedUsableCostCents>[0], rejections.length);
    }
  }

  // The file's cost goes onto the campaign INSIDE the import transaction, so the campaign's spend
  // and the leads it paid for land together or not at all.
  const spend = items.length > 0 && input.addToCampaignSpend && plan.costCents !== null && plan.costCents !== undefined
    ? { campaign_id: campaignId, cost_cents: plan.costCents, records_purchased: plan.recordsPurchased ?? plan.totalRows }
    : null;
  const pItems = items.map((item) => ({ ...item, cost_cents: costCents }));

  let committed: Awaited<ReturnType<typeof commitLeadImport>>;
  try {
    committed = await commitLeadImport({
      tenantId: input.tenantId,
      userId: input.userId,
      items: pItems,
      batchId: input.batchId,
      spend,
      campaignId,
      rejections,
      // Before 703100 the ledger refuses a repeat; everything else is still recorded.
      rejectionsWithoutRepeats: rejections.filter((rejection) => rejection.outcome !== "duplicate_in_file"),
    });
  } catch (error) {
    if (error instanceof ImportCommitRefusal) {
      if (error.reason === "already_committed") throw new ImportConflictError(error.message, input.batchId);
      // Before 20260924330100. Adding the spend cannot be done in the same transaction without it,
      // and doing it afterwards is exactly the partial write the transaction exists to prevent.
      if (error.reason === "spend_needs_migration")
        throw new ImportNeedsDatabaseUpdateError(
          `${DATABASE_UPDATE_MESSAGE} Untick "Add to the campaign's spend" to import these leads without it.`,
        );
      throw new Error(error.message);
    }
    throw error;
  }
  summary.rejectionsRecorded = committed.rejectionsRecorded;
  summary.certificatesFiled = committed.artefactsFiled;
  summary.warning = committed.warning;
  if (spend) {
    summary.spendAddedCents = spend.cost_cents;
    summary.recordsAdded = spend.records_purchased;
  }

  if (items.length > 0) {
    // Link each new lead to the contact it confidently is (the contact auto-merge test). Best
    // effort: never throws, never creates a contact, and does nothing before 20260924326100. The
    // batch returns one lead id per item, in order.
    await linkLeadsToContacts(input.tenantId, committed.ids.flatMap((id, at) => (items[at]?.values ? [{ id, values: items[at].values as Record<string, unknown> }] : [])));

    // LA-2.3-9: each number's preflight check is linked to the lead it became (or was attached to).
    // Best effort: never throws, so a committed import is never reported as failed over it.
    const phoneOfExisting = new Map([...existingByPhone].map(([phone, id]) => [id, phone]));
    await linkScreeningAuditsToLeads(input.tenantId, committed.ids.map((id, at) => {
      const item = items[at];
      const phone = item?.values ? phoneOf(item.values as Record<string, unknown>) : phoneOfExisting.get(String(item?.lead_id ?? "")) ?? null;
      return { auditId: phone ? plan.screened[phone]?.auditId : null, leadId: id };
    }));

    // Mark the campaign scrubbed, because this import just scrubbed it — the same mark
    // importAgentLeads makes. `campaigns_servable` needs `scrub_status = 'scrubbed'` AND `status =
    // 'active'`, and without the mark every lead committed from this screen was attributed and
    // never served. Every committed row was screened at preflight — the answers in plan.screened —
    // and the hits are in the ledger above, so the claim is true.
    //
    // AFTER the commit, deliberately: a crash between the two leaves leads imported and not served —
    // visible, and recoverable by re-running — rather than a campaign advertising a scrub that
    // never finished. A failure here does not throw: the leads are committed, and calling the import
    // failed would be a lie. It is returned as `servable: false` instead.
    const marked = await db
      .from("tenant_campaigns")
      .update({ scrub_status: "scrubbed", scrubbed_at: new Date().toISOString(), scrub_error: null })
      .eq("tenant_id", input.tenantId)
      .eq("id", campaignId)
      .select("id, status");
    if (marked.error) {
      console.error(
        `[import] leads committed but campaign ${campaignId} could not be marked scrubbed; they will not be served until it is: ${marked.error.message}`,
      );
    } else {
      const campaignRow = (Array.isArray(marked.data) ? marked.data[0] : marked.data) as { status?: string } | undefined;
      summary.campaignStatus = campaignRow?.status ?? null;
      summary.servable = summary.campaignStatus === "active";
    }
  }

  for (const suppression of suppressions) {
    const applied = await db.rpc("suppress_phone", {
      p_tenant_id: input.tenantId, p_phone: suppression.phone, p_list_type: "internal",
      p_reason: suppression.reason, p_source: "import", p_added_by: input.userId,
    });
    // Reported, not swallowed: a lead imported as suppressed whose suppression did not land is a
    // dialable DNC number, which is the one outcome this whole path exists to prevent.
    if (applied.error)
      throw new Error(
        `Leads were imported but a do-not-call suppression could not be written for ${suppression.phone}. Suppress it by hand before dialing this campaign: ${applied.error.message}`,
      );
  }

  await db
    .from("agent_lead_import_batches")
    .update({ status: "completed", response: { kind: "result", ...summary }, completed_at: new Date().toISOString() })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.batchId);

  return summary;
}
