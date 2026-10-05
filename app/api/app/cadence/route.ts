import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import {
  CadenceCampaignError,
  CadenceLimitsPendingError,
  CadenceSchemaPendingError,
  campaignBelongsToTenant,
  getCadence,
  saveCadence,
  saveMaxAttempts,
} from "@/lib/cadence/service";
import { MAX_ATTEMPTS_RANGE, PREFERRED_TIMES, parseInterval, type PreferredTime } from "@/lib/cadence/engine";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-2.7 · the cadence an owner can change.
 *
 * Reading is open to anyone who can dial, because an agent asking "when will this lead come back"
 * is asking about the cadence. Writing is the owner's, because changing it changes how often every
 * contact in the book is called.
 */
const READ_ROLES = ["owner", "producer", "setter", "assistant"] as const;
const WRITE_ROLES = ["owner"] as const;

const rowSchema = z.object({
  attemptNumber: z.number().int().min(1).max(50),
  // The engine's parser is the authority on what a delay is, so the schema defers to it rather
  // than keeping a second regex that could drift. `banana` is refused here, not by Postgres.
  delayInterval: z.string().superRefine((value, ctx) => {
    const parsed = parseInterval(value);
    if (!parsed.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error });
  }),
  // Typed from the engine's vocabulary — the six fixed slots and the board's three day parts — so
  // the schema and the scheduler cannot drift into accepting a preference it has never heard of.
  preferredSlot: z.enum(PREFERRED_TIMES as unknown as [PreferredTime, ...PreferredTime[]]).nullable().optional(),
  dispositionScope: z.string().trim().min(1).max(40).nullable().optional(),
});

const saveSchema = z
  .object({
    campaignId: z.string().uuid().nullable(),
    rows: z.array(rowSchema).max(50),
    // LA-2.7-8 · max attempts for this scope. A number sets it, null clears it back to what the
    // scope inherits (the tenant default, else seven), absent leaves it as it is.
    maxAttempts: z.number().int().min(MAX_ATTEMPTS_RANGE.min).max(MAX_ATTEMPTS_RANGE.max).nullable().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", READ_ROLES);
  if (auth instanceof NextResponse) return auth;

  const campaignId = request.nextUrl.searchParams.get("campaignId");
  if (campaignId && !z.string().uuid().safeParse(campaignId).success)
    return NextResponse.json({ error: "That is not a campaign id", code: "invalid_campaign" }, { status: 400 });

  try {
    const view = await getCadence(auth.context.tenantId, { campaignId: campaignId || null });
    return NextResponse.json(
      { ...view, canEdit: auth.context.role === "owner" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the cadence" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", WRITE_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid cadence" }, { status: 400 });

  // This check is the ONLY thing stopping duplicate rules, which is worth stating because the
  // table looks like it stops them and does not.
  //
  // `unique (tenant_id, campaign_id, attempt_number, disposition_scope)` reads like a guarantee,
  // but Postgres treats NULLs in a unique index as distinct. A tenant-default rule has NULL in
  // both `campaign_id` and `disposition_scope`, so two identical "attempt 1, any outcome" rows
  // satisfy the constraint. Verified against the live table: the second insert was accepted.
  //
  // The consequence is not a loud error, it is a quiet one. `schedule_next_attempt` ends its
  // lookup with `limit 1` and no tiebreak, so two rules for one attempt mean the delay is
  // whichever row the planner returns first — a cadence that is not wrong so much as undecided.
  const seen = new Set<string>();
  for (const row of parsed.data.rows) {
    const key = `${row.attemptNumber}|${row.dispositionScope ?? ""}`;
    if (seen.has(key))
      return NextResponse.json(
        {
          error: row.dispositionScope
            ? `Attempt ${row.attemptNumber} has two rules for “${row.dispositionScope}”. Keep one.`
            : `Attempt ${row.attemptNumber} appears twice. Give one of them a disposition, or remove it.`,
          code: "duplicate_attempt",
        },
        { status: 400 },
      );
    seen.add(key);
  }

  // A cadence that skips an attempt number is not an error the database would catch, but it is
  // almost always a mistake: the reader looks up `attempt_number = v_next` exactly, so a gap means
  // that attempt silently falls through to the built-in table instead of the rule above it.
  //
  // The ladder may start at attempt 2. Attempt 1 is the first dial: `schedule_next_attempt` only
  // ever looks up `attempts_made + 1` after a dial, so no rule for attempt 1 is ever read. Sets
  // that start at 1 are still accepted, because that is what every earlier save stored.
  const numbers = [...new Set(parsed.data.rows.map((row) => row.attemptNumber))].sort((a, b) => a - b);
  const first = numbers[0] === 1 ? 1 : 2;
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + first)
      return NextResponse.json(
        {
          error: `Attempts have to run ${first}, ${first + 1}, ${first + 2} without gaps. Attempt ${index + first} is missing, so it would fall back to the built-in delay.`,
          code: "gap_in_cadence",
        },
        { status: 400 },
      );
  }

  // The campaign must be this tenant's. The service client bypasses RLS, so without this a
  // hand-built request could write rules under another agency's campaign id. The atomic save
  // re-checks it in the same transaction (20260924230300); this is the check that holds before then.
  if (parsed.data.campaignId) {
    const owned = await campaignBelongsToTenant(auth.context.tenantId, parsed.data.campaignId).catch(() => null);
    if (owned === null)
      return NextResponse.json({ error: "Could not check that campaign. Try again." }, { status: 503 });
    if (!owned)
      return NextResponse.json({ error: "That campaign is not yours, or no longer exists.", code: "campaign_not_found" }, { status: 404 });
  }

  try {
    // Max attempts first: before 20260929201100 it cannot be stored, and refusing then leaves the
    // rules untouched rather than saving half of what was asked.
    const maxAttempts =
      parsed.data.maxAttempts === undefined
        ? undefined
        : await saveMaxAttempts({
            tenantId: auth.context.tenantId,
            campaignId: parsed.data.campaignId,
            maxAttempts: parsed.data.maxAttempts,
            userId: auth.context.userId,
          });
    const rows = await saveCadence({
      tenantId: auth.context.tenantId,
      scope: { campaignId: parsed.data.campaignId },
      rows: parsed.data.rows,
      savedBy: auth.context.userId,
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.cadence_updated",
      targetType: "tenant_cadence_rules",
      targetId: parsed.data.campaignId ?? auth.context.tenantId,
      metadata: {
        scope: parsed.data.campaignId ? "campaign" : "tenant_default",
        campaignId: parsed.data.campaignId,
        attempts: rows.length,
        // An empty save is a real decision — it puts the tenant back on the built-in cadence — so
        // the audit trail records it as that rather than as "0 attempts".
        revertedToDefaults: rows.length === 0,
        ...(maxAttempts === undefined ? {} : { maxAttempts: parsed.data.maxAttempts, maxAttemptsInForce: maxAttempts }),
      },
      request,
    });
    return NextResponse.json({ rows, usingDefaults: rows.length === 0, ...(maxAttempts === undefined ? {} : { maxAttempts }) });
  } catch (error) {
    if (error instanceof CadenceCampaignError)
      return NextResponse.json({ error: error.message, code: "campaign_not_found" }, { status: 404 });
    if (error instanceof CadenceSchemaPendingError || error instanceof CadenceLimitsPendingError)
      return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the cadence" },
      { status: 500 },
    );
  }
}
