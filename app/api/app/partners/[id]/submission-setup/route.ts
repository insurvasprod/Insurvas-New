import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const OWNER_ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ProfileQuery = { select: (columns: string) => ProfileQuery; eq: (column: string, value: unknown) => ProfileQuery; order: (column: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>; maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>; upsert: (values: unknown, options: unknown) => ProfileQuery; single: () => Promise<{ data: unknown; error: { message: string } | null }> };
type ProfileDb = { from: (table: string) => ProfileQuery };

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params;
  if (!UUID.test(partnerId)) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  const db = getSupabaseServiceClient() as unknown as ProfileDb;
  const { data, error } = await db.from("partner_submission_profiles").select("*").eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).order("product_code");
  if (error) return NextResponse.json({ error: "Could not load submission setup" }, { status: 500 });
  return NextResponse.json({ profiles: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params;
  if (!UUID.test(partnerId)) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  const body = await request.json().catch(() => null) as { product_code?: unknown; fields?: unknown; verification_fields?: unknown } | null;
  if (typeof body?.product_code !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code) || !Array.isArray(body.fields) || !Array.isArray(body.verification_fields)) return NextResponse.json({ error: "Choose a product and valid field lists" }, { status: 400 });
  const fields = body.fields.filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === "object" && !Array.isArray(field));
  const phone = fields.find((field) => field.field_key === "phone" || field.field_key === "phone_number" || field.type === "phone");
  if (!phone) return NextResponse.json({ error: "A phone field is required for partner screening" }, { status: 400 });
  const db = getSupabaseServiceClient() as unknown as ProfileDb;
  const existing = await db.from("partner_submission_profiles").select("revision").eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).eq("product_code", body.product_code).maybeSingle() as { data: { revision: number } | null; error: { message: string } | null };
  if (existing.error) return NextResponse.json({ error: "Could not load current submission setup" }, { status: 500 });
  const { data, error } = await db.from("partner_submission_profiles").upsert({ tenant_id: auth.context.tenantId, partner_id: partnerId, product_code: body.product_code, revision: (existing.data?.revision ?? 0) + 1, fields, verification_fields: body.verification_fields, created_by: auth.context.userId }, { onConflict: "tenant_id,partner_id,product_code" }).select("*").single();
  if (error) return NextResponse.json({ error: "Could not save submission setup" }, { status: 500 });
  return NextResponse.json({ profile: data });
}
