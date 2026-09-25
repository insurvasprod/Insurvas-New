import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const roles = ["owner", "producer", "bookkeeper"] as const;
const policyFields = {
  policy_number: z.string().trim().min(1).max(120),
  insured_name: z.string().trim().min(1).max(200),
  carrier: z.string().trim().min(1).max(160),
  product: z.string().trim().min(1).max(160),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Effective date must be YYYY-MM-DD"),
  annual_premium_cents: z.number().int().min(0).max(10_000_000_000),
  status: z.enum(["active", "pending", "lapsed", "cancelled"]).default("active"),
  renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Renewal date must be YYYY-MM-DD").nullable().optional(),
} as const;
const policySchema = z.object(policyFields).strict().superRefine((value, context) => {
  if (value.renewal_date && value.renewal_date < value.effective_date)
    context.addIssue({ code: "custom", path: ["renewal_date"], message: "Renewal date cannot be before the effective date" });
});

const bodySchema = z.union([policySchema, z.object({ policies: z.array(policySchema).min(1).max(1000) }).strict()]);
const patchSchema = z.object(policyFields).partial().extend({ id: z.string().uuid() }).strict();

type QueryResult<T = unknown> = { data: T | null; error: { code?: string; message: string } | null };
type Query = PromiseLike<QueryResult> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  insert(value: unknown): Query;
  update(value: unknown): Query;
  single<T = unknown>(): Promise<QueryResult<T>>;
};
type Db = { from(table: string): Query };
type Policy = { id: string; policy_number: string; insured_name: string; carrier: string; product: string; effective_date: string; annual_premium_cents: number; status: "active" | "pending" | "lapsed" | "cancelled"; renewal_date: string | null; source: "manual" | "csv"; created_at: string; updated_at: string };

function db() { return getSupabaseServiceClient() as unknown as Db; }

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", roles);
  if (auth instanceof NextResponse) return auth;
  const result = await db().from("tenant_policies").select("id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, renewal_date, source, created_at, updated_at").eq("tenant_id", auth.context.tenantId).order("effective_date", { ascending: false });
  if (result.error) {
    const unavailable = result.error.code === "42P01";
    return NextResponse.json({ error: unavailable ? "Policy storage is not available yet" : "Could not load policies", code: unavailable ? "policy_storage_unavailable" : "policy_load_failed" }, { status: unavailable ? 503 : 500 });
  }
  const policies = (result.data as Policy[] | null) ?? [];
  const today = new Date();
  // Thirty days, as the Policies board counts "renewals due" — the only reader of this figure.
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 30);
  const renewalsDue = policies.filter((policy) => {
    if (policy.status !== "active" || !policy.renewal_date) return false;
    const date = new Date(`${policy.renewal_date}T00:00:00Z`);
    return date >= new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`) && date <= horizon;
  }).length;
  const active = policies.filter((policy) => policy.status === "active");
  return NextResponse.json({ ok: true, readOnly: auth.entitlement.access === "read_only", policies, metrics: { active: active.length, annualPremiumCents: active.reduce((sum, policy) => sum + policy.annual_premium_cents, 0), carriers: new Set(active.map((policy) => policy.carrier)).size, renewalsDue } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid policy details" }, { status: 400 });
  const policies = "policies" in parsed.data ? parsed.data.policies : [parsed.data];
  const source = "policies" in parsed.data ? "csv" : "manual";
  const rows = policies.map((policy) => ({ ...policy, renewal_date: policy.renewal_date ?? null, source, tenant_id: auth.context.tenantId, created_by: auth.context.userId }));
  const result = await db().from("tenant_policies").insert(rows).select("id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, renewal_date, source, created_at, updated_at");
  if (result.error) {
    if (result.error.code === "23505") return NextResponse.json({ error: "A policy with one of those policy numbers already exists" }, { status: 409 });
    if (result.error.code === "42P01") return NextResponse.json({ error: "Policy storage is not available yet", code: "policy_storage_unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Could not save policies" }, { status: 400 });
  }
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: source === "csv" ? "tenant.policies_imported" : "tenant.policy_created", targetType: "tenant_policy", targetId: (rows[0] as { policy_number: string }).policy_number, metadata: { count: rows.length, source }, request });
  return NextResponse.json({ policies: result.data ?? [] }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid policy details" }, { status: 400 });
  const { id, ...changes } = parsed.data;
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const result = await db().from("tenant_policies").update(changes).eq("id", id).eq("tenant_id", auth.context.tenantId).select("id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, renewal_date, source, created_at, updated_at").single<Policy>();
  if (result.error || !result.data) return NextResponse.json({ error: result.error?.code === "23505" ? "That policy number already exists" : "Policy not found" }, { status: result.error?.code === "23505" ? 409 : 404 });
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.policy_updated", targetType: "tenant_policy", targetId: id, metadata: { changed: Object.keys(changes) }, request });
  return NextResponse.json({ policy: result.data });
}
