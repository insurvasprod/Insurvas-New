import "server-only";

import { audit } from "@/lib/audit/log";
import { screenPartnerPhone, type ScreeningDecision } from "@/lib/compliance/screening";
import { assertOutboundLimit, outboundLimitResponse } from "@/lib/metering/outbound";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { SCRUB_BATCH_SIZE, ledgerOutcome, scrubOutcomeAction, type ScrubRun } from "./constants";

/**
 * "Run the scrub" — re-screen every lead in a campaign, one batch per request.
 *
 * The page drives it: `startScrubRun` opens (or resumes) the run and takes the campaign out of
 * serving, then the page calls `stepScrubRun` until the run is no longer running. Progress lives in
 * tenant_campaign_scrub_runs (20260925706100), so a closed tab loses nothing: the run resumes from
 * its cursor, and after 15 minutes without progress any owner may pick it up.
 *
 * Each lead goes through `screenPartnerPhone`, the path the import uses, so the same vendors, the
 * same cache and the same meters apply. What differs from the import is that the lead already
 * exists: a litigator or DNC hit cannot simply be left out, so the number is written to the
 * suppression list (which serve_next_lead and the dial both read) as well as to the rejection
 * ledger. A vendor outage ends the run `failed` — an unknown number is never treated as clear.
 */

const SCREEN_CONCURRENCY = 5;

type QueryError = { message: string; code?: string } | null;
type Result<T> = { data: T | null; error: QueryError };
type Query = PromiseLike<Result<unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  update(values: unknown): Query;
  maybeSingle(): PromiseLike<Result<unknown>>;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>>;
};
const db = () => getSupabaseServiceClient() as unknown as Db;

const RUN_COLUMNS =
  "id, campaign_id, status, total_leads, processed_leads, rejected_leads, suppressed_numbers, cursor_lead_id, lease_token, started_at, last_progress_at, finished_at, error";

type RunRow = ScrubRun & { cursor_lead_id: string | null; lease_token: string | null };

/** 20260925706100 is not applied. Routes answer 503 with the standard sentence. */
export class ScrubSchemaPendingError extends Error {
  constructor() {
    super("This setting needs a database update that has not been applied yet.");
    this.name = "ScrubSchemaPendingError";
  }
}

/** Another window is driving this run and it moved in the last 15 minutes. */
export class ScrubInProgressError extends Error {
  constructor() {
    super("This scrub is already running in another window. It can be resumed here if it makes no progress for 15 minutes.");
    this.name = "ScrubInProgressError";
  }
}

/** This window no longer holds the run (another took it over, or it ended). */
export class ScrubLeaseLostError extends Error {
  constructor() {
    super("Another window has taken over this scrub, or it has already ended. Reload to see where it is.");
    this.name = "ScrubLeaseLostError";
  }
}

export class ScrubCampaignNotFoundError extends Error {
  constructor() {
    super("That campaign is not yours, or no longer exists.");
    this.name = "ScrubCampaignNotFoundError";
  }
}

function isMissingFunction(error: QueryError) {
  return Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)));
}

function translate(error: QueryError): Error {
  const message = error?.message ?? "";
  if (isMissingFunction(error) || isSchemaGap(error)) return new ScrubSchemaPendingError();
  if (/SCRUB_RUN_IN_PROGRESS/.test(message)) return new ScrubInProgressError();
  if (/SCRUB_RUN_LEASE_LOST|SCRUB_RUN_CURSOR_MOVED|SCRUB_RUN_NOT_FOUND/.test(message)) return new ScrubLeaseLostError();
  if (/SCRUB_RUN_CAMPAIGN_NOT_FOUND/.test(message)) return new ScrubCampaignNotFoundError();
  return new Error(`The scrub could not be updated: ${message}`);
}

/** The public shape: never the lease token or the cursor. */
function publicRun(row: RunRow): ScrubRun {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    status: row.status,
    total_leads: Number(row.total_leads ?? 0),
    processed_leads: Number(row.processed_leads ?? 0),
    rejected_leads: Number(row.rejected_leads ?? 0),
    suppressed_numbers: Number(row.suppressed_numbers ?? 0),
    started_at: row.started_at,
    last_progress_at: row.last_progress_at,
    finished_at: row.finished_at,
    error: row.error,
  };
}

function one(data: unknown): RunRow {
  const row = (Array.isArray(data) ? data[0] : data) as RunRow | undefined;
  if (!row?.id) throw new Error("The scrub run came back empty");
  return row;
}

/**
 * The latest run per campaign, for the campaigns list. Null when 20260925706100 is not applied —
 * the screen then offers no scrub action, rather than one that answers 503.
 */
export async function latestScrubRuns(tenantId: string): Promise<Map<string, ScrubRun> | null> {
  const result = (await db()
    .from("tenant_campaign_scrub_runs")
    .select(RUN_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(500)) as Result<RunRow[]>;
  if (result.error) {
    if (isSchemaGap(result.error)) return null;
    throw new Error(`Could not load scrub runs: ${result.error.message}`);
  }
  const latest = new Map<string, ScrubRun>();
  for (const row of result.data ?? []) if (!latest.has(row.campaign_id)) latest.set(row.campaign_id, publicRun(row));
  return latest;
}

export async function startScrubRun(input: {
  tenantId: string;
  campaignId: string;
  userId: string;
  token: string;
  request: Request;
}): Promise<ScrubRun> {
  const started = await db().rpc("campaign_scrub_run_start", {
    p_tenant_id: input.tenantId,
    p_campaign_id: input.campaignId,
    p_user_id: input.userId,
    p_token: input.token,
  });
  if (started.error) throw translate(started.error);
  const run = one(started.data);
  await audit({
    actorType: "tenant",
    actorId: input.userId,
    action: "tenant.campaign_scrub_started",
    targetType: "tenant_campaigns",
    targetId: input.campaignId,
    metadata: {
      runId: run.id,
      totalLeads: run.total_leads,
      resumedFrom: run.processed_leads > 0 ? run.processed_leads : null,
    },
    request: input.request,
  });
  return publicRun(run);
}

async function readRun(tenantId: string, runId: string): Promise<RunRow> {
  const result = (await db().from("tenant_campaign_scrub_runs").select(RUN_COLUMNS).eq("tenant_id", tenantId).eq("id", runId).maybeSingle()) as Result<RunRow>;
  if (result.error) throw isSchemaGap(result.error) ? new ScrubSchemaPendingError() : new Error(`Could not load the scrub run: ${result.error.message}`);
  if (!result.data) throw new ScrubLeaseLostError();
  return result.data;
}

async function advance(tenantId: string, run: RunRow, token: string, next: { cursor: string | null; processed: number; rejected: number; suppressed: number }) {
  const moved = await db().rpc("campaign_scrub_run_advance", {
    p_tenant_id: tenantId,
    p_run_id: run.id,
    p_token: token,
    p_expected_cursor: run.cursor_lead_id,
    p_new_cursor: next.cursor,
    p_processed: next.processed,
    p_rejected: next.rejected,
    p_suppressed: next.suppressed,
  });
  if (moved.error) throw translate(moved.error);
  return one(moved.data);
}

async function finish(input: { tenantId: string; run: RunRow; token: string; userId: string; outcome: "scrubbed" | "failed"; error?: string; request: Request }) {
  const ended = await db().rpc("campaign_scrub_run_finish", {
    p_tenant_id: input.tenantId,
    p_run_id: input.run.id,
    p_token: input.token,
    p_outcome: input.outcome,
    p_error: input.error ?? null,
  });
  if (ended.error) throw translate(ended.error);
  const run = one(ended.data);
  await audit({
    actorType: "tenant",
    actorId: input.userId,
    action: "tenant.campaign_scrub_finished",
    targetType: "tenant_campaigns",
    targetId: run.campaign_id,
    metadata: {
      runId: run.id,
      outcome: input.outcome,
      processedLeads: run.processed_leads,
      rejectedLeads: run.rejected_leads,
      suppressedNumbers: run.suppressed_numbers,
      error: run.error,
    },
    request: input.request,
  });
  return run;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Lead = { id: string; values: Record<string, unknown> | null };
const phoneOf = (lead: Lead) => lead.values?.phone ?? lead.values?.phone_number ?? null;

/**
 * Screen the next batch. Returns the run as it stands afterwards; the page keeps calling while
 * `status` is still `running`.
 *
 * Every write here is idempotent (the ledger ignores a number it already holds, a suppression is an
 * upsert, the lead's screening columns are overwritten), and the cursor moves only after them — so
 * a request that dies halfway is simply repeated by the next one, and nothing is counted twice.
 */
export async function stepScrubRun(input: {
  tenantId: string;
  campaignId: string;
  runId: string;
  userId: string;
  token: string;
  request: Request;
}): Promise<{ run: ScrubRun; limit?: ReturnType<typeof outboundLimitResponse> }> {
  let run = await readRun(input.tenantId, input.runId);
  if (run.campaign_id !== input.campaignId) throw new ScrubLeaseLostError();
  if (run.status !== "running") return { run: publicRun(run) };
  if (run.lease_token !== input.token) throw new ScrubLeaseLostError();

  // Heartbeat first: proves the lease before a single lookup is billed.
  run = await advance(input.tenantId, run, input.token, { cursor: run.cursor_lead_id, processed: 0, rejected: 0, suppressed: 0 });

  const fail = async (message: string) => ({
    run: publicRun(await finish({ ...input, run, outcome: "failed", error: message })),
  });

  try {
    let query = db()
      .from("agent_leads")
      .select("id, values")
      .eq("tenant_id", input.tenantId)
      .eq("campaign_id", run.campaign_id);
    if (run.cursor_lead_id) query = query.gt("id", run.cursor_lead_id);
    const batch = (await query.order("id", { ascending: true }).limit(SCRUB_BATCH_SIZE)) as Result<Lead[]>;
    if (batch.error) throw new Error(`Could not read the campaign's leads: ${batch.error.message}`);
    const leads = batch.data ?? [];

    if (leads.length === 0)
      return { run: publicRun(await finish({ ...input, run, outcome: "scrubbed" })) };

    try {
      await assertOutboundLimit(input.tenantId, "dnc_scrub_lookups", leads.length);
    } catch (error) {
      const limit = outboundLimitResponse(error);
      if (!limit) throw error;
      const ended = await fail(`${limit.error} The scrub stopped after ${run.processed_leads.toLocaleString("en-US")} leads.`);
      return { ...ended, limit };
    }

    const decisions: ScreeningDecision[] = await mapLimited(leads, SCREEN_CONCURRENCY, (lead) =>
      screenPartnerPhone({ tenantId: input.tenantId, partnerId: null, userId: input.userId, phone: phoneOf(lead) }),
    );

    // Everything before the first outage is settled; the outage and anything after it are screened
    // again on resume (a cached answer, so no second charge for the ones that did come back).
    const outageAt = decisions.findIndex((decision) => scrubOutcomeAction(decision.outcome) === "outage");
    const settled = outageAt === -1 ? leads.length : outageAt;

    const rejections: Array<{ phone_digits: string; outcome: string; detail: string; source_key: string }> = [];
    let rejected = 0;
    let suppressed = 0;
    for (let index = 0; index < settled; index++) {
      const decision = decisions[index];
      const action = scrubOutcomeAction(decision.outcome);
      if (action === "clear") continue;
      rejected += 1;
      if (decision.phoneDigits)
        rejections.push({
          phone_digits: decision.phoneDigits,
          outcome: ledgerOutcome(decision.outcome),
          detail: decision.message || decision.outcome,
          source_key: `scrub:${run.id}`,
        });
    }

    // The evidence first, as the import does: an overstated cost per usable lead is the safe error.
    if (rejections.length > 0) {
      const recorded = await db().rpc("record_campaign_scrub_rejections", {
        p_tenant_id: input.tenantId,
        p_campaign_id: run.campaign_id,
        p_created_by: input.userId,
        p_rejections: rejections,
      });
      if (recorded.error) throw new Error(`Could not record the scrub rejections: ${recorded.error.message}`);
    }

    // Then the suppression. Fail closed: a hit whose suppression did not land is a dialable
    // litigator, which is the outcome this whole run exists to prevent.
    for (let index = 0; index < settled; index++) {
      const decision = decisions[index];
      if (scrubOutcomeAction(decision.outcome) !== "suppress" || !decision.phoneDigits) continue;
      const applied = await db().rpc("suppress_phone", {
        p_tenant_id: input.tenantId,
        p_phone: decision.phoneDigits,
        p_list_type: decision.outcome === "tcpa_litigator" ? "tcpa_litigator" : "federal_dnc",
        p_reason: "Campaign re-scrub",
        p_source: "vendor",
        p_added_by: input.userId,
      });
      if (applied.error) throw new Error(`Could not write the suppression for a number that failed the scrub: ${applied.error.message}`);
      suppressed += 1;
    }

    // The lead carries its latest screening, the same columns the import stamps.
    await mapLimited(leads.slice(0, settled).map((lead, index) => ({ lead, decision: decisions[index] })), SCREEN_CONCURRENCY, async ({ lead, decision }) => {
      const updated = await db()
        .from("agent_leads")
        .update({
          screening_result_id: decision.resultId,
          screening_version: decision.version,
          screening_outcome: decision.outcome,
          screening_warning: decision.warning?.message ?? null,
          screening_checked_at: decision.checkedAt,
        })
        .eq("tenant_id", input.tenantId)
        .eq("id", lead.id);
      if (updated.error) throw new Error(`Could not record the screening on a lead: ${updated.error.message}`);
      return null;
    });

    if (settled > 0)
      run = await advance(input.tenantId, run, input.token, { cursor: leads[settled - 1].id, processed: settled, rejected, suppressed });

    if (outageAt !== -1)
      return fail(`${decisions[outageAt].message} A scrub vendor is unavailable, so the scrub stopped after ${run.processed_leads.toLocaleString("en-US")} leads. Resume it when the vendor is back.`);

    // A short batch was the last one.
    if (leads.length < SCRUB_BATCH_SIZE)
      return { run: publicRun(await finish({ ...input, run, outcome: "scrubbed" })) };

    return { run: publicRun(run) };
  } catch (error) {
    if (error instanceof ScrubLeaseLostError || error instanceof ScrubSchemaPendingError) throw error;
    return fail(error instanceof Error ? error.message : "The scrub could not be completed.");
  }
}
