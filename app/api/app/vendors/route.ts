import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap, type SchemaGapNotice } from "@/lib/supabase/schemaGap";
import { audit } from "@/lib/audit/log";

/**
 * LA-2.1 · Lead vendors, and the rollup that answers "is this vendor any good".
 *
 * The task's own reading of the existing code was that "every report row is a campaign, so 'is this
 * vendor any good' is a question Ray answers by squinting". `tenant_vendor_rollup` has existed
 * since the LA-2.1 migration and nothing has ever read it — this route is the reader.
 *
 * Owner and producer only, like the campaign routes. This returns spend and cost per lead, which is
 * money: an assistant or a setter must not see what a lead cost.
 */
const roles = ["owner", "producer"] as const;

type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & {
  select(columns: string, options?: unknown): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: unknown): Query;
  insert(value: unknown): Query;
  update(value: unknown): Query;
  single<T = unknown>(): Promise<Result<T>>;
};
type Db = { from(table: string): Query };

// Who to call at the vendor. Three named keys and nothing else: a free-form record let any key in,
// and the roster can only show what it knows the meaning of. Blank strings are dropped, not stored.
const contactText = (max: number) => z.string().trim().max(max).optional().transform((value) => (value ? value : undefined));
const contactSchema = z.object({
  name: contactText(120),
  email: z.string().trim().max(200).optional().transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || z.string().email().safeParse(value).success, "Enter a valid contact email"),
  phone: contactText(40),
}).strict();

const vendorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  lead_type: z.enum(["list", "realtime", "aged"]),
  // Absent means "not sent": the column defaults to {} on create and is left alone on update.
  contact: contactSchema.optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
  // The return window is the clock on a vendor credit claim (LA-2.19). Zero means "no returns
  // agreed", which is a real commercial position and not a missing value.
  return_window_days: z.number().int().min(0).max(365).default(0),
  notes: z.string().trim().max(2000).nullable().optional(),
  // 20260925707000. A label for people ("Direct mail responders"); lead_type stays the vocabulary.
  category: z.string().trim().max(80).nullable().optional().transform((value) => (value ? value : value === undefined ? undefined : null)),
  // The contract renewal date, entered by hand. Nothing acts on it; the drop facts quote it.
  renews_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD for the renewal date")
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "The renewal date is not a real date")
    .nullable().optional(),
  // A new vendor can start under review. Trialling is derived (tenant_vendor_card), never sent.
  status: z.enum(["active", "under_review"]).optional(),
}).strict();

const updateSchema = vendorSchema.partial().extend({
  id: z.string().uuid(),
  status: z.enum(["active", "under_review", "inactive"]).optional(),
}).strict();

/** Columns 20260925707000 adds. A write that sets one before it is applied gets a 503, not a 400. */
const NEW_COLUMNS = ["category", "renews_on"] as const;
const PENDING_UPDATE = "This setting needs a database update that has not been applied yet.";
const VENDOR_COLUMNS = "id, name, lead_type, contact, terms, return_window_days, status, notes, created_at";
const VENDOR_COLUMNS_NEW = `${VENDOR_COLUMNS}, category, renews_on`;

/**
 * Whether a failed write failed because the migration is not applied: a new column that does not
 * exist yet, or 'under_review' refused by the old status check.
 */
function needsUpdate(error: { message: string; code?: string } | null, input: Record<string, unknown>) {
  if (!error) return false;
  if (isSchemaGap(error)) return true;
  return error.code === "23514" && /status_check/.test(error.message) && input.status === "under_review";
}

/** Only the keys the caller sent: a write that does not touch the new columns must work before 707000. */
function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", roles);
  if (auth instanceof NextResponse) return auth;
  const db = getSupabaseServiceClient() as unknown as Db;

  // Three questions, one answer. "Is this vendor any good" is what LA-2.1's rollup exists for, and
  // it is not answerable from cost alone: a cheap list nobody can dial fast (LA-2.5) or that
  // arrives without consent evidence (LA-2.6) is not cheap. All three numbers were computed by
  // views that nothing read; they are read here, together, because they are only useful together.
  //
  // Each of the three degrades on its own. A pending migration that has not added the rejection
  // columns to the rollup, or has not created the speed view at all, must not take the vendor list
  // down with it — the names, terms and return windows are in a base table that is always there.
  const [vendors, consent] = await Promise.all([
    db.from("tenant_lead_vendors")
      .select(VENDOR_COLUMNS_NEW)
      .eq("tenant_id", auth.context.tenantId)
      .order("name"),
    db.from("tenant_vendor_consent_coverage")
      .select("vendor_id, leads, claimed_certificates, any_certificate, claimed_coverage_pct, any_coverage_pct")
      .eq("tenant_id", auth.context.tenantId),
  ]);

  const pending: SchemaGapNotice[] = [];

  // Category and renewal date arrive with 20260925707000. Until it is applied the same list is read
  // without them — the vendor list is never taken down by a column it can live without.
  let vendorRows = vendors.data as Array<Record<string, unknown>> | null;
  let vendorError = vendors.error;
  if (vendorError && isSchemaGap(vendorError)) {
    const base = await db.from("tenant_lead_vendors").select(VENDOR_COLUMNS).eq("tenant_id", auth.context.tenantId).order("name");
    vendorRows = ((base.data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({ ...row, category: null, renews_on: null }));
    vendorError = base.error;
    if (!base.error) pending.push({ missing: [...NEW_COLUMNS], detail: "Vendor categories and renewal dates need a database update that has not been applied yet." });
  }

  // Errors are reported, not swallowed into an empty list. A vendor page that renders "no vendors"
  // because a query failed is indistinguishable from one that renders "no vendors" because there
  // are none, and the first is a bug while the second is a Tuesday.
  if (vendorError)
    return NextResponse.json({ error: `Could not load vendors: ${vendorError.message}` }, { status: 500 });

  // The rollup with the usable-row columns, falling back to the same view without them. Nothing is
  // recomputed here: every column in either list is stored or generated in the database.
  const ROLLUP_BASE = "vendor_id, vendor_name, lead_type, status, return_window_days, campaign_count, active_campaign_count, total_spend_cents, records_purchased, credits_received_cents, cost_per_record_cents, effective_cost_per_record_cents";
  let rollupRows: Array<Record<string, unknown>> = [];
  const rollup = await db.from("tenant_vendor_rollup")
    .select(`${ROLLUP_BASE}, records_rejected, records_usable, cost_per_usable_record_cents`)
    .eq("tenant_id", auth.context.tenantId);
  if (!rollup.error) {
    rollupRows = (rollup.data as Array<Record<string, unknown>> | null) ?? [];
  } else if (isSchemaGap(rollup.error)) {
    const reduced = await db.from("tenant_vendor_rollup").select(ROLLUP_BASE).eq("tenant_id", auth.context.tenantId);
    if (reduced.error)
      return NextResponse.json({ error: `Could not load the vendor rollup: ${reduced.error.message}` }, { status: 500 });
    rollupRows = ((reduced.data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
      ...row,
      records_rejected: null,
      records_usable: null,
      cost_per_usable_record_cents: null,
    }));
    pending.push({
      missing: ["records_rejected", "records_usable", "cost_per_usable_record_cents"],
      detail: "Rejected and usable record counts need the scrub-rejection ledger, which a pending migration creates.",
    });
  } else {
    return NextResponse.json({ error: `Could not load the vendor rollup: ${rollup.error.message}` }, { status: 500 });
  }

  const speed = await db.from("tenant_vendor_speed_to_lead")
    .select("vendor_id, posted_leads, dialled_leads, median_seconds, dialled_within_60s, dialled_within_60s_pct")
    .eq("tenant_id", auth.context.tenantId);
  let speedRows: Array<Record<string, unknown>> = [];
  if (!speed.error) {
    speedRows = (speed.data as Array<Record<string, unknown>> | null) ?? [];
  } else if (isSchemaGap(speed.error)) {
    pending.push({
      missing: ["median_seconds", "dialled_within_60s_pct"],
      detail: "Speed to lead is not deployed yet, so the time between a lead arriving and its first dial is not being measured.",
    });
  } else {
    return NextResponse.json({ error: `Could not load speed to lead: ${speed.error.message}` }, { status: 500 });
  }

  if (consent.error)
    return NextResponse.json({ error: `Could not load consent coverage: ${consent.error.message}` }, { status: 500 });

  return NextResponse.json(
    {
      vendors: vendorRows ?? [],
      rollup: rollupRows,
      speed: speedRows,
      consent: consent.data ?? [],
      pending,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = vendorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid vendor details" }, { status: 400 });

  // The returned columns are the ones that exist before 20260925707000 too, so a create that does
  // not set a new field works on either side of the migration.
  const { data, error } = await (getSupabaseServiceClient() as unknown as Db)
    .from("tenant_lead_vendors")
    .insert(withoutUndefined({
      ...parsed.data,
      terms: parsed.data.terms ?? null,
      notes: parsed.data.notes ?? null,
      tenant_id: auth.context.tenantId,
      created_by: auth.context.userId,
    }))
    .select(VENDOR_COLUMNS)
    .single<{ id: string; name: string }>();

  if (error || !data) {
    if (needsUpdate(error, parsed.data))
      return NextResponse.json({ error: PENDING_UPDATE }, { status: 503 });
    if (error?.code === "23505")
      return NextResponse.json({ error: "A vendor with that name already exists" }, { status: 409 });
    return NextResponse.json({ error: "Could not create vendor" }, { status: 400 });
  }

  await audit({
    actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_vendor_saved",
    targetType: "tenant_lead_vendor", targetId: data.id,
    metadata: { operation: "created", name: data.name, leadType: parsed.data.lead_type, status: parsed.data.status ?? "active" }, request,
  });
  return NextResponse.json({ vendor: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid vendor details" }, { status: 400 });

  const { id, ...sent } = parsed.data;
  const changes = withoutUndefined(sent);
  if (Object.keys(changes).length === 0)
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  // `.eq("tenant_id")` alongside the id is the tenant boundary on a write that takes the id from
  // the request body. Without it, a valid session could edit another tenant's vendor by guessing
  // a uuid.
  const { data, error } = await (getSupabaseServiceClient() as unknown as Db)
    .from("tenant_lead_vendors")
    .update(changes)
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .select(VENDOR_COLUMNS)
    .single<{ id: string; name: string }>();

  if (needsUpdate(error, changes)) return NextResponse.json({ error: PENDING_UPDATE }, { status: 503 });
  if (error?.code === "23505") return NextResponse.json({ error: "A vendor with that name already exists" }, { status: 409 });
  if (error?.code === "23514") return NextResponse.json({ error: "Enter valid vendor details" }, { status: 400 });
  if (error || !data) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });

  // A status change is the one edit a reviewer looks for later ("who put LeadCo under review"), so
  // the new value is kept in the row, not only the list of changed keys. Contact details are not.
  await audit({
    actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_vendor_saved",
    targetType: "tenant_lead_vendor", targetId: id,
    metadata: { operation: "updated", changed: Object.keys(changes), ...(changes.status ? { status: changes.status } : {}) }, request,
  });
  return NextResponse.json({ vendor: data });
}
