import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { EMPTY_SIGNATURE, SIGNATURE_KEYS, parseSignatureAnswers, type SignatureAnswers } from "@/lib/leadWorkspace/signatureReadiness";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * "Can she finish on this call?" for one lead: the six answers, read and saved. Until migration
 * 20260925710000 is applied the table does not exist, and the route says so (schemaPending) rather
 * than failing, so the lead page stays usable.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = `lead_id, ${SIGNATURE_KEYS.join(", ")}, updated_by, updated_at`;
const missingTable = (error: { code?: string; message?: string } | null) => Boolean(error && (["42P01", "PGRST205", "PGRST204"].includes(error.code ?? "") || /tenant_lead_signature_readiness/.test(error.message ?? "")));

type Row = SignatureAnswers & { updated_by: string | null; updated_at: string };
// The table is not in the generated types until the migration is applied and types are regenerated.
type LooseTable = {
  select: (columns: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: Row | null; error: { code?: string; message: string } | null }> } } };
  upsert: (row: Record<string, unknown>, options: { onConflict: string }) => { select: (columns: string) => { single: () => PromiseLike<{ data: Row | null; error: { code?: string; message: string } | null }> } };
};
const table = () => (getSupabaseServiceClient() as unknown as { from: (name: string) => LooseTable }).from("tenant_lead_signature_readiness");

async function leadInTenant(tenantId: string, leadId: string) {
  const { data } = await getSupabaseServiceClient().from("agent_leads").select("id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  return Boolean(data);
}

function answersOf(row: Row | null): SignatureAnswers {
  if (!row) return { ...EMPTY_SIGNATURE };
  return Object.fromEntries(SIGNATURE_KEYS.map((key) => [key, row[key] ?? null])) as SignatureAnswers;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id) || !(await leadInTenant(auth.context.tenantId, id))) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const { data, error } = await table().select(COLUMNS).eq("tenant_id", auth.context.tenantId).eq("lead_id", id).maybeSingle();
  if (missingTable(error)) return NextResponse.json({ schemaPending: true, answers: { ...EMPTY_SIGNATURE }, updatedAt: null });
  if (error) return NextResponse.json({ error: "Could not read the signature answers" }, { status: 500 });
  return NextResponse.json({ schemaPending: false, answers: answersOf(data), updatedAt: data?.updated_at ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id) || !(await leadInTenant(auth.context.tenantId, id))) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const answers = parseSignatureAnswers(await request.json().catch(() => null));
  if (!answers) return NextResponse.json({ error: "Each answer must be yes, no or not asked" }, { status: 400 });
  const { data, error } = await table()
    .upsert({ tenant_id: auth.context.tenantId, lead_id: id, ...answers, updated_by: auth.context.userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,lead_id" })
    .select(COLUMNS)
    .single();
  if (missingTable(error)) return NextResponse.json({ error: "This needs a database update that has not been applied yet" }, { status: 503 });
  if (error || !data) return NextResponse.json({ error: "Could not save the signature answers" }, { status: 500 });
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_signature_readiness_updated", targetType: "agent_lead", targetId: id, metadata: { changed: Object.keys(answers) }, request });
  return NextResponse.json({ schemaPending: false, answers: answersOf(data), updatedAt: data.updated_at });
}
